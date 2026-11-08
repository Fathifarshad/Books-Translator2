import { type FlowRow, reflowRows, stripMarkup } from '@dozabaneh/text';
import type { BookDocument, DocSection } from '../document';
import type { BookFigure } from './figures';

/**
 * The book as a typesetter sees it (ADR-046): chapters that start on a new page, headings at three levels, body
 * text repaired by the reflow pass, figures set where their scattered labels used to be, and the entries of a real
 * table of contents. Built from the same document model as every other export.
 */
export type ListItem = { text: string; src: string; marker: 'bullet' | 'own' };

export type Block =
  | { kind: 'h'; level: 2 | 3 | 4; id: string; text: string; src: string }
  | { kind: 'p'; cls: 'body' | 'note' | 'code' | 'caption'; text: string; src: string }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'figure'; figure: PlacedFigure };

export interface PlacedFigure {
  figure: BookFigure;
  /** Element id, for the list of figures and tables. */
  id: string;
  caption: string;
  captionSrc: string;
}

export interface Chapter {
  id: string;
  title: string;
  titleSrc: string;
  blocks: Block[];
}

export interface TocEntry {
  id: string;
  level: 1 | 2 | 3;
  text: string;
}

export interface BookLayout {
  chapters: Chapter[];
  toc: TocEntry[];
  figures: PlacedFigure[];
}

export interface LayoutOptions {
  mode: 'target' | 'bilingual';
  /** Chapter titles printed in pieces, joined in the source and translated whole (source → target). */
  titles?: Map<string, string>;
}

const norm = (s: string) =>
  stripMarkup(s)
    .replace(/[\s:.–—-]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** A heading numbered like a structure heading («4.», «۴-۱», «2.3») — kept in a long table of contents. */
const NUMBERED = /^\s*[0-9۰-۹]+(?:\s*[.\-–)]|[.\-–][0-9۰-۹]+)/u;

/** Heading-only top-level sections in a row, waiting to be joined to the chapter title that follows them. */
function isTitlePiece(s: DocSection, next: DocSection | undefined): boolean {
  if (s.chapterId || s.kind !== 'chapter') return false;
  if (s.rows.length > 1 || (s.rows[0] && s.rows[0].type !== 'heading')) return false;
  return Boolean(next && next.chapterId !== s.id);
}

/** Source text of a chapter title printed in pieces, with the pieces' own targets. */
function titleRun(pieces: DocSection[], next: DocSection): { src: string; tgt: string } {
  const last = next.chapterId
    ? { src: next.chapterSrc ?? '', tgt: next.chapter ?? '' }
    : { src: next.titleSrc, tgt: next.title };
  return {
    src: [...pieces.map((p) => p.titleSrc), last.src].filter(Boolean).join(' '),
    tgt: [...pieces.map((p) => p.title), last.tgt].filter(Boolean).join(' '),
  };
}

/** Chapter titles that need translating whole (the job asks the translator before layout). */
export function brokenTitles(doc: BookDocument): string[] {
  const out: string[] = [];
  let pending: DocSection[] = [];
  doc.sections.forEach((s, i) => {
    const next = doc.sections[i + 1];
    if (isTitlePiece(s, next)) {
      pending.push(s);
      return;
    }
    if (pending.length) {
      const run = titleRun(pending, s);
      if (run.src.length <= 160) out.push(run.src);
    }
    pending = [];
  });
  return out;
}

function text(mode: LayoutOptions['mode'], r: { src: string; tgt: string }): { text: string; src: string } {
  return { text: r.tgt || r.src, src: mode === 'bilingual' && r.tgt ? r.src : '' };
}

export function layoutBook(doc: BookDocument, figures: BookFigure[], opts: LayoutOptions): BookLayout {
  const rowById = new Map(doc.sections.flatMap((s) => s.rows.map((r) => [r.id ?? '', r] as const)));
  const order = doc.sections.flatMap((s) => s.rows.map((r) => r.id ?? ''));
  const position = new Map(order.map((id, i) => [id, i]));

  // Where each figure goes: in place of the first of its segments, else after the last text of its page.
  const taken = new Set<string>();
  const anchors = new Map<string, PlacedFigure[]>();
  for (const figure of figures) {
    const own = [...figure.hidden, ...figure.captionIds].filter((id) => position.has(id));
    for (const id of own) taken.add(id);
    let anchor = own.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))[0];
    let after = false;
    if (!anchor) {
      const onPage = doc.sections.flatMap((s) => s.rows).filter((r) => (r.page ?? 0) <= figure.page && r.id);
      anchor = onPage.at(-1)?.id;
      after = true;
    }
    if (!anchor) continue;
    const captionRows = figure.captionIds.map((id) => rowById.get(id)).filter((r) => r !== undefined);
    const caption = captionRows.map((r) => r.tgt || r.src).join(' ');
    const p: PlacedFigure = {
      figure,
      id: `fig-${figure.id}`,
      caption: caption || figure.caption || '',
      captionSrc: opts.mode === 'bilingual' ? captionRows.map((r) => r.src).join(' ') : '',
    };
    const key = after ? `after:${anchor}` : `at:${anchor}`;
    anchors.set(key, [...(anchors.get(key) ?? []), p]);
  }

  const chapters: Chapter[] = [];
  const toc: TocEntry[] = [];
  const level3: TocEntry[] = [];
  let headingNo = 0;
  const nextId = () => `h-${++headingNo}`;
  let current: (Chapter & { key: string }) | undefined;
  let pending: DocSection[] = [];

  const startChapter = (key: string, title: string, titleSrc: string) => {
    current = { key, id: nextId(), title, titleSrc, blocks: [] };
    chapters.push(current);
    toc.push({ id: current.id, level: 1, text: title });
  };

  doc.sections.forEach((section, i) => {
    const next = doc.sections[i + 1];
    if (isTitlePiece(section, next)) {
      pending.push(section);
      return;
    }
    // Figures anchored in the pieces of a chapter title printed in pieces open the chapter's text.
    const carried = pending.flatMap((piece) =>
      piece.rows.flatMap((r) => [...(anchors.get(`at:${r.id}`) ?? []), ...(anchors.get(`after:${r.id}`) ?? [])]),
    );
    const firstHeading = section.rows[0]?.type === 'heading' ? section.rows[0] : undefined;
    const sectionTitle =
      (firstHeading && norm(firstHeading.src) === norm(section.titleSrc) && firstHeading.tgt) || section.title;
    const key = section.chapterId ?? section.id;
    if (!current || current.key !== key || pending.length) {
      let title = section.chapterId ? (section.chapter ?? '') : sectionTitle;
      let titleSrc = section.chapterId ? (section.chapterSrc ?? '') : section.titleSrc;
      if (pending.length) {
        const run = titleRun(pending, section);
        title = opts.titles?.get(run.src) ?? run.tgt;
        titleSrc = run.src;
        pending = [];
      }
      startChapter(key, title, titleSrc);
    }
    const chapter = current as Chapter & { key: string };

    // The section's own heading, unless it is the chapter's opening (its title is the chapter's).
    const isChapterItself = !section.chapterId;
    const opening = section.kind === 'chapter_intro' || norm(section.titleSrc) === norm(chapter.titleSrc);
    if (!isChapterItself && !opening && sectionTitle.trim()) {
      const level = section.depth - (section.chapterDepth ?? 0) <= 1 ? 2 : 3;
      // The previous section ended on this very heading (ingestion printed it twice): the section's own wins.
      const last = chapter.blocks.at(-1);
      if (last?.kind === 'h' && norm(last.text) === norm(sectionTitle)) {
        chapter.blocks.pop();
        const dup = level3.findIndex((e) => e.id === last.id);
        if (dup >= 0) level3.splice(dup, 1);
      }
      const id = nextId();
      chapter.blocks.push({ kind: 'h', level, id, ...text(opts.mode, { src: section.titleSrc, tgt: sectionTitle }) });
      (level === 2 ? toc : level3).push({ id, level, text: sectionTitle });
    }

    // Body rows: the figure's own segments leave the text, the rest is reflowed. The section's title row is
    // printed as its heading above, but a figure anchored on it still has its place here.
    const titleRow = firstHeading && norm(firstHeading.src) === norm(section.titleSrc) ? firstHeading : undefined;
    const flow: FlowRow[] = [];
    const before = new Map<string | null, PlacedFigure[]>(carried.length ? [[null, carried]] : []);
    let lastVisible: string | null = null;
    for (const r of section.rows) {
      const id = r.id ?? '';
      const at = anchors.get(`at:${id}`);
      if (at) before.set(lastVisible, [...(before.get(lastVisible) ?? []), ...at]);
      if (r !== titleRow && !taken.has(id) && r.type !== 'figure') {
        flow.push({ type: r.type, src: r.src, tgt: r.tgt, ids: [id] });
        lastVisible = id;
      }
      const after = anchors.get(`after:${id}`);
      if (after) before.set(lastVisible, [...(before.get(lastVisible) ?? []), ...after]);
    }
    const reflowed = reflowRows(flow, { sourceLang: doc.lang.src, targetLang: doc.lang.tgt });

    const blocks = chapter.blocks;
    const pushFigures = (list: PlacedFigure[] | undefined) => {
      for (const figure of list ?? []) blocks.push({ kind: 'figure', figure });
    };
    pushFigures(before.get(null));
    for (const row of reflowed) {
      const t = text(opts.mode, row);
      if (row.type === 'list_item') {
        const last = blocks.at(-1);
        const item: ListItem = { ...t, marker: row.marker ?? 'bullet' };
        if (last?.kind === 'list') last.items.push(item);
        else blocks.push({ kind: 'list', items: [item] });
      } else if (row.type === 'heading' || row.type === 'subheading') {
        const id = nextId();
        const level = row.type === 'heading' ? 3 : 4;
        blocks.push({ kind: 'h', level, id, ...t });
        if (level === 3) level3.push({ id, level: 3, text: t.text });
      } else {
        const cls =
          row.type === 'footnote' ? 'note' : row.type === 'code' ? 'code' : row.type === 'caption' ? 'caption' : 'body';
        blocks.push({ kind: 'p', cls, ...t });
      }
      for (const id of row.ids) pushFigures(before.get(id));
    }
  });
  for (const s of pending) startChapter(s.id, s.title, s.titleSrc);

  // A long run of inner headings keeps only the numbered ones; past that, the contents stay at two levels.
  const numbered = level3.filter((e) => NUMBERED.test(e.text));
  const extra = level3.length <= 80 ? level3 : numbered.length <= 200 ? numbered : [];
  const keep = new Set(extra.map((e) => e.id));
  // An inner heading that repeats a section title (ingestion left it in the section before) is listed once.
  const titled = new Set(toc.map((e) => norm(e.text)));
  const entries = [...toc, ...level3.filter((e) => keep.has(e.id) && !titled.has(norm(e.text)))];
  const rank = new Map<string, number>();
  for (const ch of chapters) {
    rank.set(ch.id, rank.size);
    for (const b of ch.blocks) if (b.kind === 'h') rank.set(b.id, rank.size);
  }
  entries.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  // Figures in reading order, as they were set.
  const figureOrder: PlacedFigure[] = [];
  for (const ch of chapters) for (const b of ch.blocks) if (b.kind === 'figure') figureOrder.push(b.figure);
  return { chapters, toc: entries, figures: figureOrder };
}
