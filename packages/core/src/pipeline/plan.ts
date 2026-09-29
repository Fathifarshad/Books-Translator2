import type { AgentTask, ItemType, SegmentRecord, SegmentType } from '@dozabaneh/shared';
import { applyFirstMentions, countWords, type ParentheticalEntry, stripMarkup } from '@dozabaneh/text';
import { type BookIndex, nodeTitle } from '../book';

/**
 * Pipeline planning (SPEC §9.1, §9.4, §9.6): which segments are translated, how a section is cut into translate
 * chunks and edit units, queue priorities, and the per-chapter state that flows between chunks.
 */
export const ITEM_TYPES_BY_SEGMENT: Partial<Record<SegmentType, ItemType>> = {
  heading: 'h',
  paragraph: 'p',
  list_item: 'li',
  quote: 'q',
  caption: 'cap',
  footnote: 'fn',
};

/** Text segments are translated; code, figures, tables, equations and separators keep their source. */
export function needsTranslation(segment: Pick<SegmentRecord, 'type' | 'translatable'>): boolean {
  return segment.translatable && ITEM_TYPES_BY_SEGMENT[segment.type] !== undefined;
}

export interface ChunkOptions {
  lang: string;
  /** Upper bound per chunk; a single longer segment forms its own chunk. */
  maxWords: number;
}

export const TRANSLATE_CHUNK_WORDS = 2500;
export const EDIT_UNIT_WORDS = 3000;

/**
 * Cuts consecutive segments of one section into chunks of at most `maxWords` source words, never splitting a
 * segment. Callers pass one section at a time, so chunks never cross a section boundary.
 */
export function chunkSegments<T extends { src: string }>(segments: T[], opts: ChunkOptions): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let words = 0;
  for (const s of segments) {
    const n = countWords(stripMarkup(s.src), opts.lang);
    if (current.length > 0 && words + n > opts.maxWords) {
      chunks.push(current);
      current = [];
      words = 0;
    }
    current.push(s);
    words += n;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Short item keys ("01", "02", …) used in batches instead of database ids (SPEC §9.4). */
export function itemKeys(n: number): string[] {
  const width = Math.max(2, String(n).length);
  return Array.from({ length: n }, (_, i) => String(i + 1).padStart(width, '0'));
}

/** Queue priority: higher runs first (SPEC §10.3-3); prioritized sections jump ahead of document order. */
export const TASK_PRIORITY: Record<AgentTask, number> = {
  tutor_answer: 1000,
  summary: 900,
  quiz: 900,
  brief: 800,
  glossary: 700,
  translate: 100,
  edit: 100,
};
export const PRIORITY_BOOST = 500;

export function taskPriority(task: AgentTask, prioritized = false): number {
  return TASK_PRIORITY[task] + (prioritized && (task === 'translate' || task === 'edit') ? PRIORITY_BOOST : 0);
}

/** Chapter/section path of a node in the target language when translated (source otherwise). */
export function locationPath(index: BookIndex, nodeId: string, lang: string): string[] {
  const path: string[] = [];
  let node = index.nodeById.get(nodeId);
  while (node) {
    if (node.kind !== 'chapter_intro') {
      const t = nodeTitle(index, node, lang);
      const text = t.tgt ?? t.src;
      if (text) path.unshift(text);
    }
    node = node.parentId ? index.nodeById.get(node.parentId) : undefined;
  }
  return path;
}

/**
 * Source terms whose first-mention parenthetical already appeared in the given (earlier) texts of a chapter —
 * the `alreadyIntroduced` list of the next translate chunk.
 */
export function introducedIn(
  texts: { key: string; text: string; type?: string }[],
  entries: ParentheticalEntry[],
  tgtLang: string,
): string[] {
  return applyFirstMentions(
    texts,
    entries.filter((e) => e.policy === 'first_in_chapter'),
    tgtLang,
  ).introduced;
}

/** Normalized source text for translation memory: identical segments reuse the same translation (SPEC §9.9). */
export function memoryKey(src: string): string {
  return src.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
