import type { NodeKind, SegmentMeta, SegmentType } from '@dozabaneh/shared';

/** A run of text with one style on one line. Coordinates are in PDF points, y measured from the page top. */
export interface TextRun {
  text: string;
  x: number;
  width: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  /** Raised, smaller text (footnote markers). */
  sup: boolean;
}

export interface Line {
  page: number;
  /** Baseline distance from the page top. */
  y: number;
  x0: number;
  x1: number;
  /** Dominant font size (by characters). */
  size: number;
  runs: TextRun[];
  text: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageData {
  index: number;
  width: number;
  height: number;
  lines: Line[];
  images: Box[];
  /** The text of this page was recognized with OCR (scanned page). */
  ocr?: boolean;
}

export interface OutlineEntry {
  title: string;
  pageIndex: number | null;
  /** Destination top (distance from the page top) when the destination has one. */
  top: number | null;
  children: OutlineEntry[];
}

export interface ExtractedBook {
  meta: { title?: string; author?: string; subject?: string; producer?: string };
  pageCount: number;
  /** Printed page labels by page index, when the PDF defines them. */
  pageLabels: string[] | null;
  outline: OutlineEntry[];
  pages: PageData[];
  /** OCR language, and whether its engine was available (null: no page needed OCR). */
  ocr?: { lang: string | null; available: boolean | null };
}

export type BlockType = 'heading' | 'paragraph' | 'list_item' | 'quote' | 'code' | 'caption' | 'footnote' | 'figure';

export interface Block {
  type: BlockType;
  page: number;
  pageEnd: number;
  /** Column index on the page (0 for single-column pages). */
  column: number;
  /** Top of the first line (y from the page top). */
  y: number;
  x0: number;
  x1: number;
  size: number;
  lines: Line[];
  /** Text with inline markup (SPEC §7.2). */
  text: string;
  bold: boolean;
  /** First-line indent relative to the column's left edge. */
  indent: number;
  meta: SegmentMeta;
  /** Number of continuations merged into this block (across page/column breaks). */
  merged?: number;
  /** Number of line-end hyphens removed while joining lines. */
  dehyphenated?: number;
  /** x where a list item's text starts (after the marker) — continuation lines hang here. */
  textX?: number;
  box?: Box;
}

export interface StructNode {
  key: string;
  parentKey: string | null;
  kind: NodeKind;
  depth: number;
  numberLabel?: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  skip: boolean;
  origin: 'outline' | 'heuristic' | 'manual';
  /** Index into `segments` of the heading segment, if any. */
  headingIndex?: number;
}

export interface StructSegment {
  nodeKey: string;
  type: SegmentType;
  src: string;
  page: number;
  pageEnd: number;
  meta: SegmentMeta & { bbox?: Box; synthetic?: boolean };
  translatable: boolean;
}

export interface ExtractionReport {
  stats: {
    pages: number;
    pagesWithoutText: number;
    /** Pages read with OCR (scanned pages). */
    ocrPages: number;
    words: number;
    chapters: number;
    sections: number;
    segments: number;
    segmentsByType: Record<string, number>;
    mergedContinuations: number;
    dehyphenated: number;
    removedHeaderFooterLines: number;
    paragraphs: number;
    suspectedBreaks: number;
    suspectedBreakRatio: number;
  };
  structureSource: 'outline' | 'contents' | 'headings';
  warnings: { code: string; message: string; pages?: number[] }[];
}

export interface BookStructure {
  meta: { title: string; authors: string[] };
  pageLabels: string[];
  nodes: StructNode[];
  segments: StructSegment[];
  report: ExtractionReport;
}
