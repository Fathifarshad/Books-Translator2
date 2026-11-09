/**
 * Colour maths for covers: WCAG contrast between a layer's type and what lies under it, mixing, and a readable ink
 * for a given ground. Colours are `#rrggbb`.
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#([0-9a-f]{6})$/i;

/** A colour from the design, or the fallback when it is not `#rrggbb` (the renderer never prints unchecked text). */
export function safeHex(value: string, fallback = '#000000'): string {
  return HEX.test(value) ? value.toLowerCase() : fallback;
}

export function parseHex(hex: string): Rgb {
  const m = HEX.exec(hex);
  const n = m?.[1] ? Number.parseInt(m[1], 16) : 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(safeHex(hex));
  return `rgba(${r},${g},${b},${Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000})`;
}

/** `a` laid over `b` with `alpha` (0 = only b, 1 = only a). */
export function mix(a: Rgb, b: Rgb, alpha: number): Rgb {
  const t = Math.min(1, Math.max(0, alpha));
  return { r: a.r * t + b.r * (1 - t), g: a.g * t + b.g * (1 - t), b: a.b * t + b.b * (1 - t) };
}

/** Relative luminance (WCAG 2). */
export function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio, 1…21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Large type on a cover needs 3:1 (WCAG AA for large text); 4.5:1 reads well even small. Below 3 the owner is
 * warned; a stroke or a band under the type counts as its ground.
 */
export const MIN_CONTRAST = 3;
export const GOOD_CONTRAST = 4.5;

/** Black or white, whichever reads better on `ground`. */
export function readableInk(ground: Rgb): string {
  return contrastRatio(ground, { r: 255, g: 255, b: 255 }) >= contrastRatio(ground, { r: 17, g: 17, b: 17 })
    ? '#ffffff'
    : '#111111';
}

/** Pixels as the canvas gives them: RGBA, row by row. */
export interface Pixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/**
 * Average colour of each cell of a region (x, y, w, h in % of the picture), `cols` × `rows` cells: a busy image is
 * judged by its worst cell, not by an average that hides a bright patch behind the type.
 */
export function regionColors(
  px: Pixels,
  box: { x: number; y: number; w: number; h: number },
  cols = 4,
  rows = 2,
): Rgb[] {
  const x0 = Math.max(0, Math.floor(((box.x - box.w / 2) / 100) * px.width));
  const x1 = Math.min(px.width, Math.ceil(((box.x + box.w / 2) / 100) * px.width));
  const y0 = Math.max(0, Math.floor(((box.y - box.h / 2) / 100) * px.height));
  const y1 = Math.min(px.height, Math.ceil(((box.y + box.h / 2) / 100) * px.height));
  if (x1 <= x0 || y1 <= y0) return [];
  const out: Rgb[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx0 = x0 + Math.floor(((x1 - x0) * c) / cols);
      const cx1 = x0 + Math.floor(((x1 - x0) * (c + 1)) / cols);
      const cy0 = y0 + Math.floor(((y1 - y0) * r) / rows);
      const cy1 = y0 + Math.floor(((y1 - y0) * (r + 1)) / rows);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      for (let y = cy0; y < cy1; y++) {
        for (let x = cx0; x < cx1; x++) {
          const i = (y * px.width + x) * 4;
          sr += px.data[i] ?? 0;
          sg += px.data[i + 1] ?? 0;
          sb += px.data[i + 2] ?? 0;
          count++;
        }
      }
      if (count) out.push({ r: sr / count, g: sg / count, b: sb / count });
    }
  }
  return out;
}

/**
 * How well a text layer reads on what is under it: the worst cell's contrast. A band under the type becomes its
 * ground; a visible outline (≥ 0.02 em) in a contrasting colour carries the letters on its own.
 */
export function textContrast(
  ink: string,
  grounds: Rgb[],
  opts: { band?: { color: string; opacity: number } | null; stroke?: { color: string; width: number } | null } = {},
): number {
  if (!grounds.length) return 21;
  const text = parseHex(safeHex(ink));
  const band = opts.band && opts.band.opacity > 0 ? opts.band : null;
  const under = band ? grounds.map((g) => mix(parseHex(safeHex(band.color)), g, band.opacity)) : grounds;
  const worst = Math.min(...under.map((g) => contrastRatio(text, g)));
  if (opts.stroke && opts.stroke.width >= 0.02) {
    return Math.max(worst, contrastRatio(text, parseHex(safeHex(opts.stroke.color))));
  }
  return worst;
}
