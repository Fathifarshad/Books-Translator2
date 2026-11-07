import { endsWithTerminalPunctuation, startsWithListMarker } from './continuation';
import { getLanguage } from './languages';
import { stripMarkup } from './markup';

/**
 * Book layout of exported text (ADR-046): the editorial pass a typesetter makes before a book is printed. Rows come
 * in reading order exactly as ingestion and translation left them — a paragraph broken at a column or page end, a
 * bullet list run into one paragraph, a heading set in capitals that became body text, the source book's own table
 * of contents with its dot leaders. Reflow repairs the shape of the text without ever changing its words.
 *
 * Decisions about *where a sentence ends* are made on the source text in the source language (a translator may
 * close a fragment with a full stop); splits are made on the displayed text and carried to the source only when it
 * splits the same way.
 */
export interface FlowRow {
  /** heading · subheading · paragraph · list_item · quote · caption · footnote · code · … */
  type: string;
  src: string;
  tgt: string;
  /** Segments this row is made of, in order (stable ids; figures are placed by them). */
  ids: string[];
  /** A list item's marker: a bullet the layout draws, or a marker written in the text itself («الف -», «۲ -»). */
  marker?: 'bullet' | 'own';
}

export interface ReflowOptions {
  sourceLang: string;
  targetLang: string;
}

const CONTINUES = new Set(['paragraph', 'quote', 'list_item', 'footnote']);
const CONTINUATION = new Set(['paragraph', 'quote']);
const BULLET_START = /^\s*[•●▪◦‣⁃]\s*/u;
const INLINE_BULLET = /\s+[•●▪◦]\s+/u;
/** A run of dot leaders: a line of a printed table of contents. */
const LEADERS = /(?:[.…·]\s?){5,}|_{5,}/u;
const DIGITS = '[0-9۰-۹٠-٩]';

const plain = (s: string) => stripMarkup(s).trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A line of the source book's own table of contents («Chapter 3 ........ 45»): the export makes its own. */
export function isLeaderLine(text: string): boolean {
  return LEADERS.test(text);
}

/** Nothing to read: a stray dash, a lone number left by a figure or a table. */
function isNoise(row: FlowRow): boolean {
  const text = plain(row.tgt || row.src);
  if (!text) return true;
  return !/\p{L}/u.test(text) && text.length < 12;
}

/**
 * A short line set in capitals in a Latin-script book — «KEY POINTS», «THE 1960s», «Hb-BASED OXYGEN CARRIERS» — is
 * a run-in subheading that ingestion read as a paragraph.
 */
export function isCapsHeading(src: string, lang: string): boolean {
  if (getLanguage(lang).script !== 'Latn') return false;
  const text = plain(src);
  if (!text || text.length > 90 || text.split(/\s+/).length > 12) return false;
  if (/[.;,]$/.test(text)) return false;
  const letters = text.replace(/(\d)s\b/g, '$1').match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return false;
  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
  return upper / letters.length >= 0.8;
}

/** «Box 45.1 Infectious Disease Testing» — the title of a boxed sidebar. */
export function isBoxTitle(src: string, lang: string): boolean {
  const words = getLanguage(lang).boxWords;
  if (!words?.length) return false;
  const text = plain(src);
  const pattern = String.raw`^(?:${words.map(escapeRe).join('|')})\s+${DIGITS}+(?:[.\-–]${DIGITS}+)*(?![0-9۰-۹٠-٩])`;
  return text.length <= 140 && new RegExp(pattern, 'u').test(text);
}

function startsUpper(text: string): boolean {
  const first = plain(text).match(/\p{L}/u)?.[0];
  return Boolean(first && first === first.toUpperCase() && first !== first.toLowerCase());
}

function shouldJoin(prev: FlowRow, cur: FlowRow, opts: ReflowOptions): boolean {
  if (!CONTINUES.has(prev.type) || !CONTINUATION.has(cur.type)) return false;
  if (startsWithListMarker(cur.src) || BULLET_START.test(cur.tgt) || BULLET_START.test(cur.src)) return false;
  const prevText = plain(prev.src);
  if (/[A-Za-z]-$/.test(prevText)) return true;
  if (endsWithTerminalPunctuation(prev.src, opts.sourceLang)) return false;
  // A sentence that ends in reference numbers printed as plain digits («… required.25,26»).
  if (/[.!?؟]["”’»)]?\s*[0-9۰-۹]+(?:[,–-][0-9۰-۹]+)*$/u.test(prevText)) return false;
  // A short line without a full stop is a label or a heading, not the first half of a sentence.
  if (prevText.length < 25) return false;
  if (getLanguage(opts.sourceLang).script === 'Latn' && startsUpper(cur.src) && prevText.length < 60) return false;
  return true;
}

function joinText(a: string, b: string, lang: string): string {
  const left = a.trimEnd();
  const right = b.trimStart();
  if (!left) return right;
  if (!right) return left;
  if (getLanguage(lang).script === 'Latn' && /[A-Za-z]-$/.test(left) && /^[a-z]/.test(right)) {
    return left.slice(0, -1) + right;
  }
  return `${left} ${right}`;
}

/** Splits `text` before each piece that opens a new item; the pattern matches the gap between items. */
function splitBy(text: string, gap: RegExp): string[] {
  return text
    .split(gap)
    .map((s) => s.trim())
    .filter(Boolean);
}

function articlePattern(lang: string): RegExp | undefined {
  const info = getLanguage(lang);
  const letters = info.listLetters?.map(escapeRe).join('|');
  const words = info.articleWords?.map(escapeRe).join('|');
  const alternatives = [
    `(?:${DIGITS}{1,3}${letters ? `|${letters}` : ''})\\s*[-–ـ)]\\s`,
    ...(words ? [`(?:${words})\\s+${DIGITS}+`] : []),
  ];
  return new RegExp(`(?<=[.؛:!؟?])\\s+(?=${alternatives.join('|')})`, 'u');
}

/** Pieces of a row, with the source carried along only when it splits into the same number of pieces. */
function splitRow(row: FlowRow, pieces: string[], srcPieces: string[], type: (i: number) => FlowRow): FlowRow[] {
  const zipped = srcPieces.length === pieces.length;
  return pieces.map((tgt, i) => ({
    ...type(i),
    tgt,
    src: zipped ? (srcPieces[i] ?? '') : i === 0 ? row.src : '',
    ids: i === 0 ? row.ids : [],
  }));
}

function splitBullets(row: FlowRow): FlowRow[] {
  const text = row.tgt || row.src;
  const leading = BULLET_START.test(text);
  const pieces = splitBy(text.replace(BULLET_START, ''), INLINE_BULLET);
  if (!leading && pieces.length < 2) return [row];
  const srcPieces = splitBy(row.src.replace(BULLET_START, ''), INLINE_BULLET);
  const out = splitRow(row, pieces, srcPieces, (i) => ({
    ...row,
    type: i === 0 && !leading ? row.type : 'list_item',
    ...(i === 0 && !leading ? {} : { marker: 'bullet' as const }),
  }));
  if (!row.tgt) for (const r of out) r.tgt = '';
  return out;
}

function splitArticles(row: FlowRow, opts: ReflowOptions): FlowRow[] {
  if (row.type !== 'paragraph' && row.type !== 'quote' && row.type !== 'list_item') return [row];
  const lang = row.tgt ? opts.targetLang : opts.sourceLang;
  const gap = articlePattern(lang);
  const text = row.tgt || row.src;
  if (!gap) return [row];
  const pieces = splitBy(text, gap);
  if (pieces.length < 2) return [row];
  const srcPieces = row.tgt ? splitBy(row.src, articlePattern(opts.sourceLang) ?? gap) : pieces;
  const out = splitRow(row, pieces, srcPieces, (i) => (i === 0 ? { ...row } : { ...row, type: 'list_item' }));
  for (const [i, r] of out.entries()) {
    if (i > 0) r.marker = 'own';
    if (!row.tgt) r.tgt = '';
  }
  return out;
}

const sameHeading = (a: FlowRow, b: FlowRow) =>
  (a.type === 'heading' || a.type === 'subheading') &&
  a.type === b.type &&
  plain(a.tgt || a.src).replace(/[:.\s]+$/u, '') === plain(b.tgt || b.src).replace(/[:.\s]+$/u, '');

/**
 * The editorial pass over one section's rows: drops the source's own contents lines and stray marks, turns
 * capital-letter lines into subheadings, joins paragraphs broken mid-sentence, and splits paragraphs that swallowed
 * a bullet list or a run of numbered articles. Words are never changed, added or removed.
 */
export function reflowRows(rows: FlowRow[], opts: ReflowOptions): FlowRow[] {
  const kept: FlowRow[] = [];
  for (const row of rows) {
    if (isLeaderLine(row.src) || isLeaderLine(row.tgt) || isNoise(row)) continue;
    const typed =
      (row.type === 'paragraph' || row.type === 'quote' || row.type === 'caption') &&
      (isCapsHeading(row.src, opts.sourceLang) || isBoxTitle(row.src, opts.sourceLang))
        ? { ...row, type: 'subheading' }
        : { ...row };
    const prev = kept[kept.length - 1];
    if (prev && shouldJoin(prev, typed, opts)) {
      prev.src = joinText(prev.src, typed.src, opts.sourceLang);
      prev.tgt = joinText(prev.tgt, typed.tgt, opts.targetLang);
      prev.ids = [...prev.ids, ...typed.ids];
      continue;
    }
    if (prev && sameHeading(prev, typed)) {
      prev.ids = [...prev.ids, ...typed.ids];
      continue;
    }
    kept.push(typed);
  }

  const out: FlowRow[] = [];
  for (const row of kept) {
    for (const piece of splitBullets(row)) out.push(...splitArticles(piece, opts));
  }
  for (const row of out) {
    if (row.type !== 'list_item' || row.marker) continue;
    // A dash or star written before an item is a bullet the layout draws; a number or a letter stays in the text.
    if (DASH_MARKER.test(row.tgt || row.src)) {
      row.tgt = row.tgt.replace(DASH_MARKER, '');
      row.src = row.src.replace(DASH_MARKER, '');
      row.marker = 'bullet';
    } else {
      row.marker = ownMarker(opts.targetLang).test(row.tgt || row.src) ? 'own' : 'bullet';
    }
  }
  return out;
}

const DASH_MARKER = /^\s*[-–—*]\s+/u;

function ownMarker(lang: string): RegExp {
  const letters = getLanguage(lang).listLetters?.map(escapeRe).join('|');
  return new RegExp(
    `^\\s*(?:\\(?${DIGITS}{1,3}\\s*[.)\\-–]|\\(?[a-z][.)]|[ivx]{1,4}\\.${letters ? `|(?:${letters})\\s*[-–)]` : ''})`,
    'iu',
  );
}
