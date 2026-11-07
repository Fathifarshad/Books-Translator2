import { diffWords, stripMarkup } from '@dozabaneh/text';
import type { BookIndex } from './book';
import { locationPath } from './pipeline/plan';

/**
 * The errata list («فایل سوتی», ADR-045): every correction the edit made to a book, where it is, what it was, what
 * it became and why. The word diff between the text before the edit and the text now is the ground truth — an
 * engine may describe a change it did not make, or make one it did not describe — and the engine's own `changes`
 * only supply the type and reason of the corrections that really happened.
 */
export interface EditChange {
  type: string;
  before: string;
  after: string;
  reason: string;
}

/** One segment's text before the edit (the original, or the translation draft) and now. */
export interface ErrataSource {
  segmentId: string;
  before: string;
  after: string;
  changes: EditChange[];
}

export interface ErrataEntry {
  /** Running number in the list (1-based). */
  n: number;
  segmentId: string;
  nodeId: string;
  /** Chapter › section path. */
  location: string[];
  /** Printed page label of the segment (falls back to the PDF page number). */
  page: string;
  /** Paragraph number inside its section (headings not counted; 0 for a heading). */
  paragraph: number;
  before: string;
  after: string;
  type: string;
  reason: string;
  /** The words around the correction in the text before the edit, for finding it on the page. */
  context: string;
}

export interface Errata {
  entries: ErrataEntry[];
  /**
   * Corrections repeated all over a book that one line describes better than hundreds — today: Arabic letter
   * forms («ي، ك») replaced by the target language's own. Counted, not listed.
   */
  systematic: { type: 'characters'; count: number }[];
  /** Segments that changed. */
  segments: number;
}

/** Letters that look the same but are different code points (Arabic ي/ك/ى versus Persian ی/ک). */
const LOOKALIKES: Record<string, string> = { ي: 'ی', ى: 'ی', ك: 'ک', ة: 'ه' };
const canonical = (s: string) => s.replace(/[يىكة]/gu, (c) => LOOKALIKES[c] ?? c);
const squash = (s: string) => s.replace(/[\s‌]+/gu, ' ').trim();

interface Hunk {
  before: string;
  after: string;
  /** Character offset of `before` in the old text. */
  at: number;
}

/** Word-diff hunks: each run of deletions/insertions between unchanged words. */
export function diffHunks(before: string, after: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let offset = 0;
  for (const op of diffWords(before, after)) {
    if (op.type === 'equal') {
      // A change separated from the next only by a space is still one correction («می شود» → «می‌شود»).
      if (cur && !op.text.trim()) {
        cur.before += op.text;
        cur.after += op.text;
      } else if (cur) {
        hunks.push(cur);
        cur = null;
      }
      offset += op.text.length;
      continue;
    }
    cur ??= { before: '', after: '', at: offset };
    if (op.type === 'delete') {
      cur.before += op.text;
      offset += op.text.length;
    } else cur.after += op.text;
  }
  if (cur) hunks.push(cur);
  return hunks
    .map((h) => ({ ...h, before: h.before.trim(), after: h.after.trim() }))
    .filter((h) => h.before !== h.after);
}

/** The engine change that describes a hunk: overlapping fragments on either side, each change used once. */
function describe(h: Hunk, changes: EditChange[], used: Set<EditChange>): EditChange | undefined {
  const overlaps = (a: string, b: string) => {
    const x = squash(a);
    const y = squash(b);
    return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
  };
  return changes.find(
    (c) => !used.has(c) && (overlaps(c.after, h.after) || (overlaps(c.before, h.before) && h.before.length > 0)),
  );
}

function contextOf(text: string, at: number, length: number, radius = 40): string {
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Builds the errata list of a book in document order. */
export function buildErrata(index: BookIndex, lang: string, sources: ErrataSource[]): Errata {
  const bySegment = new Map(sources.map((s) => [s.segmentId, s]));
  const labels = index.book.pageLabels;
  const entries: ErrataEntry[] = [];
  let characters = 0;
  let segments = 0;
  for (const node of index.nodes) {
    let paragraph = 0;
    for (const seg of index.segmentsByNode.get(node.id) ?? []) {
      if (seg.type !== 'heading') paragraph++;
      const src = bySegment.get(seg.id);
      if (!src) continue;
      const before = stripMarkup(src.before);
      const after = stripMarkup(src.after);
      if (before === after) continue;
      const hunks = diffHunks(before, after);
      if (hunks.length === 0) continue;
      segments++;
      const used = new Set<EditChange>();
      for (const h of hunks) {
        if (canonical(h.before) === canonical(h.after)) {
          characters++;
          continue;
        }
        const change = describe(h, src.changes, used);
        if (change) used.add(change);
        entries.push({
          n: entries.length + 1,
          segmentId: seg.id,
          nodeId: node.id,
          location: locationPath(index, node.id, lang),
          page: labels[seg.page] || String(seg.page + 1),
          paragraph: seg.type === 'heading' ? 0 : paragraph,
          before: h.before,
          after: h.after,
          type: change?.type ?? 'other',
          reason: change?.reason ?? '',
          context: contextOf(before, h.at, h.before.length),
        });
      }
    }
  }
  return { entries, systematic: characters ? [{ type: 'characters', count: characters }] : [], segments };
}
