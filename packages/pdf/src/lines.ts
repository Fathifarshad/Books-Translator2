import type { Line, TextRun } from './types';

export interface RawItem {
  text: string;
  x: number;
  /** Baseline distance from the page top. */
  y: number;
  width: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

/** Widest a character can plausibly be, as a share of the font size (a wide capital M is about 0.9 em). */
const MAX_WIDTH_PER_CHAR = 1.1;

/**
 * An item's width, with a nonsense value brought back to what its characters can cover (ADR-039). A text layer
 * written by an OCR tool (PDF24, ocrmypdf: `GlyphLessFont`) reports widths of hundreds of points for a short
 * word, and such an item decides where the page appears to end — which is where its columns are looked for.
 */
export function plausibleWidth(width: number, size: number, text: string): number {
  const chars = Math.max(1, text.trim().length);
  return Math.min(Math.max(1, width), size * MAX_WIDTH_PER_CHAR * chars);
}

/**
 * Groups text items into lines by baseline (tolerance ≈ 0.3 × font size) and orders them by x
 * (SPEC §8.4). Smaller items raised above the baseline become superscripts (footnote markers).
 * In a right-to-left book (`rtl`) a line reads from its right edge, with embedded Latin runs kept left to right.
 */
export function buildLines(items: RawItem[], page: number, rtl = false): Line[] {
  const sorted = items.filter((i) => i.text.length > 0).sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: RawItem[][] = [];
  for (const item of sorted) {
    const group = groups.find((g) => {
      const main = dominant(g);
      const tol = Math.max(main.size, item.size) * 0.3;
      if (Math.abs(main.y - item.y) <= tol) return true;
      // Superscript: smaller text slightly above the baseline of a larger line.
      return (
        item.size < main.size * 0.85 && item.y < main.y && main.y - item.y <= main.size * 0.6 && overlapsX(g, item)
      );
    });
    if (group) group.push(item);
    else groups.push([item]);
  }
  // A small raised group processed before its line (sorted by y) is a superscript of the line below it.
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] as RawItem[];
    const small = dominant(g);
    const host = groups.find(
      (h) =>
        h !== g &&
        small.size < dominant(h).size * 0.85 &&
        small.y < dominant(h).y &&
        dominant(h).y - small.y <= dominant(h).size * 0.6 &&
        g.every((it) => overlapsX(h, it)),
    );
    if (host) {
      host.push(...g);
      groups.splice(i, 1);
    }
  }
  // Same baseline but separated by a column gutter → separate lines.
  return groups
    .flatMap(splitAtGutters)
    .map((g) => toLine(g, page, rtl))
    .sort((a, b) => a.y - b.y || (rtl ? b.x1 - a.x1 : a.x0 - b.x0));
}

/** Right-to-left letters (Arabic, Persian, Hebrew…) and left-to-right ones (Latin letters, digits). */
const STRONG_RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}]/u;
const STRONG_LTR = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}0-9]/u;

/**
 * Logical order of a right-to-left line's items: from the right edge to the left, except that a run of
 * left-to-right items (an English term, a number written in Latin digits, `p < 0.05`) reads left to right inside
 * it. Neutral items (punctuation, spaces) between two such items belong to the run; elsewhere they stay put.
 * pdf.js already gives every single item in logical order, so only the order *between* items is decided here.
 */
export function rtlOrder<T extends { x: number; width: number; text: string }>(items: T[]): T[] {
  const ordered = [...items].sort((a, b) => b.x + b.width - (a.x + a.width) || b.x - a.x);
  const kind = (it: T) => (STRONG_RTL.test(it.text) ? 'rtl' : STRONG_LTR.test(it.text) ? 'ltr' : 'neutral');
  const out: T[] = [];
  let i = 0;
  while (i < ordered.length) {
    const it = ordered[i] as T;
    if (kind(it) !== 'ltr') {
      out.push(it);
      i++;
      continue;
    }
    // The run ends at the last LTR item before the next RTL item.
    let end = i;
    for (let j = i + 1; j < ordered.length && kind(ordered[j] as T) !== 'rtl'; j++) {
      if (kind(ordered[j] as T) === 'ltr') end = j;
    }
    out.push(...ordered.slice(i, end + 1).reverse());
    i = end + 1;
  }
  return out;
}

/**
 * A gap this many font sizes wide, on one baseline, is a column gutter and not word spacing. Justified Latin
 * text stretches its spaces to about 1.2 em at the very most; a two-column medical page leaves 1.8 em between
 * the columns, and at the old threshold of 1.8 em that gutter fell exactly on the boundary — the two columns
 * became one line, which no later step can take apart (ADR-039).
 */
const GUTTER_EMS = 1.6;

function splitAtGutters(group: RawItem[]): RawItem[][] {
  const items = [...group].sort((a, b) => a.x - b.x);
  const out: RawItem[][] = [[]];
  let prevEnd: number | null = null;
  for (const it of items) {
    if (prevEnd !== null && it.x - prevEnd > Math.max(it.size, 6) * GUTTER_EMS && it.text.trim()) out.push([]);
    (out[out.length - 1] as RawItem[]).push(it);
    prevEnd = Math.max(prevEnd ?? 0, it.x + it.width);
  }
  return out.filter((g) => g.some((i) => i.text.trim()));
}

function overlapsX(group: RawItem[], item: RawItem): boolean {
  const x0 = Math.min(...group.map((g) => g.x));
  const x1 = Math.max(...group.map((g) => g.x + g.width));
  return item.x >= x0 - item.size * 2 && item.x <= x1 + item.size * 2;
}

function dominant(group: RawItem[]): RawItem {
  let best = group[0] as RawItem;
  for (const g of group) if (g.text.trim().length > best.text.trim().length || g.size > best.size * 1.1) best = g;
  return best;
}

function toLine(group: RawItem[], page: number, rtl = false): Line {
  const bySize = new Map<number, number>();
  for (const g of group) {
    const key = Math.round(g.size * 2) / 2;
    bySize.set(key, (bySize.get(key) ?? 0) + g.text.trim().length);
  }
  const size = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? group[0]?.size ?? 10;
  const baseline = group.find((g) => Math.abs(g.size - size) < 0.6)?.y ?? group[0]?.y ?? 0;
  const items = rtl ? rtlOrder(group) : [...group].sort((a, b) => a.x - b.x);
  const runs: TextRun[] = [];
  let prevEnd: number | null = null;
  let prev: RawItem | undefined;
  for (const it of items) {
    const sup = it.size < size * 0.85 && baseline - it.y > size * 0.15;
    // Insert a space when there is a visible gap and neither side already has one. Right to left, the gap is the
    // distance between the two boxes, whichever side the previous item is on.
    const gap = rtl
      ? prev
        ? Math.max(it.x - (prev.x + prev.width), prev.x - (it.x + it.width))
        : null
      : prevEnd !== null
        ? it.x - prevEnd
        : null;
    if (gap !== null && gap > Math.min(it.size, size) * 0.15) {
      const last = runs[runs.length - 1];
      if (last && !/\s$/.test(last.text) && !/^\s/.test(it.text) && !sup) last.text += ' ';
    }
    prev = it;
    const run: TextRun = {
      text: it.text,
      x: it.x,
      width: it.width,
      size: it.size,
      font: it.font,
      bold: it.bold,
      italic: it.italic,
      mono: it.mono,
      sup,
    };
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, run) && !sup && !last.sup) {
      last.text += run.text;
      if (rtl) {
        const x0 = Math.min(last.x, run.x);
        last.width = Math.max(last.x + last.width, run.x + run.width) - x0;
        last.x = x0;
      } else last.width = run.x + run.width - last.x;
    } else runs.push(run);
    prevEnd = it.x + it.width;
  }
  const text = runs
    .map((r) => r.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = (pred: (r: TextRun) => boolean) =>
    runs.filter((r) => pred(r) && !r.sup).reduce((n, r) => n + r.text.trim().length, 0);
  const total = Math.max(
    1,
    chars(() => true),
  );
  const x0 = Math.min(...items.map((i) => i.x));
  const x1 = Math.max(...items.map((i) => i.x + i.width));
  return {
    page,
    y: baseline,
    x0,
    x1,
    size,
    runs,
    text,
    bold: chars((r) => r.bold) / total > 0.8,
    italic: chars((r) => r.italic) / total > 0.8,
    mono: chars((r) => r.mono) / total > 0.8,
  };
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.mono === b.mono && Math.abs(a.size - b.size) < 0.6;
}
