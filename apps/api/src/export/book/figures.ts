import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Box,
  captionStart,
  extractFigures,
  type FigureKind,
  type FigureLabel,
  figureTokens,
} from '@dozabaneh/pdf';
import { localizeDigits, stripMarkup } from '@dozabaneh/text';
import type { Config } from '../../config';
import type { Db } from '../../db/client';

/**
 * Figures of a book for its PDF (ADR-046): cut out of the original PDF, matched to the segments that are really
 * their labels (ingestion read the words of a flowchart or a table as scattered paragraphs), and given labels in the
 * target language. Cutting is slow and does not depend on the language, so it is kept on disk next to the book's
 * other exports and redone only when the original file or the detector changes.
 */
export const FIGURES_VERSION = 2;

export interface BookFigureLabel extends FigureLabel {
  /** The label in the target language (absent: kept as printed). */
  tgt?: string;
}

export interface BookFigure {
  id: string;
  kind: FigureKind;
  number?: string;
  page: number;
  /** File name of the image inside the book's figure folder. */
  file: string;
  format: 'png' | 'jpeg';
  /** Size on the original page (points). */
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  mirrored: boolean;
  textRemoved: boolean;
  caption?: string;
  labels: BookFigureLabel[];
  /** Segments that are the figure's labels printed as body text: the figure takes their place. */
  hidden: string[];
  /** Segments that are its caption: printed under it. */
  captionIds: string[];
}

interface SegmentRow {
  id: string;
  type: string;
  src: string;
  page: number;
  pageEnd: number;
  bbox: Box | null;
}

export function bookPdfDir(config: Pick<Config, 'dataDir'>, bookId: string): string {
  return join(config.dataDir, 'book-pdf', bookId);
}

const figuresDir = (config: Pick<Config, 'dataDir'>, bookId: string) => join(bookPdfDir(config, bookId), 'figures');

function bookSegments(db: Db, bookId: string): SegmentRow[] {
  return (
    db.$client
      .prepare('SELECT id, type, src, page, page_end AS pageEnd, bbox FROM segments WHERE book_id = ? ORDER BY ord')
      .all(bookId) as (Omit<SegmentRow, 'bbox'> & { bbox: string | null })[]
  ).map((s) => ({ ...s, bbox: s.bbox ? (JSON.parse(s.bbox) as Box) : null }));
}

/** Pages worth looking at: a caption, or a picture ingestion already saw. */
export function figurePages(segs: SegmentRow[], lang: string): { pages: number[]; images: Map<number, Box[]> } {
  const pages = new Set<number>();
  const images = new Map<number, Box[]>();
  for (const s of segs) {
    if (s.type === 'figure' && s.bbox) {
      pages.add(s.page);
      images.set(s.page, [...(images.get(s.page) ?? []), s.bbox]);
    } else if (s.type === 'caption' || captionStart(stripMarkup(s.src), lang)) pages.add(s.page);
  }
  return { pages: [...pages].sort((a, b) => a - b), images };
}

class Bag {
  private readonly counts = new Map<string, number>();
  constructor(tokens: string[]) {
    for (const t of tokens) this.counts.set(t, (this.counts.get(t) ?? 0) + 1);
  }
  /** Share of `tokens` found in the bag; when at least `min`, they are taken out of it. */
  take(tokens: string[], min: number): boolean {
    const need = new Map<string, number>();
    for (const t of tokens) need.set(t, (need.get(t) ?? 0) + 1);
    let found = 0;
    for (const [t, n] of need) found += Math.min(n, this.counts.get(t) ?? 0);
    if (!tokens.length || found / tokens.length < min) return false;
    for (const [t, n] of need) this.counts.set(t, Math.max(0, (this.counts.get(t) ?? 0) - n));
    return true;
  }
}

/**
 * Which segments a figure replaces: those whose words are (almost) all printed inside it, and those that are its
 * caption. Checked on the figure's own page only; each printed word can account for one segment word.
 */
export function matchSegments(
  figure: { page: number; kind: FigureKind; box: Box; caption?: string; labels: FigureLabel[] },
  segs: SegmentRow[],
): { hidden: string[]; captionIds: string[] } {
  const labels = new Bag(figure.labels.flatMap((l) => figureTokens(l.text)));
  const caption = new Bag(figureTokens(figure.caption ?? ''));
  const hidden: string[] = [];
  const captionIds: string[] = [];
  for (const s of segs) {
    if (s.page !== figure.page && s.pageEnd !== figure.page) continue;
    if (s.type === 'figure') {
      if (s.bbox && overlaps(s.bbox, figure.box)) hidden.push(s.id);
      continue;
    }
    const tokens = figureTokens(stripMarkup(s.src));
    if (!tokens.length) continue;
    if (caption.take(tokens, 0.85)) captionIds.push(s.id);
    else if (labels.take(tokens, 0.8)) hidden.push(s.id);
  }
  return { hidden, captionIds };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

interface FigureCache {
  version: number;
  sha: string;
  keepText: boolean;
  mirror: boolean;
  figures: BookFigure[];
}

export interface FigureDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
}

/**
 * The figures of a book, cut out of its original PDF (from the cache when it is still valid). Labels carry no
 * translation yet.
 */
export async function bookFigures(
  { db, config }: FigureDeps,
  book: { id: string; sourceLang: string; filePath: string | null; fileSha256: string | null },
  opts: { keepText: boolean; mirror: boolean; onPage?: (done: number, total: number) => void },
): Promise<BookFigure[]> {
  if (!book.filePath || !existsSync(book.filePath)) return [];
  const dir = figuresDir(config, book.id);
  const indexFile = join(dir, 'index.json');
  const sha = book.fileSha256 ?? '';
  if (existsSync(indexFile)) {
    try {
      const cached = JSON.parse(readFileSync(indexFile, 'utf8')) as FigureCache;
      if (
        cached.version === FIGURES_VERSION &&
        cached.sha === sha &&
        cached.keepText === opts.keepText &&
        cached.mirror === opts.mirror &&
        cached.figures.every((f) => existsSync(join(dir, f.file)))
      ) {
        return cached.figures;
      }
    } catch {
      // A damaged cache is rebuilt.
    }
  }
  const segs = bookSegments(db, book.id);
  const { pages, images } = figurePages(segs, book.sourceLang);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const found = pages.length
    ? await extractFigures(new Uint8Array(readFileSync(book.filePath)), {
        lang: book.sourceLang,
        pages,
        images,
        keepText: opts.keepText,
        mirrorTables: opts.mirror,
        ...(opts.onPage ? { onPage: opts.onPage } : {}),
      })
    : [];
  const figures: BookFigure[] = found.map((f, i) => {
    const id = `f${String(i + 1).padStart(3, '0')}`;
    const file = `${id}.${f.format === 'jpeg' ? 'jpg' : 'png'}`;
    writeFileSync(join(dir, file), f.image);
    const { hidden, captionIds } = matchSegments(f, segs);
    return {
      id,
      kind: f.kind,
      ...(f.number ? { number: f.number } : {}),
      page: f.page,
      file,
      format: f.format,
      width: f.box.width,
      height: f.box.height,
      pixelWidth: f.pixelWidth,
      pixelHeight: f.pixelHeight,
      mirrored: f.mirrored,
      textRemoved: f.textRemoved,
      ...(f.caption ? { caption: f.caption } : {}),
      labels: f.labels,
      hidden,
      captionIds,
    };
  });
  writeFileSync(
    indexFile,
    JSON.stringify({ version: FIGURES_VERSION, sha, keepText: opts.keepText, mirror: opts.mirror, figures }),
  );
  return figures;
}

export function figureFile(config: Pick<Config, 'dataDir'>, bookId: string, figure: BookFigure): string {
  return join(figuresDir(config, bookId), figure.file);
}

/**
 * A label made only of numbers, signs and abbreviations («PT, PTT», «HCV», «1:1,000») is not translated — its digits
 * follow the target language. Words are: anything with lower-case letters, and a lone capitalised word with a vowel
 * («YES», «NO», «STOP»).
 */
export function needsTranslation(text: string): boolean {
  if (/\p{Ll}{2,}/u.test(text)) return true;
  const words = text.match(/\p{L}+/gu) ?? [];
  return words.length === 1 && /^\p{Lu}{2,5}$/u.test(words[0] as string) && /[AEIOUY]/.test(words[0] as string);
}

/** Translations of labels, kept per language so a rebuild does not ask again. */
export class LabelCache {
  private readonly file: string;
  private readonly map: Record<string, string>;
  constructor(config: Pick<Config, 'dataDir'>, bookId: string, lang: string) {
    this.file = join(bookPdfDir(config, bookId), `labels-${lang}.json`);
    let map: Record<string, string> = {};
    try {
      map = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>) : {};
    } catch {
      map = {};
    }
    this.map = map;
  }
  get(src: string): string | undefined {
    return this.map[src];
  }
  set(src: string, tgt: string): void {
    this.map[src] = tgt;
  }
  save(): void {
    mkdirSync(join(this.file, '..'), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.map));
  }
}

export type TranslateTexts = (
  items: { key: string; type: 'lbl' | 'h'; src: string }[],
  /** Captions of the figures these labels come from, for context (never translated). */
  context: { captions?: { src: string; tgt?: string }[] },
) => Promise<Map<string, string>>;

/** Labels per request: several figures travel together, so a book's figures take a few requests, not dozens. */
export const LABELS_PER_REQUEST = 60;

/**
 * Gives every figure's labels their target-language text: from the cache, else from the translator. Labels of
 * consecutive figures share a request (with their captions as context); a request that fails is tried again in two
 * halves, and whatever still fails keeps its printed words. Each distinct label is asked for once.
 */
export async function translateLabels(
  figures: BookFigure[],
  opts: {
    lang: string;
    cache: LabelCache;
    translate?: TranslateTexts | undefined;
    captionOf: (f: BookFigure) => string | undefined;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<{ translated: number; failed: number }> {
  // What is still to ask, grouped into requests without splitting a figure unless it alone is too big.
  const groups: { labels: string[]; figures: BookFigure[] }[] = [];
  const asked = new Set<string>();
  for (const f of figures) {
    if (!f.textRemoved) continue;
    const todo = [...new Set(f.labels.map((l) => l.text))].filter(
      (t) => needsTranslation(t) && opts.cache.get(t) === undefined && !asked.has(t),
    );
    for (const t of todo) asked.add(t);
    for (let start = 0; start < todo.length; start += LABELS_PER_REQUEST) {
      const part = todo.slice(start, start + LABELS_PER_REQUEST);
      const last = groups.at(-1);
      if (last && last.labels.length + part.length <= LABELS_PER_REQUEST) {
        last.labels.push(...part);
        if (!last.figures.includes(f)) last.figures.push(f);
      } else groups.push({ labels: [...part], figures: [f] });
    }
  }

  const ask = async (labels: string[], group: BookFigure[], retry: boolean): Promise<void> => {
    if (!opts.translate || !labels.length) return;
    try {
      const out = await opts.translate(
        labels.map((src, i) => ({ key: `l${i + 1}`, type: 'lbl', src })),
        {
          captions: group
            .filter((f) => f.caption)
            .map((f) => {
              const tgt = opts.captionOf(f);
              return { src: f.caption as string, ...(tgt ? { tgt } : {}) };
            }),
        },
      );
      labels.forEach((src, i) => {
        const tgt = out.get(`l${i + 1}`);
        if (tgt?.trim()) opts.cache.set(src, tgt.trim());
      });
    } catch {
      if (!retry || labels.length < 8) return;
      const half = Math.ceil(labels.length / 2);
      await ask(labels.slice(0, half), group, false);
      await ask(labels.slice(half), group, false);
    }
  };

  opts.onProgress?.(0, groups.length);
  for (const [n, group] of groups.entries()) {
    await ask(group.labels, group.figures, true);
    opts.cache.save();
    opts.onProgress?.(n + 1, groups.length);
  }

  let translated = 0;
  let failed = 0;
  for (const f of figures) {
    if (!f.textRemoved) continue;
    for (const l of f.labels) {
      const tgt = needsTranslation(l.text) ? opts.cache.get(l.text) : localizeDigits(l.text, opts.lang);
      if (tgt !== undefined) l.tgt = tgt;
    }
    const complete = f.labels.every((l) => l.tgt !== undefined);
    if (complete && f.labels.some((l) => needsTranslation(l.text))) translated++;
    if (!complete) failed++;
  }
  return { translated, failed };
}
