import type {
  BookBundle,
  BookRecord,
  GlossaryTermRecord,
  NodeKind,
  QaFlag,
  SegmentMeta,
  SegmentRecord,
  SegmentType,
  TocNodeRecord,
  TranslationRecord,
  TranslationStatus,
} from '@dozabaneh/shared';

/** Statuses whose text is shown to readers (drafts are shown too, with a status indicator). */
const VISIBLE: ReadonlySet<TranslationStatus> = new Set(['drafted', 'edited', 'final', 'flagged', 'user_edited']);
/** Statuses that count as done for the progress counter (SPEC §9.1). */
const DONE: ReadonlySet<TranslationStatus> = new Set(['final', 'user_edited']);
const READABLE: ReadonlySet<NodeKind> = new Set(['front', 'chapter_intro', 'section', 'subsection', 'back']);

export type NodeTranslationStatus = 'final' | 'in_progress' | 'not_started' | 'needs_review' | 'waiting_agent';

export interface BookIndex {
  book: BookRecord;
  nodes: TocNodeRecord[];
  nodeById: Map<string, TocNodeRecord>;
  childrenOf: Map<string | null, TocNodeRecord[]>;
  segmentById: Map<string, SegmentRecord>;
  segmentsByNode: Map<string, SegmentRecord[]>;
  /** key: `${segmentId}|${lang}` */
  translations: Map<string, TranslationRecord>;
  glossary: GlossaryTermRecord[];
  /** Readable nodes in document order (prev/next navigation). */
  readingOrder: TocNodeRecord[];
}

const tKey = (segmentId: string, lang: string) => `${segmentId}|${lang}`;

/**
 * Readable nodes hold text: front/back matter, chapter intros, sections — and chapters or parts that
 * have no child nodes (a chapter without sections is read as one unit).
 */
export function isReadable(node: TocNodeRecord, hasChildren = false): boolean {
  if (node.skip) return false;
  return READABLE.has(node.kind) || ((node.kind === 'chapter' || node.kind === 'part') && !hasChildren);
}

const hasKids = (index: Pick<BookIndex, 'childrenOf'>, id: string) => (index.childrenOf.get(id)?.length ?? 0) > 0;

/**
 * Builds lookup maps for a book. `overrides` (user edits, live pipeline updates) replace the bundle's
 * translation for the same segment + language.
 */
export function createBookIndex(bundle: BookBundle, overrides: TranslationRecord[] = []): BookIndex {
  const nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, TocNodeRecord[]>();
  for (const n of bundle.nodes) {
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n);
    childrenOf.set(n.parentId, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.ord - b.ord);

  const segmentsByNode = new Map<string, SegmentRecord[]>();
  for (const s of bundle.segments) {
    const list = segmentsByNode.get(s.nodeId) ?? [];
    list.push(s);
    segmentsByNode.set(s.nodeId, list);
  }
  for (const list of segmentsByNode.values()) list.sort((a, b) => a.ord - b.ord);

  const translations = new Map<string, TranslationRecord>();
  for (const t of bundle.translations) translations.set(tKey(t.segmentId, t.lang), t);
  for (const t of overrides) translations.set(tKey(t.segmentId, t.lang), t);

  const readingOrder: TocNodeRecord[] = [];
  const walk = (parentId: string | null) => {
    for (const n of childrenOf.get(parentId) ?? []) {
      if (isReadable(n, (childrenOf.get(n.id)?.length ?? 0) > 0)) readingOrder.push(n);
      walk(n.id);
    }
  };
  walk(null);

  return {
    book: bundle.book,
    nodes: bundle.nodes,
    nodeById,
    childrenOf,
    segmentById: new Map(bundle.segments.map((s) => [s.id, s])),
    segmentsByNode,
    translations,
    glossary: bundle.glossary,
    readingOrder,
  };
}

export function getTranslation(index: BookIndex, segmentId: string, lang: string): TranslationRecord | undefined {
  return index.translations.get(tKey(segmentId, lang));
}

/** Translated text if it is visible to readers, else undefined. */
export function visibleTranslation(index: BookIndex, segmentId: string, lang: string): string | undefined {
  const t = getTranslation(index, segmentId, lang);
  return t && VISIBLE.has(t.status) ? t.text : undefined;
}

export function chapterOf(index: BookIndex, nodeId: string): TocNodeRecord | undefined {
  let node = index.nodeById.get(nodeId);
  while (node) {
    if (node.kind === 'chapter') return node;
    node = node.parentId ? index.nodeById.get(node.parentId) : undefined;
  }
  return undefined;
}

export interface Title {
  src: string;
  tgt?: string;
}

export function nodeTitle(index: BookIndex, node: TocNodeRecord, lang: string): Title {
  const seg = node.headingSegmentId ? index.segmentById.get(node.headingSegmentId) : undefined;
  if (!seg) return { src: node.title ?? '' };
  const tgt = visibleTranslation(index, seg.id, lang);
  return tgt ? { src: seg.src, tgt } : { src: seg.src };
}

/** First readable node at or below `nodeId` (chapters open at their intro). */
export function firstReadable(index: BookIndex, nodeId: string): TocNodeRecord | undefined {
  const node = index.nodeById.get(nodeId);
  if (!node) return undefined;
  if (isReadable(node, hasKids(index, node.id))) return node;
  for (const child of index.childrenOf.get(node.id) ?? []) {
    const found = firstReadable(index, child.id);
    if (found) return found;
  }
  return undefined;
}

function translatableSegmentsUnder(index: BookIndex, nodeId: string): SegmentRecord[] {
  const out: SegmentRecord[] = [...(index.segmentsByNode.get(nodeId) ?? []).filter((s) => s.translatable)];
  for (const child of index.childrenOf.get(nodeId) ?? []) {
    if (!child.skip) out.push(...translatableSegmentsUnder(index, child.id));
  }
  return out;
}

export function nodeStatus(index: BookIndex, nodeId: string, lang: string): NodeTranslationStatus {
  const segs = translatableSegmentsUnder(index, nodeId);
  if (segs.length === 0) return 'final';
  let done = 0;
  let started = 0;
  let flagged = false;
  let waitingAgent = false;
  for (const s of segs) {
    const t = getTranslation(index, s.id, lang);
    if (!t) continue;
    if (t.status === 'flagged') flagged = true;
    if (t.status === 'queued' && t.engine === 'agent') waitingAgent = true;
    if (DONE.has(t.status) || t.status === 'skipped') done++;
    if (t.status !== 'pending') started++;
  }
  if (flagged) return 'needs_review';
  if (done === segs.length) return 'final';
  if (waitingAgent) return 'waiting_agent';
  return started === 0 ? 'not_started' : 'in_progress';
}

export interface Counter {
  done: number;
  total: number;
}

/** Segments with status `final` or `user_edited` out of all translatable, non-skipped segments. */
export function translationCounter(index: BookIndex, lang: string): Counter {
  let done = 0;
  let total = 0;
  for (const s of index.segmentById.values()) {
    if (!s.translatable) continue;
    const node = index.nodeById.get(s.nodeId);
    if (node?.skip) continue;
    const t = getTranslation(index, s.id, lang);
    if (t?.status === 'skipped') continue;
    total++;
    if (t && DONE.has(t.status)) done++;
  }
  return { done, total };
}

export interface TocEntry {
  id: string;
  kind: NodeKind;
  numberLabel?: string;
  title: Title;
  status: NodeTranslationStatus;
  readable: boolean;
  /** The readable node opened when this entry is clicked. */
  targetId?: string;
  children: TocEntry[];
}

export function buildToc(index: BookIndex, lang: string): TocEntry[] {
  const build = (parentId: string | null): TocEntry[] =>
    (index.childrenOf.get(parentId) ?? [])
      .filter((n) => !n.skip)
      .map((n) => {
        const target = firstReadable(index, n.id);
        return {
          id: n.id,
          kind: n.kind,
          ...(n.numberLabel ? { numberLabel: n.numberLabel } : {}),
          title: nodeTitle(index, n, lang),
          status: nodeStatus(index, n.id, lang),
          readable: isReadable(n, hasKids(index, n.id)),
          ...(target ? { targetId: target.id } : {}),
          children: build(n.id),
        };
      });
  return build(null);
}

export interface SectionRow {
  segmentId: string;
  type: SegmentType;
  src: string;
  tgt?: string;
  status: TranslationStatus | 'untranslatable';
  note?: string;
  flags: QaFlag[];
  meta: SegmentMeta;
  page: number;
  /** 1-based paragraph number within the section (headings excluded) — used for «بند ۴» chips. */
  paragraphNumber: number;
}

export interface SectionPayload {
  node: TocNodeRecord;
  title: Title;
  chapter?: { id: string; numberLabel?: string; title: Title };
  pageLabels: { from: string; to: string };
  rows: SectionRow[];
  status: NodeTranslationStatus;
  prevId?: string;
  nextId?: string;
  /** True when this is the last readable node of its chapter (end-of-chapter card). */
  endsChapter: boolean;
}

export function buildSection(index: BookIndex, nodeId: string, lang: string): SectionPayload | undefined {
  const node = index.nodeById.get(nodeId);
  if (!node || !isReadable(node, hasKids(index, node.id))) return undefined;
  const chapter = chapterOf(index, nodeId);
  const pos = index.readingOrder.findIndex((n) => n.id === nodeId);
  const prev = index.readingOrder[pos - 1];
  const next = index.readingOrder[pos + 1];
  const labels = index.book.pageLabels;

  let paragraphNumber = 0;
  const rows: SectionRow[] = (index.segmentsByNode.get(nodeId) ?? []).map((s) => {
    if (s.type !== 'heading') paragraphNumber++;
    const t = getTranslation(index, s.id, lang);
    const tgt = t && VISIBLE.has(t.status) ? t.text : undefined;
    return {
      segmentId: s.id,
      type: s.type,
      src: s.src,
      ...(tgt !== undefined ? { tgt } : {}),
      status: s.translatable ? (t?.status ?? 'pending') : 'untranslatable',
      ...(t?.note ? { note: t.note } : {}),
      flags: t?.flags ?? [],
      meta: s.meta,
      page: s.page,
      paragraphNumber: s.type === 'heading' ? 0 : paragraphNumber,
    };
  });

  const nextChapter = next ? chapterOf(index, next.id) : undefined;
  return {
    node,
    title: nodeTitle(index, node, lang),
    ...(chapter
      ? {
          chapter: {
            id: chapter.id,
            ...(chapter.numberLabel ? { numberLabel: chapter.numberLabel } : {}),
            title: nodeTitle(index, chapter, lang),
          },
        }
      : {}),
    pageLabels: {
      from: labels[node.pageStart] ?? String(node.pageStart + 1),
      to: labels[node.pageEnd] ?? String(node.pageEnd + 1),
    },
    rows,
    status: nodeStatus(index, nodeId, lang),
    ...(prev ? { prevId: prev.id } : {}),
    ...(next ? { nextId: next.id } : {}),
    endsChapter: Boolean(chapter) && nextChapter?.id !== chapter?.id,
  };
}

/** Glossary terms (approved/locked) for one target language. */
export function glossaryFor(index: BookIndex, lang: string): GlossaryTermRecord[] {
  return index.glossary.filter((g) => g.tgtLang === lang && g.status !== 'proposed');
}
