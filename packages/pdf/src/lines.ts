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

/**
 * Groups text items into lines by baseline (tolerance ≈ 0.3 × font size) and orders them by x
 * (SPEC §8.4). Smaller items raised above the baseline become superscripts (footnote markers).
 */
export function buildLines(items: RawItem[], page: number): Line[] {
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
    .map((g) => toLine(g, page))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
}

function splitAtGutters(group: RawItem[]): RawItem[][] {
  const items = [...group].sort((a, b) => a.x - b.x);
  const out: RawItem[][] = [[]];
  let prevEnd: number | null = null;
  for (const it of items) {
    if (prevEnd !== null && it.x - prevEnd > Math.max(it.size, 6) * 1.8 && it.text.trim()) out.push([]);
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

function toLine(group: RawItem[], page: number): Line {
  const bySize = new Map<number, number>();
  for (const g of group) {
    const key = Math.round(g.size * 2) / 2;
    bySize.set(key, (bySize.get(key) ?? 0) + g.text.trim().length);
  }
  const size = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? group[0]?.size ?? 10;
  const baseline = group.find((g) => Math.abs(g.size - size) < 0.6)?.y ?? group[0]?.y ?? 0;
  const items = [...group].sort((a, b) => a.x - b.x);
  const runs: TextRun[] = [];
  let prevEnd: number | null = null;
  for (const it of items) {
    const sup = it.size < size * 0.85 && baseline - it.y > size * 0.15;
    // Insert a space when there is a visible gap and neither side already has one.
    if (prevEnd !== null && it.x - prevEnd > Math.min(it.size, size) * 0.15) {
      const last = runs[runs.length - 1];
      if (last && !/\s$/.test(last.text) && !/^\s/.test(it.text) && !sup) last.text += ' ';
    }
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
      last.width = run.x + run.width - last.x;
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
