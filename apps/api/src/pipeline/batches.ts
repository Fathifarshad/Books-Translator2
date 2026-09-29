import { promptRefsFor } from '@dozabaneh/ai';
import {
  type BookIndex,
  chapterOf,
  createBookIndex,
  ITEM_TYPES_BY_SEGMENT,
  introducedIn,
  itemKeys,
  locationPath,
  memoryKey,
  needsTranslation,
} from '@dozabaneh/core';
import type {
  AgentBatch,
  AgentTask,
  BookBundle,
  GlossaryEntry,
  GlossaryTermRecord,
  SegmentRecord,
  TranslationSettings,
} from '@dozabaneh/shared';
import { createGlossaryMatcher, type ParentheticalEntry, stripMarkup } from '@dozabaneh/text';
import { getBookRow, getBundle, newId } from '../db/repo';
import { batchPaths, displayPath } from './exchange';
import { type JobRow, scopeOf } from './jobs';
import { type PipelineCtx, translationSettings } from './state';

/**
 * Builds the batch envelope for a job (SPEC Appendix E) from the current database state. The same envelope is
 * written to a file for the agent or passed to an in-process engine (mock; API engines in Phase 4).
 */
export interface BuiltBatch {
  batch: AgentBatch;
  keyMap: Record<string, string>;
}

/** Translation-memory hits applied directly instead of being sent to an engine (SPEC §9.9). */
export interface MemoryHit {
  segmentId: string;
  text: string;
  fromSegmentId: string;
}

export interface BatchPlan {
  built: BuiltBatch | null;
  memory: MemoryHit[];
}

const text = (t: { text?: string } | undefined) => t?.text ?? '';

export function approvedTerms(bundle: BookBundle, lang: string): GlossaryTermRecord[] {
  return bundle.glossary.filter((g) => g.tgtLang === lang && g.status !== 'proposed');
}

/** Glossary entries whose source term occurs in the given texts. */
export function glossarySubset(terms: GlossaryTermRecord[], texts: string[], srcLang: string): GlossaryTermRecord[] {
  if (terms.length === 0) return [];
  const matcher = createGlossaryMatcher(
    terms.map((t) => ({ id: t.id, text: t.src })),
    srcLang,
  );
  const hit = new Set<string>();
  for (const t of texts) for (const m of matcher.find(stripMarkup(t))) hit.add(m.termId);
  return terms.filter((t) => hit.has(t.id));
}

const toEntry = (g: GlossaryTermRecord): GlossaryEntry => ({
  src: g.src,
  tgt: g.tgt,
  kind: g.kind,
  parenthetical: g.parenthetical,
  ...(g.definition ? { note: g.definition } : {}),
});

export const toParenthetical = (g: GlossaryTermRecord): ParentheticalEntry => ({
  id: g.id,
  src: g.src,
  tgt: g.tgt,
  policy: g.parenthetical,
});

/** Translatable segments of a chapter in document order (the unit of first-mention state and context). */
export function chapterSegments(index: BookIndex, chapterId: string): SegmentRecord[] {
  const out: SegmentRecord[] = [];
  for (const node of index.nodes) {
    const ch = chapterOf(index, node.id)?.id ?? node.id;
    if (ch !== chapterId) continue;
    out.push(...(index.segmentsByNode.get(node.id) ?? []).filter(needsTranslation));
  }
  return out;
}

export function currentText(index: BookIndex, segmentId: string, lang: string): string {
  const t = index.translations.get(`${segmentId}|${lang}`);
  return t && t.status !== 'queued' && t.status !== 'pending' ? text(t) : '';
}

function envelope(
  ctx: PipelineCtx,
  bundle: BookBundle,
  task: AgentTask,
  lang: string,
  settings: TranslationSettings,
  input: unknown,
  location?: string[],
): AgentBatch {
  const batchId = newId('bt');
  const paths = batchPaths(ctx.config, bundle.book.id, task, batchId);
  const brief = bundle.book.brief?.[lang];
  return {
    schemaVersion: 1,
    batchId,
    task,
    promptRefs: promptRefsFor(task, lang),
    sourceLanguage: bundle.book.sourceLang,
    targetLanguage: lang,
    options: { ezafe: settings.ezafe, parenthetical: settings.parenthetical },
    book: {
      title: bundle.book.titles[bundle.book.sourceLang] ?? '',
      authors: bundle.book.authors,
      ...(brief ? { brief } : {}),
    },
    ...(location?.length ? { location: { path: location } } : {}),
    input,
    resultPath: displayPath(paths.result),
    createdAt: new Date().toISOString(),
  };
}

function briefInput(index: BookIndex, bundle: BookBundle) {
  const toc: string[] = [];
  for (const node of index.nodes) {
    if (node.kind === 'chapter_intro' || node.skip) continue;
    const seg = node.headingSegmentId ? index.segmentById.get(node.headingSegmentId) : undefined;
    const title = stripMarkup(seg?.src ?? node.title ?? '').trim();
    if (title) toc.push(`${'  '.repeat(node.depth)}${title}`);
    if (toc.length >= 120) break;
  }
  // ~3,000 words: the first paragraphs of every chapter, round-robin.
  const perChapter = index.nodes
    .filter((n) => n.kind === 'chapter' || n.kind === 'front' || n.kind === 'back')
    .filter((n) => !n.skip)
    .map((ch) => chapterSegments(index, ch.id).filter((s) => s.type === 'paragraph'));
  const samples: string[] = [];
  let words = 0;
  for (let round = 0; round < 6 && words < 3000; round++) {
    for (const list of perChapter) {
      const s = list[round];
      if (!s || words >= 3000) continue;
      samples.push(s.src);
      words += s.src.split(/\s+/u).length;
    }
  }
  const b = bundle.book;
  return {
    metadata: {
      title: b.titles[b.sourceLang] ?? '',
      ...(b.subtitles?.[b.sourceLang] ? { subtitle: b.subtitles[b.sourceLang] } : {}),
      authors: b.authors,
      ...(b.publisher ? { publisher: b.publisher } : {}),
      ...(b.year ? { year: b.year } : {}),
      pageCount: b.pageCount,
    },
    toc,
    samples,
  };
}

/** Plans the batch of a job; returns `built: null` when nothing is left for an engine to do. */
export function planBatch(ctx: PipelineCtx, job: JobRow): BatchPlan {
  const bundle = getBundle(ctx.db, job.bookId);
  if (!bundle) throw new Error(`book ${job.bookId} not found`);
  const lang = job.targetLang as string;
  const settings = translationSettings(getBookRow(ctx.db, job.bookId) ?? { settings: {} }, lang);
  const index = createBookIndex(bundle);
  const scope = scopeOf(job);
  const task = job.stage as AgentTask;
  const keyMap: Record<string, string> = {};

  if (task === 'brief') {
    return {
      built: { batch: envelope(ctx, bundle, task, lang, settings, briefInput(index, bundle)), keyMap },
      memory: [],
    };
  }

  if (task === 'glossary') {
    const candidates = scope.candidates ?? [];
    if (candidates.length === 0) return { built: null, memory: [] };
    const keys = itemKeys(candidates.length).map((k) => `c${k}`);
    const input = {
      candidates: candidates.map((c, i) => {
        keyMap[keys[i] as string] = c.src;
        return { key: keys[i] as string, src: c.src, freq: c.freq, examples: c.examples };
      }),
    };
    return { built: { batch: envelope(ctx, bundle, task, lang, settings, input), keyMap }, memory: [] };
  }

  const nodeId = scope.nodeId as string;
  const chapterId = scope.chapterId ?? nodeId;
  const inChapter = chapterSegments(index, chapterId);
  const wanted = new Set(scope.segmentIds ?? []);
  const segs = inChapter.filter((s) => wanted.has(s.id));
  const terms = approvedTerms(bundle, lang);
  const location = locationPath(index, nodeId, lang);
  const status = (id: string) => index.translations.get(`${id}|${lang}`)?.status;

  if (task === 'translate') {
    // Translation memory: identical source text already translated elsewhere in the book.
    const memoryByKey = new Map<string, { text: string; id: string }>();
    for (const t of bundle.translations) {
      if (t.lang !== lang || !['final', 'user_edited'].includes(t.status) || !t.text) continue;
      const seg = index.segmentById.get(t.segmentId);
      if (seg) memoryByKey.set(memoryKey(seg.src), { text: t.text, id: seg.id });
    }
    const memory: MemoryHit[] = [];
    const todo: SegmentRecord[] = [];
    for (const s of segs) {
      if (status(s.id) === 'user_edited') continue;
      const hit = memoryByKey.get(memoryKey(s.src));
      if (hit && hit.id !== s.id) memory.push({ segmentId: s.id, text: hit.text, fromSegmentId: hit.id });
      else todo.push(s);
    }
    if (todo.length === 0) return { built: null, memory };
    const first = inChapter.indexOf(todo[0] as SegmentRecord);
    const last = inChapter.indexOf(todo.at(-1) as SegmentRecord);
    const before = inChapter.slice(0, Math.max(0, first));
    const introduced = introducedIn(
      before.map((s) => ({ key: s.id, text: currentText(index, s.id, lang), type: s.type === 'heading' ? 'h' : 'p' })),
      terms.map(toParenthetical),
      lang,
    );
    const keys = itemKeys(todo.length);
    const input = {
      glossary: glossarySubset(
        terms,
        todo.map((s) => s.src),
        bundle.book.sourceLang,
      ).map(toEntry),
      alreadyIntroduced: introduced,
      context: {
        previous: before.slice(-2).map((s) => {
          const tgt = currentText(index, s.id, lang);
          return tgt ? { src: s.src, tgt } : { src: s.src };
        }),
        next: inChapter.slice(last + 1, last + 2).map((s) => ({ src: s.src })),
      },
      items: todo.map((s, i) => {
        keyMap[keys[i] as string] = s.id;
        return { key: keys[i] as string, type: ITEM_TYPES_BY_SEGMENT[s.type] ?? 'p', src: s.src };
      }),
    };
    return { built: { batch: envelope(ctx, bundle, task, lang, settings, input, location), keyMap }, memory };
  }

  if (task === 'edit') {
    // User-edited segments are only re-edited on request (their result becomes a suggestion).
    const todo = segs.filter((s) => (scope.rerun || status(s.id) !== 'user_edited') && currentText(index, s.id, lang));
    if (todo.length === 0) return { built: null, memory: [] };
    // Renderings already used in earlier sections of the book (SPEC §9.6 consistencyMemory).
    const firstOrd = index.nodes.findIndex((n) => n.id === nodeId);
    const earlier = index.nodes
      .slice(0, Math.max(0, firstOrd))
      .flatMap((n) => index.segmentsByNode.get(n.id) ?? [])
      .filter((s) => ['final', 'user_edited'].includes(status(s.id) ?? ''))
      .map((s) => s.src);
    const used = glossarySubset(terms, earlier, bundle.book.sourceLang).slice(0, 60);
    const keys = itemKeys(todo.length);
    const input = {
      glossary: glossarySubset(
        terms,
        todo.map((s) => s.src),
        bundle.book.sourceLang,
      ).map(toEntry),
      consistencyMemory: used.map((g) => ({ src: g.src, tgt: g.tgt })),
      items: todo.map((s, i) => {
        keyMap[keys[i] as string] = s.id;
        return { key: keys[i] as string, type: s.type, src: s.src, draft: currentText(index, s.id, lang) };
      }),
    };
    return { built: { batch: envelope(ctx, bundle, task, lang, settings, input, location), keyMap }, memory: [] };
  }

  throw new Error(`no batch builder for stage ${job.stage}`);
}
