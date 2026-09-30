/**
 * Domain records (SPEC §7.1). IDs are prefixed and never change once created.
 * These shapes are shared by the web client, the API and (later) the mobile app.
 */
export const NODE_KINDS = ['front', 'part', 'chapter', 'chapter_intro', 'section', 'subsection', 'back'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const SEGMENT_TYPES = [
  'heading',
  'paragraph',
  'list_item',
  'quote',
  'code',
  'caption',
  'footnote',
  'table',
  'equation',
  'figure',
  'separator',
] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export const TRANSLATION_STATUSES = [
  'pending',
  'queued',
  'drafted',
  'edited',
  'final',
  'flagged',
  'user_edited',
  'skipped',
] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

export type BookStatus =
  | 'uploaded'
  | 'ingesting'
  | 'structure_review'
  | 'ready_to_translate'
  | 'translating'
  | 'ready'
  | 'failed';

export interface BookRecord {
  id: string;
  sourceLang: string;
  targetLangs: string[];
  /** Title per language code (source language always present). */
  titles: Record<string, string>;
  subtitles?: Record<string, string>;
  authors: string[];
  publisher?: string;
  year?: number;
  pageCount: number;
  /** Printed page labels by physical page index (e.g. "vi", "18"). */
  pageLabels: string[];
  status: BookStatus;
  /** Target-language brief used by every prompt (SPEC §9.2). */
  brief?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface TocNodeRecord {
  id: string;
  bookId: string;
  parentId: string | null;
  ord: number;
  depth: number;
  kind: NodeKind;
  numberLabel?: string;
  headingSegmentId?: string;
  /** Title for nodes without a heading segment (e.g. cover pages before the first outline entry). */
  title?: string;
  pageStart: number;
  pageEnd: number;
  skip: boolean;
  origin: 'outline' | 'heuristic' | 'manual';
}

export interface SegmentMeta {
  /** list_item: nesting level (0-based), ordered list, printed marker. */
  level?: number;
  ordered?: boolean;
  marker?: string;
  /** footnote: the id used by `[^id]` references. */
  footnoteId?: string;
  /** figure / caption: the id used by `[[fig:id]]`. */
  figureId?: string;
  /** code: programming language, for display only. */
  codeLang?: string;
}

export interface SegmentRecord {
  id: string;
  bookId: string;
  nodeId: string;
  ord: number;
  type: SegmentType;
  src: string;
  page: number;
  pageEnd: number;
  meta: SegmentMeta;
  translatable: boolean;
}

export type FlagSeverity = 'low' | 'medium' | 'high';

export interface QaFlag {
  code: string;
  severity: FlagSeverity;
  reason: string;
}

export interface TranslationRecord {
  segmentId: string;
  lang: string;
  text: string;
  status: TranslationStatus;
  engine: string;
  note?: string;
  flags: QaFlag[];
  confidence?: number;
  version: number;
  updatedAt: string;
}

export type GlossaryKind = 'concept' | 'term' | 'person' | 'org' | 'place' | 'work' | 'acronym';
export type ParentheticalPolicy = 'first_in_chapter' | 'always' | 'never';

export interface GlossaryTermRecord {
  id: string;
  bookId: string | null;
  srcLang: string;
  tgtLang: string;
  src: string;
  tgt: string;
  alternatives: string[];
  definition?: string;
  kind: GlossaryKind;
  parenthetical: ParentheticalPolicy;
  status: 'proposed' | 'approved' | 'locked';
}

/** A complete book in memory (seed data today, API payloads later). */
export interface BookBundle {
  book: BookRecord;
  nodes: TocNodeRecord[];
  segments: SegmentRecord[];
  translations: TranslationRecord[];
  glossary: GlossaryTermRecord[];
}
