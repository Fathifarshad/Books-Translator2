import { buildSection, chapterOf, createBookIndex, glossaryFor, nodeTitle, translationCounter } from '@dozabaneh/core';
import type { BookBundle } from '@dozabaneh/shared';
import { getLanguage } from '@dozabaneh/text';

/**
 * The finished book as plain content, in reading order: the one model every «گرفتن خروجی» format is rendered
 * from (Markdown, Word, the printable page). It carries the book's own markup (`*…*`, `` `…` ``, `[^1]`) so that
 * each format can decide what to do with it, and never any HTML.
 */
export type DocRowType = 'heading' | 'paragraph' | 'list_item' | 'quote' | 'caption' | 'footnote' | 'code' | string;

export interface DocRow {
  type: DocRowType;
  src: string;
  tgt: string;
}

export interface DocSection {
  id: string;
  /** Heading of this section, in the target language when it has one. */
  title: string;
  titleSrc: string;
  /** Chapter this section belongs to, when it is not the chapter itself. */
  chapter?: string;
  depth: number;
  rows: DocRow[];
}

export interface DocGlossaryTerm {
  src: string;
  tgt: string;
  definition?: string;
}

export interface BookDocument {
  id: string;
  title: string;
  titleSrc: string;
  authors: string[];
  lang: { src: string; tgt: string; srcDir: 'ltr' | 'rtl'; tgtDir: 'ltr' | 'rtl'; tgtLocale: string };
  sections: DocSection[];
  glossary: DocGlossaryTerm[];
  counts: { done: number; total: number };
  exportedAt: Date;
}

/** Which columns an export carries. */
export type ExportMode = 'target' | 'bilingual' | 'source';
export const EXPORT_MODES: ExportMode[] = ['target', 'bilingual', 'source'];
export const isExportMode = (v: unknown): v is ExportMode => EXPORT_MODES.includes(v as ExportMode);

export function bookDocument(bundle: BookBundle, lang: string, now = new Date()): BookDocument {
  const index = createBookIndex(bundle);
  const src = bundle.book.sourceLang;
  const srcInfo = getLanguage(src);
  const tgtInfo = getLanguage(lang);

  const sections: DocSection[] = [];
  for (const node of index.readingOrder) {
    const section = buildSection(index, node.id, lang);
    if (!section) continue;
    const chapter = chapterOf(index, node.id);
    const chapterTitle = chapter && chapter.id !== node.id ? nodeTitle(index, chapter, lang) : undefined;
    sections.push({
      id: node.id,
      title: section.title.tgt ?? section.title.src,
      titleSrc: section.title.src,
      ...(chapterTitle ? { chapter: chapterTitle.tgt ?? chapterTitle.src } : {}),
      depth: node.depth,
      rows: section.rows.map((r) => ({ type: r.type as DocRowType, src: r.src, tgt: r.tgt ?? '' })),
    });
  }

  const counter = translationCounter(index, lang);
  return {
    id: bundle.book.id,
    title: bundle.book.titles[lang] ?? bundle.book.titles[src] ?? '',
    titleSrc: bundle.book.titles[src] ?? '',
    authors: bundle.book.authors,
    lang: { src, tgt: lang, srcDir: srcInfo.dir, tgtDir: tgtInfo.dir, tgtLocale: tgtInfo.locale },
    sections,
    glossary: glossaryFor(index, lang).map((g) => ({
      src: g.src,
      tgt: g.tgt,
      ...(g.definition ? { definition: g.definition } : {}),
    })),
    counts: { done: counter.done, total: counter.total },
    exportedAt: now,
  };
}

/** The text of a row for a given mode; empty when that mode has nothing to show for it. */
export function rowText(row: DocRow, mode: ExportMode): string {
  if (mode === 'source') return row.src;
  return row.tgt || (mode === 'bilingual' ? '' : row.src);
}
