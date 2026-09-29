import { createBookIndex } from '@dozabaneh/core';
import type { AgentTask, BookBundle, QaFlag, TaskResult, TranslationSettings } from '@dozabaneh/shared';
import { applyFirstMentions, checkTranslation, postprocess, type QaGlossaryEntry } from '@dozabaneh/text';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { getBookRow, getBundle, newId, refreshCounters } from '../db/repo';
import { books, glossaryTerms, jobs, translationRevisions, translations } from '../db/schema';
import { approvedTerms, chapterSegments, currentText, type MemoryHit, toParenthetical } from './batches';
import { type JobRow, scopeOf } from './jobs';
import { reindexSegments } from './search-index';
import { type PipelineCtx, translationSettings, updateSettings } from './state';

/**
 * Imports a validated result into the database (SPEC §9.5–§9.8): deterministic post-processing, first-mention
 * parentheticals, QA flags, revisions — and never overwrites a user-edited translation (it becomes a suggestion).
 * Runs inside one transaction together with marking the job succeeded, so importing twice is impossible.
 */
export interface ImportMeta {
  engine: string;
  model?: string;
  promptVersion?: string;
}

const BLOCKING_FLAG = new Set(['medium', 'high']);
const LOW_CONFIDENCE = { economy: 0.7, balanced: 0.7, best: 0.85 } as const;

type TranslationRow = typeof translations.$inferSelect;

function qaGlossary(bundle: BookBundle, lang: string): QaGlossaryEntry[] {
  return approvedTerms(bundle, lang).map((g) => ({
    src: g.src,
    tgt: g.tgt,
    alternatives: g.alternatives,
    kind: g.kind,
  }));
}

function qaFlags(src: string, tgt: string, bundle: BookBundle, lang: string): QaFlag[] {
  return checkTranslation(src, tgt, {
    srcLang: bundle.book.sourceLang,
    tgtLang: lang,
    glossary: qaGlossary(bundle, lang),
  }).map((q) => ({ code: q.code, severity: q.severity, reason: q.message }));
}

function getRow(db: Db, segmentId: string, lang: string): TranslationRow | undefined {
  return db
    .select()
    .from(translations)
    .where(and(eq(translations.segmentId, segmentId), eq(translations.lang, lang)))
    .get();
}

/** Writes an engine result for one segment; user-edited segments only receive a suggestion. */
function writeEngineText(
  db: Db,
  segmentId: string,
  lang: string,
  values: Partial<TranslationRow> & { status: TranslationRow['status'] },
  meta: ImportMeta,
  newText: string,
  revisionReason: string | null,
): void {
  const row = getRow(db, segmentId, lang);
  if (row?.status === 'user_edited') {
    db.update(translations)
      .set({ suggestion: newText, updatedAt: new Date().toISOString() })
      .where(and(eq(translations.segmentId, segmentId), eq(translations.lang, lang)))
      .run();
    return;
  }
  const before = row ? (row.final ?? row.draft) : null;
  const set = {
    ...values,
    engine: meta.engine,
    model: meta.model ?? null,
    promptVersion: meta.promptVersion ?? null,
    version: (row?.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  db.insert(translations)
    .values({ segmentId, lang, ...set })
    .onConflictDoUpdate({ target: [translations.segmentId, translations.lang], set })
    .run();
  if (revisionReason && before !== null && before !== newText) {
    db.insert(translationRevisions)
      .values({ id: newId('rv'), segmentId, lang, before, after: newText, actor: 'engine', reason: revisionReason })
      .run();
  }
}

function applyBrief(db: Db, bookId: string, lang: string, output: TaskResult<'brief'>): void {
  const row = getBookRow(db, bookId);
  if (!row) return;
  db.update(books)
    .set({
      brief: { ...(row.brief ?? {}), [lang]: output.brief },
      titles: row.titles[lang] ? row.titles : { ...row.titles, [lang]: output.titleTranslated },
    })
    .where(eq(books.id, bookId))
    .run();
  updateSettings(db, bookId, (s) => {
    s.briefs = { ...(s.briefs ?? {}), [lang]: output };
  });
}

function applyGlossary(
  db: Db,
  bookId: string,
  lang: string,
  job: JobRow,
  keyMap: Record<string, string>,
  output: TaskResult<'glossary'>,
  settings: TranslationSettings,
): string[] {
  const row = getBookRow(db, bookId);
  if (!row) return [];
  const existing = new Set(
    db
      .select({ src: glossaryTerms.src })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.bookId, bookId), eq(glossaryTerms.tgtLang, lang)))
      .all()
      .map((g) => g.src.toLowerCase()),
  );
  const freq = new Map((scopeOf(job).candidates ?? []).map((c) => [c.src, c.freq]));
  const ids: string[] = [];
  for (const item of output.items) {
    const src = keyMap[item.key];
    if (!item.keep || !src || !item.tgt || existing.has(src.toLowerCase())) continue;
    existing.add(src.toLowerCase());
    const id = newId('gt');
    db.insert(glossaryTerms)
      .values({
        id,
        bookId,
        srcLang: row.sourceLang,
        tgtLang: lang,
        src,
        tgt: postprocess(item.tgt, lang, { ezafe: settings.ezafe, digits: settings.digits }),
        alternatives: item.alternatives ?? [],
        definition: item.definition ?? null,
        kind: item.kind ?? 'term',
        parenthetical: item.parenthetical ?? settings.parenthetical,
        status: 'proposed',
        occurrences: freq.get(src) ?? 0,
        notes: item.notes ?? null,
        confidence: item.confidence ?? null,
      })
      .run();
    ids.push(id);
  }
  return ids;
}

/**
 * First-mention parentheticals for items of one chapter, given the texts that precede them in the chapter.
 * Returns segmentId → text.
 */
function withFirstMentions(
  bundle: BookBundle,
  lang: string,
  chapterId: string,
  texts: Map<string, string>,
): Map<string, string> {
  const index = createBookIndex(bundle);
  const inChapter = chapterSegments(index, chapterId);
  const firstIdx = inChapter.findIndex((s) => texts.has(s.id));
  const before = inChapter.slice(0, Math.max(0, firstIdx)).map((s) => ({
    key: s.id,
    text: currentText(index, s.id, lang),
    type: s.type === 'heading' ? 'h' : 'p',
  }));
  const entries = approvedTerms(bundle, lang).map(toParenthetical);
  const alreadyIntroduced = applyFirstMentions(
    before,
    entries.filter((e) => e.policy === 'first_in_chapter'),
    lang,
  ).introduced;
  const items = inChapter
    .filter((s) => texts.has(s.id))
    .map((s) => ({ key: s.id, text: texts.get(s.id) as string, type: s.type === 'heading' ? 'h' : 'p' }));
  const out = new Map<string, string>();
  for (const item of applyFirstMentions(items, entries, lang, alreadyIntroduced).items) out.set(item.key, item.text);
  return out;
}

function applyTranslate(
  db: Db,
  bundle: BookBundle,
  lang: string,
  job: JobRow,
  keyMap: Record<string, string>,
  output: TaskResult<'translate'>,
  settings: TranslationSettings,
  meta: ImportMeta,
): string[] {
  const segById = new Map(bundle.segments.map((s) => [s.id, s]));
  const texts = new Map<string, string>();
  const notes = new Map<string, string>();
  for (const item of output.items) {
    const segId = keyMap[item.key];
    const seg = segId ? segById.get(segId) : undefined;
    if (!seg) continue;
    texts.set(
      seg.id,
      postprocess(item.tgt, lang, { ezafe: settings.ezafe, digits: settings.digits, segmentType: seg.type }),
    );
    if (item.note?.trim()) notes.set(seg.id, item.note.trim());
  }
  const chapterId = scopeOf(job).chapterId ?? scopeOf(job).nodeId ?? '';
  const final = withFirstMentions(bundle, lang, chapterId, texts);
  const economy = settings.profile === 'economy';
  for (const [segId, t] of final) {
    const seg = segById.get(segId);
    if (!seg) continue;
    const flags = qaFlags(seg.src, t, bundle, lang);
    const blocking = flags.some((f) => BLOCKING_FLAG.has(f.severity));
    writeEngineText(
      db,
      segId,
      lang,
      {
        draft: t,
        final: economy ? t : null,
        status: economy ? (blocking ? 'flagged' : 'final') : 'drafted',
        note: notes.get(segId) ?? null,
        flags,
        confidence: null,
      },
      meta,
      t,
      economy ? 'translate' : null,
    );
  }
  return [...final.keys()];
}

function applyEdit(
  db: Db,
  bundle: BookBundle,
  lang: string,
  job: JobRow,
  keyMap: Record<string, string>,
  output: TaskResult<'edit'>,
  settings: TranslationSettings,
  meta: ImportMeta,
): string[] {
  const segById = new Map(bundle.segments.map((s) => [s.id, s]));
  const texts = new Map<string, string>();
  const byKey = new Map(output.items.map((i) => [keyMap[i.key], i]));
  for (const item of output.items) {
    const segId = keyMap[item.key];
    const seg = segId ? segById.get(segId) : undefined;
    if (seg)
      texts.set(
        seg.id,
        postprocess(item.tgt, lang, { ezafe: settings.ezafe, digits: settings.digits, segmentType: seg.type }),
      );
  }
  const chapterId = scopeOf(job).chapterId ?? scopeOf(job).nodeId ?? '';
  const final = withFirstMentions(bundle, lang, chapterId, texts);
  const threshold = LOW_CONFIDENCE[settings.profile];
  for (const [segId, t] of final) {
    const seg = segById.get(segId);
    const item = byKey.get(segId);
    if (!seg || !item) continue;
    const flags = qaFlags(seg.src, t, bundle, lang);
    if (item.flag) flags.push({ code: 'editor', severity: item.flag.severity, reason: item.flag.reason });
    if (item.confidence < threshold)
      flags.push({ code: 'low_confidence', severity: 'low', reason: `confidence ${item.confidence}` });
    const review =
      Boolean(item.flag) || item.confidence < threshold || flags.some((f) => BLOCKING_FLAG.has(f.severity));
    const reason = item.changes.length ? [...new Set(item.changes.map((c) => c.type))].join(', ') : 'edit';
    writeEngineText(
      db,
      segId,
      lang,
      { final: t, status: review ? 'flagged' : 'final', flags, confidence: item.confidence },
      meta,
      t,
      reason,
    );
  }
  return [...final.keys()];
}

/** Applies translation-memory hits (identical source text translated elsewhere in the book). */
export function applyMemory(ctx: PipelineCtx, bookId: string, lang: string, hits: MemoryHit[]): void {
  if (hits.length === 0) return;
  const bundle = getBundle(ctx.db, bookId);
  if (!bundle) return;
  const segById = new Map(bundle.segments.map((s) => [s.id, s]));
  ctx.db.transaction(() => {
    for (const hit of hits) {
      const seg = segById.get(hit.segmentId);
      const flags: QaFlag[] =
        seg && seg.type !== 'heading'
          ? [{ code: 'memory', severity: 'low', reason: `reused from ${hit.fromSegmentId}` }]
          : [];
      writeEngineText(
        ctx.db,
        hit.segmentId,
        lang,
        { draft: hit.text, final: null, status: 'drafted', flags },
        { engine: 'memory' },
        hit.text,
        null,
      );
    }
  });
}

/** Imports an engine result for a job and marks the job succeeded — atomically. Returns changed segment ids. */
export function importResult<T extends AgentTask>(
  ctx: PipelineCtx,
  job: JobRow,
  keyMap: Record<string, string>,
  output: TaskResult<T>,
  meta: ImportMeta,
): string[] {
  const { db } = ctx;
  const lang = job.targetLang as string;
  let changed: string[] = [];
  db.transaction(() => {
    const current = db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, job.id)).get();
    if (!current || current.status === 'succeeded' || current.status === 'cancelled')
      throw new AlreadyDone(current?.status ?? 'missing');
    const row = getBookRow(db, job.bookId);
    const bundle = getBundle(db, job.bookId);
    if (!row || !bundle) throw new Error(`book ${job.bookId} not found`);
    const settings = translationSettings(row, lang);
    switch (job.stage) {
      case 'brief':
        applyBrief(db, job.bookId, lang, output as TaskResult<'brief'>);
        break;
      case 'glossary':
        applyGlossary(db, job.bookId, lang, job, keyMap, output as TaskResult<'glossary'>, settings);
        break;
      case 'translate':
        changed = applyTranslate(db, bundle, lang, job, keyMap, output as TaskResult<'translate'>, settings, meta);
        break;
      case 'edit':
        changed = applyEdit(db, bundle, lang, job, keyMap, output as TaskResult<'edit'>, settings, meta);
        break;
      default:
        throw new Error(`cannot import ${job.stage}`);
    }
    db.update(jobs)
      .set({ status: 'succeeded', leaseUntil: null, error: null, finishedAt: new Date().toISOString() })
      .where(eq(jobs.id, job.id))
      .run();
  });
  if (changed.length) {
    reindexSegments(db, job.bookId, changed, lang);
    refreshCounters(db, job.bookId);
    ctx.notify(job.bookId, { type: 'segment', lang, ids: changed });
  }
  if (job.stage === 'glossary' || job.stage === 'brief') ctx.notify(job.bookId, { type: 'glossary', lang });
  ctx.notify(job.bookId, { type: 'pipeline', lang });
  return changed;
}

export class AlreadyDone extends Error {
  constructor(readonly status: string) {
    super(`job already ${status}`);
  }
}

/**
 * Chapter consistency pass (SPEC §9.5-5): once every section of a chapter is done, first-mention parentheticals are
 * re-applied across the whole chapter in document order. User-edited segments are left untouched.
 */
export function finalizeChapter(ctx: PipelineCtx, bookId: string, lang: string, chapterId: string): string[] {
  const bundle = getBundle(ctx.db, bookId);
  if (!bundle) return [];
  const index = createBookIndex(bundle);
  const segs = chapterSegments(index, chapterId);
  const items = segs
    .map((s) => ({ key: s.id, text: currentText(index, s.id, lang), type: s.type === 'heading' ? 'h' : 'p' }))
    .filter((i) => i.text);
  const entries = approvedTerms(bundle, lang).map(toParenthetical);
  const next = applyFirstMentions(items, entries, lang).items;
  const changed: string[] = [];
  ctx.db.transaction(() => {
    next.forEach((item, i) => {
      if (item.text === items[i]?.text) return;
      const row = getRow(ctx.db, item.key, lang);
      if (!row || row.status === 'user_edited') return;
      const column = row.final !== null ? { final: item.text } : { draft: item.text };
      ctx.db
        .update(translations)
        .set({ ...column, version: sql`${translations.version} + 1`, updatedAt: new Date().toISOString() })
        .where(and(eq(translations.segmentId, item.key), eq(translations.lang, lang)))
        .run();
      ctx.db
        .insert(translationRevisions)
        .values({
          id: newId('rv'),
          segmentId: item.key,
          lang,
          before: items[i]?.text ?? null,
          after: item.text,
          actor: 'engine',
          reason: 'first-mention',
        })
        .run();
      changed.push(item.key);
    });
  });
  if (changed.length) {
    reindexSegments(ctx.db, bookId, changed, lang);
    ctx.notify(bookId, { type: 'segment', lang, ids: changed });
  }
  return changed;
}
