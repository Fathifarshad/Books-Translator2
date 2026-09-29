import type { Line, PageData } from './types';

export interface OrderedLine extends Line {
  column: number;
}

/**
 * Reading order on one page (SPEC §8.4): detects two-column regions by clustering line extents around
 * the page middle; lines spanning the middle stay in place, column regions read column 1 then column 2
 * (reversed for right-to-left source languages).
 */
export function orderPage(page: PageData, rtl = false): OrderedLine[] {
  const lines = [...page.lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  if (lines.length < 6) return lines.map((l) => ({ ...l, column: 0 }));
  const left = Math.min(...lines.map((l) => l.x0));
  const right = Math.max(...lines.map((l) => l.x1));
  const mid = (left + right) / 2;
  const gutter = (right - left) * 0.02;
  const inLeft = (l: Line) => l.x1 <= mid + gutter;
  const inRight = (l: Line) => l.x0 >= mid - gutter;
  const leftCount = lines.filter(inLeft).length;
  const rightCount = lines.filter(inRight).length;
  // Two columns only when both sides carry a substantial share of the page's lines.
  if (leftCount < lines.length * 0.25 || rightCount < lines.length * 0.25)
    return lines.map((l) => ({ ...l, column: 0 }));

  const out: OrderedLine[] = [];
  let region: Line[] = [];
  const flush = () => {
    const first = region.filter(rtl ? inRight : inLeft);
    const second = region.filter((l) => !first.includes(l));
    out.push(...first.map((l) => ({ ...l, column: 1 })), ...second.map((l) => ({ ...l, column: 2 })));
    region = [];
  };
  for (const line of lines) {
    const spanning = !inLeft(line) && !inRight(line);
    if (spanning) {
      flush();
      out.push({ ...line, column: 0 });
    } else region.push(line);
  }
  flush();
  return out;
}

/** Most common value of `pick` weighted by characters (body font size, body line gap). */
export function weightedMode(lines: Line[], pick: (l: Line) => number | null, step = 0.5): number | null {
  const counts = new Map<number, number>();
  for (const l of lines) {
    const v = pick(l);
    if (v === null || !Number.isFinite(v)) continue;
    const key = Math.round(v / step) * step;
    counts.set(key, (counts.get(key) ?? 0) + l.text.length);
  }
  let best: number | null = null;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))] as number;
}
