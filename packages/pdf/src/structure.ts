import type { NodeKind } from '@dozabaneh/shared';
import { stripMarkup } from '@dozabaneh/text';
import { normTitle, titleSimilarity } from './similarity';
import type { Block, ExtractedBook, OutlineEntry, StructNode, StructSegment } from './types';

export type StructureSource = 'outline' | 'contents' | 'headings';

interface Entry {
  title: string;
  depth: number;
  pageIndex: number;
  top: number | null;
  origin: 'outline' | 'heuristic';
}

const FRONT =
  /^(?:(?:table of )?contents|copyright|dedication|(?:series )?foreword|preface|acknowledg(?:e)?ments?|introduction|prologue|epigraph|about this book|list of (?:figures|tables|illustrations)|abbreviations|title page|half title)\b/i;
const BACK =
  /^(?:epilogue|afterword|conclusion|appendix|appendices|notes|endnotes|glossary|bibliography|references|works cited|further reading|index|about the authors?|credits|acknowledg(?:e)?ments?|colophon)\b/i;
/** Translated by default except these (SPEC §8.6-5): our TOC, search and glossary replace them. */
const SKIP_BY_DEFAULT =
  /^(?:(?:table of )?contents|copyright|index|bibliography|references|works cited|title page|half title)\b/i;
const CHAPTER_LABEL =
  /^(?:chapter|ch\.?)\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[\s.:—–-]*/i;
const PART_LABEL = /^part\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b[\s.:—–-]*/i;
const LEADING_NUMBER = /^(\d{1,3})(?:[.:)]|\s)\s*(?=\p{L})/u;
const WORD_NUMBERS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
};

function flattenOutline(outline: OutlineEntry[]): Entry[] {
  const out: Entry[] = [];
  const walk = (items: OutlineEntry[], depth: number) => {
    for (const o of items) {
      if (o.pageIndex !== null && o.title)
        out.push({ title: o.title, depth, pageIndex: o.pageIndex, top: o.top, origin: 'outline' });
      walk(o.children, depth + 1);
    }
  };
  walk(outline, 0);
  return out;
}

const CONTENTS_TITLE = /^(?:table of )?contents$/i;
const CONTENTS_ENTRY = /^(.*?\S)\s*(?:[.·…_ ]{2,}|\s)\s*(\d{1,4}|[ivxlcdm]{1,7})$/i;

/**
 * No outline: parse a printed Contents page (titles + page numbers) and map printed numbers to page
 * indexes through the page labels (from the PDF, or inferred from printed page numbers).
 */
export function contentsEntries(blocks: Block[], labels: string[], maxPage: number): Entry[] {
  const titleBlock = blocks.find((b) => b.page <= maxPage && CONTENTS_TITLE.test(b.text.trim()));
  if (!titleBlock) return [];
  const lines = blocks
    .filter(
      (b) => b.page >= titleBlock.page && b.page <= titleBlock.page + 1 && b !== titleBlock && b.type !== 'figure',
    )
    .flatMap((b) => b.lines);
  const rows = lines
    .map((l) => ({ l, m: CONTENTS_ENTRY.exec(l.text.trim()) }))
    .filter((r): r is { l: (typeof lines)[number]; m: RegExpExecArray } => r.m !== null);
  if (rows.length < 2) return [];
  const minX = Math.min(...rows.map((r) => r.l.x0));
  const entries: Entry[] = [];
  for (const { l, m } of rows) {
    const title = (m[1] as string).replace(/[.·…_\s]+$/, '').trim();
    const label = m[2] as string;
    const pageIndex = labels.findIndex((x, i) => i > titleBlock.page && x.toLowerCase() === label.toLowerCase());
    if (pageIndex < 0 || !title) continue;
    entries.push({ title, depth: l.x0 - minX > l.size * 0.8 ? 1 : 0, pageIndex, top: null, origin: 'heuristic' });
  }
  return entries;
}

/** No outline and no Contents page: headings ranked by font size (+ numbering patterns). */
export function headingEntries(blocks: Block[]): Entry[] {
  const headings = blocks.filter((b) => b.type === 'heading');
  const sizes = [...new Set(headings.map((h) => Math.round(h.size * 2) / 2))].sort((a, b) => b - a);
  return headings.map((h) => {
    const text = h.text.trim();
    const rank = sizes.indexOf(Math.round(h.size * 2) / 2);
    let depth = Math.min(2, Math.max(0, rank));
    if (CHAPTER_LABEL.test(text) || PART_LABEL.test(text)) depth = 0;
    const dotted = /^(\d+(?:\.\d+)+)\s/.exec(text);
    if (dotted) depth = Math.min(2, (dotted[1] as string).split('.').length - 1);
    return { title: text, depth, pageIndex: h.page, top: h.y, origin: 'heuristic' as const };
  });
}

interface Cut {
  entry: Entry;
  index: number;
  heading: number[];
}

/** Finds where each entry starts: the printed heading that matches its title (≥ 0.85), else its page/top. */
function locate(entries: Entry[], blocks: Block[]): Cut[] {
  const cuts: Cut[] = [];
  let floor = 0;
  for (const entry of entries) {
    let best: { index: number; heading: number[]; score: number } | null = null;
    for (let i = floor; i < blocks.length; i++) {
      const b = blocks[i] as Block;
      if (b.page > entry.pageIndex + 1) break;
      if (b.page < entry.pageIndex) continue;
      if (entry.top !== null && b.page === entry.pageIndex && b.y + b.size * 2 < entry.top) continue;
      const words = b.text.split(/\s+/).length;
      if (b.type !== 'heading' && words > 20) continue;
      // Printed headings beat other short lines with the same words (e.g. a leftover running head).
      const penalty = b.type === 'heading' ? 0 : 0.1;
      const one = titleSimilarity(entry.title, stripMarkup(b.text)) - penalty;
      const next = blocks[i + 1];
      const two =
        next && next.page === b.page && (next.type === 'heading' || b.type === 'heading')
          ? titleSimilarity(entry.title, stripMarkup(`${b.text} ${next.text}`)) - penalty
          : 0;
      const score = Math.max(one, two);
      if (score >= 0.85 && (!best || score > best.score + 0.02)) {
        best = { index: i, heading: two > one ? [i, i + 1] : [i], score };
        if (score > 0.97) break;
      }
    }
    if (best) {
      cuts.push({ entry, index: best.index, heading: best.heading });
      floor = best.index + best.heading.length;
      continue;
    }
    let index = blocks.findIndex(
      (b, i) =>
        i >= floor &&
        (b.page > entry.pageIndex || (b.page === entry.pageIndex && (entry.top === null || b.y + b.size >= entry.top))),
    );
    if (index < 0) index = blocks.length;
    cuts.push({ entry, index, heading: [] });
    floor = index;
  }
  return cuts;
}

function classify(entries: Entry[]): NodeKind[] {
  const top = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.depth === 0);
  const isMatter = (t: string) => FRONT.test(t) || BACK.test(t);
  const firstBody = top.find(({ e }) => !isMatter(e.title));
  const lastBody = [...top].reverse().find(({ e }) => !isMatter(e.title));
  const hasPartChildren = (i: number) => {
    const e = entries[i] as Entry;
    const child = entries[i + 1];
    return PART_LABEL.test(e.title) && child !== undefined && child.depth === e.depth + 1;
  };
  let partShift = false;
  return entries.map((e, i) => {
    if (e.depth === 0) {
      partShift = hasPartChildren(i);
      if (partShift) return 'part';
      if (isMatter(e.title)) {
        if (!firstBody || i < firstBody.i) return 'front';
        if (!lastBody || i > lastBody.i) return 'back';
        return FRONT.test(e.title) && /^introduction/i.test(e.title)
          ? 'chapter'
          : BACK.test(e.title)
            ? 'back'
            : 'front';
      }
      return 'chapter';
    }
    const d = partShift ? e.depth - 1 : e.depth;
    return d <= 0 ? 'chapter' : d === 1 ? 'section' : 'subsection';
  });
}

function chapterNumber(title: string): { number?: string; rest: string } {
  const m = CHAPTER_LABEL.exec(title) ?? PART_LABEL.exec(title);
  if (m) {
    const raw = (m[1] as string).toLowerCase();
    return { number: WORD_NUMBERS[raw] ?? (m[1] as string), rest: title.slice(m[0].length).trim() };
  }
  const n = LEADING_NUMBER.exec(title);
  if (n) return { number: n[1] as string, rest: title.slice(n[0].length).trim() };
  return { rest: title };
}

const TYPE_MAP: Record<Block['type'], StructSegment['type']> = {
  heading: 'heading',
  paragraph: 'paragraph',
  list_item: 'list_item',
  quote: 'quote',
  code: 'code',
  caption: 'caption',
  footnote: 'footnote',
  figure: 'figure',
};

function toSegment(b: Block, nodeKey: string): StructSegment {
  const type = TYPE_MAP[b.type];
  return {
    nodeKey,
    type,
    src: b.text,
    page: b.page,
    pageEnd: b.pageEnd,
    meta: { ...b.meta, ...(b.box ? { bbox: b.box } : {}) },
    translatable: !(type === 'code' || type === 'figure' || type === 'table' || type === 'equation'),
  };
}

export interface StructureResult {
  nodes: StructNode[];
  segments: StructSegment[];
  source: StructureSource;
}

/** Builds the TOC tree and segments from ordered blocks (SPEC §8.6). */
export function buildStructure(
  blocks: Block[],
  ex: Pick<ExtractedBook, 'outline' | 'pageCount'>,
  labels: string[],
): StructureResult {
  let source: StructureSource = 'outline';
  let entries = flattenOutline(ex.outline);
  if (entries.length === 0) {
    source = 'contents';
    entries = contentsEntries(blocks, labels, Math.max(20, Math.ceil(ex.pageCount * 0.25)));
  }
  if (entries.length === 0) {
    source = 'headings';
    entries = headingEntries(blocks);
  }
  entries.sort((a, b) => a.pageIndex - b.pageIndex || (a.top ?? 0) - (b.top ?? 0));

  const cuts = locate(entries, blocks);
  const kinds = classify(cuts.map((c) => c.entry));
  const nodes: StructNode[] = [];
  const segments: StructSegment[] = [];
  const firstCut = cuts[0]?.index ?? blocks.length;

  // Pages before the first entry (cover, title page, copyright…): a skipped front-matter node.
  if (firstCut > 0) {
    const pre = blocks.slice(0, firstCut);
    const key = 'n0';
    nodes.push({
      key,
      parentKey: null,
      kind: 'front',
      depth: 0,
      title: (pre.find((b) => b.type === 'heading')?.text ?? pre[0]?.text ?? '').slice(0, 80),
      pageStart: pre[0]?.page ?? 0,
      pageEnd: pre.at(-1)?.pageEnd ?? 0,
      skip: true,
      origin: 'heuristic',
    });
    for (const b of pre) segments.push(toSegment(b, key));
  }

  // Parent of each cut from depths (a stack), with kinds adjusted to the tree.
  const stack: { depth: number; key: string }[] = [];
  let chapterCounter = 0;
  const nodeOfCut: StructNode[] = [];
  cuts.forEach((cut, i) => {
    while (stack.length && (stack[stack.length - 1] as { depth: number }).depth >= cut.entry.depth) stack.pop();
    const parent = stack[stack.length - 1];
    const kind = kinds[i] as NodeKind;
    const key = `n${nodes.length + 1}`;
    const { number, rest } =
      kind === 'chapter' || kind === 'part' ? chapterNumber(cut.entry.title) : { rest: cut.entry.title };
    if (kind === 'chapter') chapterCounter++;
    const node: StructNode = {
      key,
      parentKey: parent?.key ?? null,
      kind,
      depth: stack.length,
      ...(kind === 'chapter'
        ? { numberLabel: number ?? String(chapterCounter) }
        : number
          ? { numberLabel: number }
          : {}),
      title: rest || cut.entry.title,
      pageStart: cut.entry.pageIndex,
      pageEnd: cut.entry.pageIndex,
      skip: SKIP_BY_DEFAULT.test(cut.entry.title),
      origin: cut.entry.origin,
    };
    nodes.push(node);
    nodeOfCut.push(node);
    stack.push({ depth: cut.entry.depth, key });
  });

  const hasChildren = (key: string) => nodes.some((n) => n.parentKey === key);

  cuts.forEach((cut, i) => {
    const node = nodeOfCut[i] as StructNode;
    const end = cuts[i + 1]?.index ?? blocks.length;
    const own = blocks.slice(cut.index, end);
    const headingBlocks = cut.heading.map((h) => blocks[h] as Block);
    const body = own.filter((b) => !headingBlocks.includes(b));
    const footnotes = body.filter((b) => b.type === 'footnote');
    const content = body.filter((b) => b.type !== 'footnote');
    const pageEnd = Math.max(node.pageStart, ...own.map((b) => b.pageEnd));
    node.pageEnd = pageEnd;

    // The node's title segment: the printed heading (chapter label line dropped), else the entry title.
    const labelOnly =
      headingBlocks.length === 2 &&
      (CHAPTER_LABEL.test(headingBlocks[0]?.text ?? '') || PART_LABEL.test(headingBlocks[0]?.text ?? ''));
    let headingText = headingBlocks.length
      ? stripMarkup(labelOnly ? (headingBlocks[1] as Block).text : headingBlocks.map((b) => b.text).join(' '))
      : '';
    if (node.kind === 'chapter' || node.kind === 'part') headingText = chapterNumber(headingText).rest || headingText;
    const headingSeg: StructSegment = {
      nodeKey: node.key,
      type: 'heading',
      src: headingText || node.title,
      page: headingBlocks[0]?.page ?? node.pageStart,
      pageEnd: headingBlocks.at(-1)?.pageEnd ?? node.pageStart,
      meta: headingBlocks.length ? {} : { synthetic: true },
      translatable: true,
    };

    const container = (node.kind === 'chapter' || node.kind === 'part') && hasChildren(node.key);
    if (container) {
      if (content.length > 0) {
        // Text between the chapter heading and its first section → «مقدمه‌ی فصل».
        const introKey = `${node.key}i`;
        nodes.splice(nodes.indexOf(node) + 1, 0, {
          key: introKey,
          parentKey: node.key,
          kind: 'chapter_intro',
          depth: node.depth + 1,
          title: node.title,
          pageStart: node.pageStart,
          pageEnd,
          skip: node.skip,
          origin: node.origin,
        });
        headingSeg.nodeKey = introKey;
        node.headingIndex = segments.length;
        segments.push(headingSeg);
        for (const b of [...content, ...footnotes]) segments.push(toSegment(b, introKey));
      } else {
        // No intro text: the chapter heading opens its first section.
        headingSeg.nodeKey = `pending:${node.key}`;
        node.headingIndex = segments.length;
        segments.push(headingSeg);
      }
    } else {
      node.headingIndex = segments.length;
      segments.push(headingSeg);
      for (const b of [...content, ...footnotes]) segments.push(toSegment(b, node.key));
    }
  });

  // Attach "pending" chapter headings to the first readable descendant.
  for (const seg of segments) {
    if (!seg.nodeKey.startsWith('pending:')) continue;
    const parentKey = seg.nodeKey.slice('pending:'.length);
    let child = nodes.find((n) => n.parentKey === parentKey);
    while (child && nodes.some((n) => n.parentKey === child?.key) && child.kind !== 'section') {
      child = nodes.find((n) => n.parentKey === child?.key);
    }
    seg.nodeKey = child?.key ?? parentKey;
  }

  // Keep segments grouped per node in document order (headings moved into children stay first).
  const order = new Map(nodes.map((n, i) => [n.key, i]));
  const indexed = segments.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => (order.get(a.s.nodeKey) ?? 0) - (order.get(b.s.nodeKey) ?? 0) || a.i - b.i);
  const remap = new Map(indexed.map(({ i }, newIndex) => [i, newIndex]));
  for (const n of nodes) if (n.headingIndex !== undefined) n.headingIndex = remap.get(n.headingIndex);
  return { nodes, segments: indexed.map(({ s }) => s), source };
}

export { normTitle };
