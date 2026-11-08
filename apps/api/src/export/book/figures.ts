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
export const FIGURES_VERSION = 7;

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

/**
 * How close together a segment's words must be printed to be found in a figure: `near`, in any order within a
 * stretch twice its length and a few words more (a table row or a flowchart box ingestion read in another order);
 * `exact`, side by side (a segment of up to three words — «Intravascular Volume» is a subheading, not the label
 * «Intravascular fluid volume»); `ordered`, in the same order with at most a few words between (a piece of a
 * caption); `anywhere` (numbers and signs only).
 */
type Closeness = 'near' | 'exact' | 'ordered' | 'anywhere';

/**
 * The words a figure prints, in reading order. A segment is found in it when (almost) all its words are there,
 * close enough together, so a heading of the page whose words also occur here and there in a large table
 * («CARDIOVASCULAR CHANGES») is not mistaken for part of it. Each printed word accounts for one segment word.
 */
class WordStream {
  private readonly used: Uint8Array;
  constructor(private readonly tokens: string[]) {
    this.used = new Uint8Array(tokens.length);
  }
  private all = false;
  private free(i: number, t: string): boolean {
    return (this.all || !this.used[i]) && this.tokens[i] === t;
  }
  /**
   * Takes the segment's words when enough are found close enough together; `peek` only says whether they are, and
   * `all` looks at words already taken too.
   */
  take(words: string[], min: number, closeness: Closeness, opts: { peek?: boolean; all?: boolean } = {}): boolean {
    const n = words.length;
    if (!n) return false;
    this.all = opts.all ?? false;
    let best: number[] = [];
    if (closeness === 'ordered') {
      for (let start = 0; start < this.tokens.length && best.length < n; start++) {
        if (!words.slice(0, 2).some((t) => this.free(start, t))) continue;
        const hit: number[] = [];
        let p = start;
        for (const t of words) {
          for (let q = p; q < Math.min(this.tokens.length, p + 4); q++) {
            if (this.free(q, t)) {
              hit.push(q);
              p = q + 1;
              break;
            }
          }
        }
        if (hit.length > best.length) best = hit;
      }
    } else {
      const need = new Map<string, number>();
      for (const t of words) need.set(t, (need.get(t) ?? 0) + 1);
      const span = closeness === 'anywhere' ? this.tokens.length : closeness === 'exact' ? n : 2 * n + 8;
      for (let start = 0; start < this.tokens.length && best.length < n; start++) {
        if ((this.used[start] && !this.all) || !need.has(this.tokens[start] as string)) continue;
        const left = new Map(need);
        const hit: number[] = [];
        for (let i = start; i < Math.min(this.tokens.length, start + span) && hit.length < n; i++) {
          const k = this.used[i] && !this.all ? 0 : (left.get(this.tokens[i] as string) ?? 0);
          if (k > 0) {
            left.set(this.tokens[i] as string, k - 1);
            hit.push(i);
          }
        }
        if (hit.length > best.length) best = hit;
      }
    }
    if (best.length / n < min) return false;
    if (!opts.peek) for (const i of best) this.used[i] = 1;
    return true;
  }
}

/**
 * Which segments a figure replaces: those whose words are (almost) all printed inside it, and those that are its
 * caption. Checked on the figure's own page only, in two rounds, the strictest first so a loose match cannot take
 * the words a strict one needs: first the caption's pieces (in its word order), segments printed word for word side
 * by side, and short segments (up to three words) whose words stand side by side — their numbers may be near them
 * («Latent phase» beside the axis's «0»), but «Intravascular Volume» is a subheading, not the label «Intravascular
 * fluid volume»; then longer segments with (almost) all their words anywhere in the figure (a flowchart box or a
 * table row ingestion read in another order), and numbers alone. A heading goes only on an exact match (the big
 * title of a flowchart box ingestion took for a heading). In the first round each printed word accounts for one
 * segment word, in the order of the text, so a subheading that repeats a table's row label («Cardiac Output») stays
 * once the row has taken it; the second round looks at all the figure's words, since ingestion sometimes gives the
 * same words twice («Not adequate», then «Not adequate BMV ± cricoid»).
 */
export function matchSegments(
  figure: { page: number; kind: FigureKind; box: Box; caption?: string; labels: FigureLabel[] },
  segs: SegmentRow[],
): { hidden: string[]; captionIds: string[] } {
  const labels = new WordStream(figure.labels.flatMap((l) => figureTokens(l.text)));
  // Its words without the numbers between them, where a short segment's phrase is looked for («Low 2,3-DPG»).
  const phrases = new WordStream(figure.labels.flatMap((l) => figureTokens(l.text).filter((t) => /\p{L}/u.test(t))));
  const caption = new WordStream(figureTokens(figure.caption ?? ''));
  const hidden = new Set<string>();
  const captionIds = new Set<string>();
  const rest: string[][] = [];
  const restIds: string[] = [];
  for (const s of segs) {
    if (s.page !== figure.page && s.pageEnd !== figure.page) continue;
    if (s.type === 'figure') {
      if (s.bbox && overlaps(s.bbox, figure.box)) hidden.add(s.id);
      continue;
    }
    const tokens = figureTokens(stripMarkup(s.src));
    if (!tokens.length) continue;
    const words = tokens.filter((t) => /\p{L}/u.test(t));
    // A piece of the caption has words of its own: a lone number («80») is an axis label, not a caption piece.
    if (words.length && tokens.length >= 2 && caption.take(tokens, 0.85, 'ordered')) captionIds.add(s.id);
    else if (labels.take(tokens, 1, 'exact')) hidden.add(s.id);
    else if (s.type === 'heading') continue;
    else if (words.length && words.length <= 3) {
      // The phrase is printed in the figure (side by side), and its words are not all accounted for yet.
      if (phrases.take(words, 1, 'exact', { peek: true, all: true }) && labels.take(tokens, 0.8, 'anywhere')) {
        hidden.add(s.id);
      }
    } else {
      rest.push(tokens);
      restIds.push(s.id);
    }
  }
  rest.forEach((tokens, i) => {
    const numbersOnly = !tokens.some((t) => /\p{L}/u.test(t));
    if (labels.take(tokens, numbersOnly ? 1 : 0.8, 'anywhere', { all: true })) hidden.add(restIds[i] as string);
  });
  // In the order of the text.
  const order = (ids: Set<string>) => segs.filter((s) => ids.has(s.id)).map((s) => s.id);
  return { hidden: order(hidden), captionIds: order(captionIds) };
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
 * A label made only of numbers, signs and abbreviations («PT, PTT», «HCV», «1:1,000», «aPTT») is not translated — its
 * digits follow the target language. Words are: a run of lower-case letters, a capitalised word («No», «Term»), a
 * word in capitals with a vowel standing alone («YES», «STOP», «NEURAXIAL»), and a phrase in capitals or small
 * capitals with at least one such word of four letters or more («UFH SQ LOW DOSE», «LIKELY LOW RISK TO»).
 */
export function needsTranslation(text: string): boolean {
  if (/\p{Ll}{2,}/u.test(text)) return true;
  const words = text.match(/\p{L}+/gu) ?? [];
  if (words.some((w) => /^\p{Lu}\p{Ll}+$/u.test(w))) return true;
  const vowel = (w: string) => /[AEIOUY]/.test(w);
  const caps = words.filter((w) => /^\p{Lu}{2,}$/u.test(w));
  if (words.length === 1) return caps.length === 1 && vowel(caps[0] as string);
  return caps.some((w) => w.length >= 4 && vowel(w));
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
    const todo = [...new Set(f.labels.filter((l) => !l.printed).map((l) => l.text))].filter(
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
    const set = f.labels.filter((l) => !l.printed);
    for (const l of set) {
      const tgt = needsTranslation(l.text) ? opts.cache.get(l.text) : localizeDigits(l.text, opts.lang);
      if (tgt !== undefined) l.tgt = tgt;
    }
    const complete = set.every((l) => l.tgt !== undefined);
    if (complete && set.some((l) => needsTranslation(l.text))) translated++;
    if (!complete) failed++;
  }
  return { translated, failed };
}
