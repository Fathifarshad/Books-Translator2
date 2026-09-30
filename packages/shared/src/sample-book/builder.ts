import type {
  BookBundle,
  BookRecord,
  GlossaryKind,
  GlossaryTermRecord,
  NodeKind,
  ParentheticalPolicy,
  QaFlag,
  SegmentMeta,
  SegmentRecord,
  SegmentType,
  TocNodeRecord,
  TranslationRecord,
  TranslationStatus,
} from '../domain';

/** One authored row: source text plus its translation per target language. */
export interface RowSpec {
  type: SegmentType;
  src: string;
  tgt?: Record<string, string>;
  meta?: SegmentMeta;
  translatable?: boolean;
  note?: Record<string, string>;
  flags?: Record<string, QaFlag[]>;
  status?: TranslationStatus;
}

export interface NodeSpec {
  key: string;
  kind: NodeKind;
  numberLabel?: string;
  pages: [number, number];
  /** Heading row, if the node has one (chapters borrow it from their intro). */
  heading?: RowSpec;
  rows?: RowSpec[];
  children?: NodeSpec[];
  /** Initial status override for every translation in this node (demo of untranslated sections). */
  status?: TranslationStatus;
}

export interface GlossarySpec {
  key: string;
  src: string;
  tgt: string;
  kind: GlossaryKind;
  definition: string;
  alternatives?: string[];
  parenthetical?: ParentheticalPolicy;
}

export interface BookSpec {
  id: string;
  sourceLang: string;
  targetLang: string;
  meta: Omit<BookRecord, 'id' | 'sourceLang' | 'targetLangs' | 'status' | 'createdAt' | 'updatedAt'>;
  nodes: NodeSpec[];
  glossary: GlossarySpec[];
}

const CREATED_AT = '2025-01-01T00:00:00.000Z';

export const h = (src: string, tgt: string): RowSpec => ({ type: 'heading', src, tgt: { fa: tgt } });
export const p = (src: string, tgt: string, extra: Partial<RowSpec> = {}): RowSpec => ({
  type: 'paragraph',
  src,
  tgt: { fa: tgt },
  ...extra,
});
export const li = (src: string, tgt: string, extra: Partial<RowSpec> = {}): RowSpec => ({
  type: 'list_item',
  src,
  tgt: { fa: tgt },
  meta: { level: 0, ordered: false },
  ...extra,
});
export const q = (src: string, tgt: string): RowSpec => ({ type: 'quote', src, tgt: { fa: tgt } });
export const code = (src: string, codeLang: string): RowSpec => ({
  type: 'code',
  src,
  meta: { codeLang },
  translatable: false,
});
export const figure = (figureId: string): RowSpec => ({
  type: 'figure',
  src: '',
  meta: { figureId },
  translatable: false,
});
export const caption = (figureId: string, src: string, tgt: string): RowSpec => ({
  type: 'caption',
  src,
  tgt: { fa: tgt },
  meta: { figureId },
});
export const footnote = (footnoteId: string, src: string, tgt: string): RowSpec => ({
  type: 'footnote',
  src,
  tgt: { fa: tgt },
  meta: { footnoteId },
});

/** Builds stable, deterministic records from the authored spec. IDs depend only on node keys and order. */
export function buildBundle(spec: BookSpec): BookBundle {
  const nodes: TocNodeRecord[] = [];
  const segments: SegmentRecord[] = [];
  const translations: TranslationRecord[] = [];
  const short = spec.id.replace(/^bk_/, '');

  const addRow = (row: RowSpec, nodeId: string, ord: number, page: number, inherited?: TranslationStatus) => {
    const id = `sg_${short}_${nodeId.split('_').pop()}_${String(ord).padStart(2, '0')}`;
    const translatable = row.translatable ?? true;
    segments.push({
      id,
      bookId: spec.id,
      nodeId,
      ord,
      type: row.type,
      src: row.src,
      page,
      pageEnd: page,
      meta: row.meta ?? {},
      translatable,
    });
    if (!translatable) return id;
    for (const [lang, text] of Object.entries(row.tgt ?? {})) {
      const flags = row.flags?.[lang] ?? [];
      const status = inherited ?? row.status ?? (flags.length > 0 ? 'flagged' : 'final');
      translations.push({
        segmentId: id,
        lang,
        text,
        status,
        engine: 'seed',
        ...(row.note?.[lang] ? { note: row.note[lang] } : {}),
        flags,
        confidence: flags.length > 0 ? 0.62 : 0.95,
        version: 1,
        updatedAt: CREATED_AT,
      });
    }
    return id;
  };

  const visit = (node: NodeSpec, parentId: string | null, depth: number, ord: number) => {
    const id = `nd_${short}_${node.key}`;
    const record: TocNodeRecord = {
      id,
      bookId: spec.id,
      parentId,
      ord,
      depth,
      kind: node.kind,
      ...(node.numberLabel ? { numberLabel: node.numberLabel } : {}),
      pageStart: node.pages[0],
      pageEnd: node.pages[1],
      skip: false,
      origin: 'outline',
    };
    nodes.push(record);
    const rows = [...(node.heading ? [node.heading] : []), ...(node.rows ?? [])];
    const span = Math.max(1, node.pages[1] - node.pages[0] + 1);
    rows.forEach((row, i) => {
      const page = node.pages[0] + Math.min(span - 1, Math.floor((i / Math.max(1, rows.length)) * span));
      const segId = addRow(row, id, i, page, node.status);
      if (i === 0 && node.heading) record.headingSegmentId = segId;
    });
    node.children?.forEach((child, i) => {
      visit(child, id, depth + 1, i);
      // A chapter's title is the heading row of its intro.
      if (node.kind === 'chapter' && child.kind === 'chapter_intro' && child.heading) {
        const childNode = nodes.find((n) => n.id === `nd_${short}_${child.key}`);
        if (childNode?.headingSegmentId) record.headingSegmentId = childNode.headingSegmentId;
      }
    });
  };
  for (const [i, n] of spec.nodes.entries()) visit(n, null, 0, i);

  const glossary: GlossaryTermRecord[] = spec.glossary.map((g) => ({
    id: `gt_${short}_${g.key}`,
    bookId: spec.id,
    srcLang: spec.sourceLang,
    tgtLang: spec.targetLang,
    src: g.src,
    tgt: g.tgt,
    alternatives: g.alternatives ?? [],
    definition: g.definition,
    kind: g.kind,
    parenthetical: g.parenthetical ?? 'first_in_chapter',
    status: 'approved',
  }));

  return {
    book: {
      id: spec.id,
      sourceLang: spec.sourceLang,
      targetLangs: [spec.targetLang],
      status: 'ready',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      ...spec.meta,
    },
    nodes,
    segments,
    translations,
    glossary,
  };
}
