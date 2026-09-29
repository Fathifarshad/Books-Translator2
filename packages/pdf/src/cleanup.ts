import { weightedMode } from './layout';
import { titleSimilarity } from './similarity';
import type { Line, OutlineEntry, PageData } from './types';

const ZONE = 0.08;
const LONE_PAGE_NUMBER = /^(?:page\s+)?[-–—\s]*(?:\d{1,4}|[ivxlcdm]{1,7})[-–—\s]*$/i;

/** Normalized form used to recognise repeating header/footer lines ("12 Chapter One" → "# chapter one"). */
export function headerPattern(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\b[ivxlcdm]{1,7}\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function inZone(line: Line, page: PageData, zone: number): 'top' | 'bottom' | null {
  if (line.y <= page.height * zone + line.size) return 'top';
  if (line.y >= page.height * (1 - zone)) return 'bottom';
  return null;
}

/** Top-level outline entries give chapter page ranges (running heads often repeat per chapter). */
function chapterRanges(outline: OutlineEntry[], pageCount: number): [number, number][] {
  const starts = outline
    .map((o) => o.pageIndex)
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
  if (starts.length === 0) return [[0, pageCount - 1]];
  const ranges: [number, number][] = [];
  if ((starts[0] as number) > 0) ranges.push([0, (starts[0] as number) - 1]);
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? (starts[i + 1] as number) - 1 : pageCount - 1;
    if (end >= s) ranges.push([s, end]);
  });
  return ranges;
}

export interface CleanupResult {
  pages: PageData[];
  removed: number;
  /** Printed page numbers found in headers/footers, by page index. */
  printed: Map<number, string>;
}

/**
 * Removes running headers/footers and lone page numbers (SPEC §8.3): candidate lines in the top/bottom ~8%
 * of each page whose normalized pattern repeats on ≥ 25% of the pages of a chapter range (at least twice).
 */
export function removeHeadersFooters(
  pages: PageData[],
  outline: OutlineEntry[],
  zone = ZONE,
  knownTitles: string[] = [],
): CleanupResult {
  // Running heads usually repeat the book title or a chapter title in small type.
  const bodySize =
    weightedMode(
      pages.flatMap((p) => p.lines),
      (l) => l.size,
    ) ?? 10;
  // …which also appear as large headings somewhere in the book.
  const bigHeadings = pages.flatMap((p) => p.lines.filter((l) => l.size >= bodySize * 1.3).map((l) => l.text));
  const titles = [...new Set([...knownTitles, ...outline.map((o) => o.title), ...bigHeadings])].filter(
    (t) => t.trim().length > 2,
  );
  const isTitleHead = (line: Line) =>
    line.size <= bodySize * 1.05 && titles.some((t) => titleSimilarity(t, line.text) >= 0.9);
  const counts = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const line of page.lines) {
      const where = inZone(line, page, zone);
      if (!where) continue;
      const key = `${where}|${headerPattern(line.text)}`;
      const set = counts.get(key) ?? new Set<number>();
      set.add(page.index);
      counts.set(key, set);
    }
  }
  const ranges = chapterRanges(outline, Math.max(...pages.map((p) => p.index), 0) + 1);
  const repeating = new Set<string>();
  for (const [key, pagesWith] of counts) {
    if (pagesWith.size < 2) continue;
    const total = pagesWith.size / Math.max(1, pages.length);
    const inRange = ranges.some(([a, b]) => {
      const n = [...pagesWith].filter((p) => p >= a && p <= b).length;
      return n >= 2 && n >= Math.ceil((b - a + 1) * 0.25);
    });
    if (total >= 0.25 || inRange) repeating.add(key);
  }

  let removed = 0;
  const printed = new Map<number, string>();
  const out = pages.map((page) => {
    const lines = page.lines.filter((line) => {
      const where = inZone(line, page, zone);
      if (!where) return true;
      const lone = LONE_PAGE_NUMBER.test(line.text);
      const drop = lone || repeating.has(`${where}|${headerPattern(line.text)}`) || isTitleHead(line);
      if (lone) printed.set(page.index, line.text.replace(/^page\s+/i, '').replace(/[-–—\s]/g, ''));
      else if (drop) {
        // "12   Chapter One" style running heads carry the printed number too.
        const n = /^(\d{1,4})\s|\s(\d{1,4})$/.exec(line.text.trim());
        if (n) printed.set(page.index, (n[1] ?? n[2]) as string);
      }
      if (drop) removed++;
      return !drop;
    });
    return { ...page, lines };
  });
  return { pages: out, removed, printed };
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

export function toRoman(n: number): string {
  let out = '';
  let rest = n;
  for (const [v, s] of ROMAN) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}

/**
 * Page labels: from the PDF when defined; otherwise inferred from printed page numbers (most common
 * offset between page index and printed number); pages before the numbering get roman numerals.
 */
export function inferPageLabels(pageCount: number, fromPdf: string[] | null, printed: Map<number, string>): string[] {
  if (fromPdf && fromPdf.length === pageCount) return fromPdf;
  const offsets = new Map<number, number>();
  for (const [index, label] of printed) {
    if (!/^\d+$/.test(label)) continue;
    const off = index - Number(label);
    offsets.set(off, (offsets.get(off) ?? 0) + 1);
  }
  const best = [...offsets.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 2) return Array.from({ length: pageCount }, (_, i) => String(i + 1));
  const offset = best[0];
  return Array.from({ length: pageCount }, (_, i) =>
    i - offset >= 1 ? String(i - offset) : (printed.get(i) ?? toRoman(i + 1)),
  );
}
