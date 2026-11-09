/**
 * Placing layers on a cover: the safe area (type stays clear of the trim), the nine positions of the layout grid,
 * snapping while dragging (centre, thirds, safe edges, other layers), and moving with the keyboard. All values are
 * percentages of the cover: x and widths of its width, y and heights of its height.
 */

/** Safe margin in % of the cover's width (≈ 10 mm on A4): nothing important is set outside it. */
export const SAFE_MARGIN = 5;

/** Width ÷ height of a cover page. */
export type Aspect = number;

/** The safe margin as % of the height, for a cover of this aspect (the same distance in millimetres). */
export function safeMarginY(aspect: Aspect): number {
  return SAFE_MARGIN * aspect;
}

export interface Box {
  /** Centre. */
  x: number;
  y: number;
  /** Size. */
  w: number;
  h: number;
}

export type Horizontal = 'left' | 'center' | 'right';
export type Vertical = 'top' | 'middle' | 'bottom';

/** Centre of a box placed at one of the nine grid positions, inside the safe area. */
export function gridPosition(box: Pick<Box, 'w' | 'h'>, h: Horizontal, v: Vertical, aspect: Aspect) {
  const my = safeMarginY(aspect) + 4;
  const x = h === 'left' ? SAFE_MARGIN + box.w / 2 : h === 'right' ? 100 - SAFE_MARGIN - box.w / 2 : 50;
  const y = v === 'top' ? my + box.h / 2 : v === 'bottom' ? 100 - my - box.h / 2 : 50;
  return { x: round(Math.min(Math.max(x, 0), 100)), y: round(Math.min(Math.max(y, 0), 100)) };
}

/** The part of a box outside the safe area, or null when it is inside. */
export function outsideSafe(
  box: Box,
  aspect: Aspect,
): null | { left: boolean; right: boolean; top: boolean; bottom: boolean } {
  const my = safeMarginY(aspect);
  const eps = 0.05;
  const out = {
    left: box.x - box.w / 2 < SAFE_MARGIN - eps,
    right: box.x + box.w / 2 > 100 - SAFE_MARGIN + eps,
    top: box.y - box.h / 2 < my - eps,
    bottom: box.y + box.h / 2 > 100 - my + eps,
  };
  return out.left || out.right || out.top || out.bottom ? out : null;
}

export interface Guide {
  axis: 'x' | 'y';
  /** Where the guide is drawn, in %. */
  at: number;
  kind: 'center' | 'third' | 'safe' | 'layer';
}

interface Target {
  at: number;
  kind: Guide['kind'];
}

/**
 * Snaps a dragged box: its centre to the cover's centre lines, the thirds and other layers' centres; its edges to the
 * safe area. `threshold` is in %. Returns the snapped centre and the guides to draw.
 */
export function snapBox(
  box: Box,
  others: Box[],
  aspect: Aspect,
  threshold = 1.2,
): { x: number; y: number; guides: Guide[] } {
  const my = safeMarginY(aspect);
  const xTargets: Target[] = [{ at: 50, kind: 'center' }, ...others.map((o) => ({ at: o.x, kind: 'layer' as const }))];
  const yTargets: Target[] = [
    { at: 50, kind: 'center' },
    { at: 100 / 3, kind: 'third' },
    { at: 200 / 3, kind: 'third' },
    ...others.map((o) => ({ at: o.y, kind: 'layer' as const })),
  ];
  const guides: Guide[] = [];

  const pick = (
    value: number,
    half: number,
    targets: Target[],
    low: number,
    high: number,
  ): { value: number; guide?: Target } => {
    let best: { d: number; value: number; guide: Target } | undefined;
    const consider = (d: number, v: number, guide: Target) => {
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, value: v, guide };
    };
    for (const t of targets) consider(t.at - value, t.at, t);
    consider(low - (value - half), low + half, { at: low, kind: 'safe' });
    consider(high - (value + half), high - half, { at: high, kind: 'safe' });
    return best ? { value: best.value, guide: best.guide } : { value };
  };

  const sx = pick(box.x, box.w / 2, xTargets, SAFE_MARGIN, 100 - SAFE_MARGIN);
  const sy = pick(box.y, box.h / 2, yTargets, my, 100 - my);
  if (sx.guide) guides.push({ axis: 'x', ...sx.guide });
  if (sy.guide) guides.push({ axis: 'y', ...sy.guide });
  return { x: round(sx.value), y: round(sy.value), guides };
}

/** One press of an arrow key: 0.5 %, or 2 % with Shift. */
export function nudge(pos: { x: number; y: number }, key: string, big: boolean): { x: number; y: number } | null {
  const step = big ? 2 : 0.5;
  const d: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const m = d[key];
  if (!m) return null;
  return { x: clamp(round(pos.x + m[0]), -20, 120), y: clamp(round(pos.y + m[1]), -20, 120) };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function round(v: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
