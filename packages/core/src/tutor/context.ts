import type { Citation, ContextGlossaryEntry, ContextPassage, TutorEngineInput, TutorRequest } from '@dozabaneh/shared';
import { createGlossaryMatcher, stripMarkup } from '@dozabaneh/text';
import { type BookIndex, buildSection, glossaryFor, nodeTitle, visibleTranslation } from '../book';
import { createRetriever } from './retrieval';

export interface LabelTarget {
  segmentId: string;
  nodeId: string;
}

export interface TutorContext {
  input: TutorEngineInput;
  /** label ("P3") → segment; only labels in this map may become citations. */
  labelMap: Map<string, LabelTarget>;
}

export interface ContextOptions {
  /** Character budget for passages (≈ token budget × 3). */
  maxChars?: number;
  /** Retrieved passages from other sections. */
  retrieveK?: number;
  /** Formats a location label, e.g. (chapterNumber, sectionTitle) → «فصل ۱ · دقت». */
  formatLocation?: (chapterNumber: string | undefined, sectionTitle: string) => string;
  historyTurns?: number;
}

const DEFAULT_LOCATION = (chapter: string | undefined, title: string) => (chapter ? `${chapter} · ${title}` : title);

/**
 * Builds the tutor's prompt context at send time from the context stored on the message
 * (never from whatever the reader shows later) — fixes prototype bug §4.2-2.
 */
export function buildTutorContext(index: BookIndex, request: TutorRequest, opts: ContextOptions = {}): TutorContext {
  const { context, targetLang } = request;
  const maxChars = opts.maxChars ?? 12_000;
  const formatLocation = opts.formatLocation ?? DEFAULT_LOCATION;
  const section = buildSection(index, context.nodeId, targetLang);
  const passages: ContextPassage[] = [];
  const labelMap = new Map<string, LabelTarget>();
  const used = new Set<string>();
  let chars = 0;

  const add = (segmentId: string): boolean => {
    if (used.has(segmentId)) return true;
    const seg = index.segmentById.get(segmentId);
    if (!seg?.src || seg.type === 'heading' || seg.type === 'figure') return true;
    const src = stripMarkup(seg.src);
    const tgtRaw = visibleTranslation(index, seg.id, targetLang);
    const tgt = tgtRaw ? stripMarkup(tgtRaw) : undefined;
    const size = src.length + (tgt?.length ?? 0);
    if (chars + size > maxChars && passages.length > 0) return false;
    const node = index.nodeById.get(seg.nodeId);
    const payload = node ? buildSection(index, node.id, targetLang) : undefined;
    const title = payload ? (payload.title.tgt ?? payload.title.src) : '';
    const label = `P${passages.length + 1}`;
    passages.push({
      label,
      segmentId: seg.id,
      nodeId: seg.nodeId,
      location: formatLocation(payload?.chapter?.numberLabel, title),
      src,
      ...(tgt ? { tgt } : {}),
    });
    labelMap.set(label, { segmentId: seg.id, nodeId: seg.nodeId });
    used.add(seg.id);
    chars += size;
    return true;
  };

  // 1. The reader's selection comes first.
  for (const id of context.selection?.segmentIds ?? []) add(id);

  // 2. The current section, trimmed around the selection when long.
  const rows = section?.rows ?? [];
  const selected = new Set(context.selection?.segmentIds ?? []);
  const anchor = Math.max(
    0,
    rows.findIndex((r) => selected.has(r.segmentId)),
  );
  const byDistance = rows.map((r, i) => ({ id: r.segmentId, d: Math.abs(i - anchor) })).sort((a, b) => a.d - b.d);
  for (const { id } of byDistance) if (!add(id)) break;

  // 3. Related passages elsewhere in the book.
  const retriever = createRetriever(index, targetLang);
  const query = `${request.question} ${context.selection?.text ?? ''}`;
  for (const hit of retriever.search(
    query,
    opts.retrieveK ?? 4,
    (segId, nodeId) => used.has(segId) || nodeId === context.nodeId,
  )) {
    if (!add(hit.segmentId)) break;
  }

  // Glossary entries that occur in the question, the selection or the passages.
  const terms = glossaryFor(index, targetLang);
  const haystack = [
    request.question,
    context.selection?.text ?? '',
    ...passages.map((p) => `${p.src} ${p.tgt ?? ''}`),
  ].join('\n');
  const srcMatcher = createGlossaryMatcher(
    terms.map((t) => ({ id: t.id, text: t.src })),
    index.book.sourceLang,
  );
  const tgtMatcher = createGlossaryMatcher(
    terms.map((t) => ({ id: t.id, text: t.tgt })),
    targetLang,
  );
  const found = new Set([...srcMatcher.find(haystack), ...tgtMatcher.find(haystack)].map((m) => m.termId));
  const glossary: ContextGlossaryEntry[] = terms
    .filter((t) => found.has(t.id))
    .map((t) => ({ src: t.src, tgt: t.tgt, ...(t.definition ? { definition: t.definition } : {}) }));

  const title = section ? nodeTitle(index, section.node, targetLang) : { src: '' };
  const history = request.history.slice(-(opts.historyTurns ?? 6));

  return {
    input: {
      question: request.question,
      mode: context.mode,
      ...(context.selection ? { selection: { text: context.selection.text, lang: context.selection.lang } } : {}),
      passages,
      glossary,
      history,
      sourceLang: index.book.sourceLang,
      targetLang,
      book: {
        title: index.book.titles[targetLang] ?? index.book.titles[index.book.sourceLang] ?? '',
        authors: index.book.authors,
      },
      sectionTitle: title.tgt ?? title.src,
      attempt: request.attempt,
    },
    labelMap,
  };
}

const CITATION = /\[(P\d{1,3})\]/g;

/**
 * Converts [Pn] labels in an answer into citations — only labels that were in the context that was
 * actually sent. Unknown labels are dropped (SPEC §12.5).
 */
export function resolveCitations(answer: string, labelMap: Map<string, LabelTarget>): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const m of answer.matchAll(CITATION)) {
    const label = m[1] as string;
    const target = labelMap.get(label);
    if (!target || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, ...target });
  }
  return out;
}

/** Removes citation labels that are not in the label map from display text. */
export function stripUnknownCitations(answer: string, known: Iterable<string>): string {
  const set = new Set(known);
  return answer.replace(CITATION, (full, label: string) => (set.has(label) ? full : '')).replace(/ {2,}/g, ' ');
}
