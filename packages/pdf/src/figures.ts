import { getLanguage, toLatinDigits } from '@dozabaneh/text';
import type { Box } from './types';

/**
 * Figures, algorithms, charts and tables of a printed page (ADR-046), found from geometry alone:
 *
 * - **ink** — what the page draws once its text is taken away (boxes, arrows, rules, shaded table backgrounds,
 *   pictures), as connected components of a coarse grid;
 * - **captions** — lines that open with a caption word of the source language («Fig. 45.7», «Table 45.1»,
 *   «جدول ۳»), read from the language registry;
 * - **text pieces** — the words printed on the page, with their positions.
 *
 * A figure is the drawing that grows from its caption (upwards for a figure, downwards for a table), together with
 * the text printed inside it: those words are its labels, translated and set back in place by the exporter. Nothing
 * here touches pdf.js, so every rule is tested on synthetic geometry.
 */

/** A run of text on one line, in page points from the top-left corner. */
export interface TextPiece {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Font size (points). */
  size: number;
  /** Rotation in degrees (0 = horizontal, 90 = reading upwards). */
  angle: number;
}

export interface InkComponent extends Box {
  /** Share of the box that is drawn (1 = a filled rectangle, small = lines and arrows). */
  fill: number;
}

export type FigureKind = 'figure' | 'table' | 'image';

/** One label of a figure, positioned relative to the figure's crop box (points). */
export interface FigureLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: number;
  angle: number;
  lines: number;
  /**
   * The free space around the label in the drawing (the inside of its flowchart box, up to the next line or arrow),
   * relative to the figure: the translated label may use all of it. Measured on the drawn page; absent for tables.
   */
  room?: Box;
}

export interface FigureRegion {
  kind: FigureKind;
  page: number;
  /** The printed number of the figure or table («45.7»), with Latin digits. */
  number?: string;
  /** The caption as printed (all its lines). */
  caption?: string;
  captionBox?: Box;
  /** The part of the page the image is cut from (points, top-left origin). */
  box: Box;
  labels: FigureLabel[];
}

export interface FigurePage {
  index: number;
  width: number;
  height: number;
  pieces: TextPiece[];
  ink: InkComponent[];
  /** Pictures known from ingestion (figure segments with a box) that may have no caption. */
  images?: Box[];
}

// ── Ink: connected components of a coarse grid ──────────────────────────────────────────────────────────────────

/**
 * Connected components of a boolean grid (`mask[y * cols + x]`), each cell `cell` points wide. Cells closer than
 * `gap` cells belong together, so an arrow touching a box, or a dashed rule, is one component.
 */
export function inkComponents(mask: Uint8Array, cols: number, rows: number, cell: number, gap = 1): InkComponent[] {
  const seen = new Uint8Array(mask.length);
  const out: InkComponent[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let x0 = cols;
    let y0 = rows;
    let x1 = -1;
    let y1 = -1;
    let count = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop() as number;
      const x = i % cols;
      const y = (i - x) / cols;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -gap; dy <= gap; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -gap; dx <= gap; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= cols) continue;
          const j = ny * cols + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    out.push({ x: x0 * cell, y: y0 * cell, width: w * cell, height: h * cell, fill: count / (w * h) });
  }
  return out;
}

// ── Captions ────────────────────────────────────────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** «Fig. 45.7 …» → kind and number, or null when the text does not open a caption in this language. */
export function captionStart(text: string, lang: string): { kind: 'figure' | 'table'; number: string } | null {
  const words = getLanguage(lang).captionWords;
  for (const kind of ['tab', 'fig'] as const) {
    const alternatives = [...words[kind]]
      .sort((a, b) => b.length - a.length)
      .map(escapeRe)
      .join('|');
    const m = new RegExp(
      `^\\s*(?:${alternatives})\\s*([0-9۰-۹٠-٩IVX]+(?:[.\\-–:][0-9۰-۹٠-٩]+)*[A-Za-z]?)(?=[\\s.:–—-]|$)`,
      'u',
    ).exec(text);
    if (m?.[1]) return { kind: kind === 'tab' ? 'table' : 'figure', number: toLatinDigits(m[1]).replace(/[.:]$/, '') };
  }
  return null;
}

// ── Geometry helpers ────────────────────────────────────────────────────────────────────────────────────────────

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

function hOverlap(a: Box, b: Box): number {
  return Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x));
}

function vGap(a: Box, b: Box): number {
  if (bottom(a) <= b.y) return b.y - bottom(a);
  if (bottom(b) <= a.y) return a.y - bottom(b);
  return 0;
}

const intersects = (a: Box, b: Box, pad = 0) =>
  a.x - pad < right(b) && b.x - pad < right(a) && a.y - pad < bottom(b) && b.y - pad < bottom(a);

const centerInside = (p: Box, box: Box, pad = 0) => {
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  return cx >= box.x - pad && cx <= right(box) + pad && cy >= box.y - pad && cy <= bottom(box) + pad;
};

/** The font size most of the page's characters are set in: the body text. */
export function bodySize(pieces: TextPiece[]): number {
  const counts = new Map<number, number>();
  for (const p of pieces) {
    const k = Math.round(p.size * 2) / 2;
    counts.set(k, (counts.get(k) ?? 0) + p.text.length);
  }
  let best = 10;
  let n = -1;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

// ── Lines and caption blocks ──────────────────────────────────────────────────────────────────────────────────

/**
 * Pieces of one line joined where the words are close; a wide gap (a table's next column, a label beside an arrow)
 * starts a new piece. Rotated text stays as it is.
 */
export function joinPieces(pieces: TextPiece[]): TextPiece[] {
  const flat = pieces.filter((p) => p.text.trim() && Math.abs(p.angle) < 2);
  const rotated = pieces.filter((p) => p.text.trim() && Math.abs(p.angle) >= 2);
  // Lines are built from text at the usual size first; a smaller raised or lowered piece (the «+» of «O+», a
  // footnote mark) then joins the line it sits on, so it stays inside its word instead of becoming a label.
  const sizes = flat.map((p) => p.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 8;
  const byBottom = (a: TextPiece, b: TextPiece) => a.y + a.height - (b.y + b.height) || a.x - b.x;
  const lines: TextPiece[][] = [];
  const add = (p: TextPiece) => {
    const base = p.y + p.height;
    const line = lines.find((l) => {
      const first = l[0] as TextPiece;
      return Math.abs(first.y + first.height - base) < Math.max(first.size, p.size) * 0.35;
    });
    if (line) line.push(p);
    else lines.push([p]);
  };
  for (const p of flat.filter((q) => q.size >= median * 0.85).sort(byBottom)) add(p);
  for (const p of flat.filter((q) => q.size < median * 0.85).sort(byBottom)) {
    const mid = p.y + p.height / 2;
    const host = lines.find((l) => {
      const first = l[0] as TextPiece;
      if (p.size >= first.size * 0.85) return false;
      const x0 = Math.min(...l.map((q) => q.x));
      const x1 = Math.max(...l.map((q) => right(q)));
      return (
        mid >= first.y - first.size * 0.3 &&
        mid <= first.y + first.height &&
        p.x <= x1 + first.size * 0.5 &&
        right(p) >= x0 - first.size * 0.5
      );
    });
    if (host) host.push(p);
    else add(p);
  }
  const out: TextPiece[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    let cur: TextPiece | undefined;
    for (const p of line) {
      const gap = cur ? p.x - right(cur) : Number.POSITIVE_INFINITY;
      if (cur && gap < Math.max(cur.size, p.size) * 0.9) {
        const box = union(cur, p);
        const text =
          gap > Math.min(cur.size, p.size) * 0.12 && !/\s$/.test(cur.text)
            ? `${cur.text} ${p.text}`
            : cur.text + p.text;
        cur = { ...cur, ...box, text, size: Math.max(cur.size, p.size) };
      } else {
        if (cur) out.push(cur);
        cur = { ...p };
      }
    }
    if (cur) out.push(cur);
  }
  return [...out, ...rotated].map((p) => ({ ...p, text: p.text.replace(/\s+/g, ' ').trim() }));
}

/** Lines of a caption block: the caption line and the lines set right under it, in the same column. */
function captionBlock(start: TextPiece, pieces: TextPiece[]): { box: Box; members: TextPiece[] } {
  const members = [start];
  let box: Box = start;
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pieces) {
      if (members.includes(p) || p.y < box.y - p.size * 0.5) continue;
      if (Math.abs(p.size - start.size) > start.size * 0.25) continue;
      // The rest of the caption's own line, set apart by a wider space («Table 45.1   Percentage Risk …»).
      const sameLine = members.some(
        (m) =>
          Math.abs(bottom(m) - bottom(p)) < m.size * 0.35 &&
          Math.min(Math.abs(p.x - right(m)), Math.abs(m.x - right(p))) < m.size * 3,
      );
      const gap = p.y - bottom(box);
      const below = gap >= -p.size * 0.3 && gap < p.size * 0.6 && hOverlap(p, box) > Math.min(p.width, box.width) * 0.5;
      if (sameLine || below) {
        members.push(p);
        box = union(box, p);
        grew = true;
      }
    }
  }
  return { box, members };
}

// ── Regions ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Not entirely inside the running head or foot (a header band, a page number, a footer rule). */
function inBody(b: Box, page: FigurePage): boolean {
  return bottom(b) > page.height * 0.07 && b.y < page.height * 0.95;
}

/** Largest gap (points) between parts of one drawing, and between a drawing and its caption. */
const GAP = 20;

/**
 * Grows a region from a seed through the page's drawing and its small text, in one direction. Text that reads as
 * body text (set at the body size, spanning most of the region) stops the growth.
 */
function grow(
  seed: Box,
  dir: 'up' | 'down',
  limit: Box,
  ink: InkComponent[],
  pieces: TextPiece[],
  body: number,
  blocked: Box[],
): { box: Box; grew: boolean } {
  let box = seed;
  let grewAny = false;
  const used = new Set<object>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of ink) {
      if (used.has(c)) continue;
      const beyond = dir === 'up' ? c.y < box.y + 1 : bottom(c) > bottom(box) - 1;
      if (!beyond || c.y < limit.y || bottom(c) > bottom(limit)) continue;
      if (hOverlap(c, box) < Math.min(c.width, box.width) * 0.3) continue;
      if (vGap(c, box) > GAP) continue;
      if (blocked.some((b) => intersects(b, c, -1))) continue;
      used.add(c);
      box = union(box, c);
      grewAny = true;
      changed = true;
    }
    for (const p of pieces) {
      if (used.has(p)) continue;
      const small = p.size < body * 0.95;
      const inside = centerInside(p, box, 1);
      if (!inside && !small) continue;
      if (!inside && (vGap(p, box) > p.size * 0.9 || hOverlap(p, box) < p.width * 0.5)) continue;
      if (p.y < limit.y || bottom(p) > bottom(limit)) continue;
      if (blocked.some((b) => intersects(b, p, -1))) continue;
      used.add(p);
      if (!inside) {
        box = union(box, p);
        changed = true;
      }
    }
  }
  return { box, grew: grewAny };
}

/**
 * Labels of a region: the pieces printed inside it, stacked lines of one label joined into a block (a box of a
 * flowchart, a cell of a table). Positions are relative to the region's top-left corner.
 */
export function groupLabels(pieces: TextPiece[], origin: { x: number; y: number }): FigureLabel[] {
  const sorted = [...pieces].sort((a, b) => a.y - b.y || a.x - b.x);
  const blocks: { box: Box; parts: TextPiece[] }[] = [];
  for (const p of sorted) {
    const block =
      Math.abs(p.angle) < 2
        ? blocks.find((b) => {
            const last = b.parts[b.parts.length - 1] as TextPiece;
            if (Math.abs(last.angle) >= 2) return false;
            const gap = p.y - bottom(last);
            return (
              gap > -p.size * 0.3 &&
              gap < p.size * 0.5 &&
              Math.abs(p.size - last.size) < last.size * 0.2 &&
              hOverlap(p, last) > Math.min(p.width, last.width) * 0.4
            );
          })
        : undefined;
    if (block) {
      block.parts.push(p);
      block.box = union(block.box, p);
    } else blocks.push({ box: { x: p.x, y: p.y, width: p.width, height: p.height }, parts: [p] });
  }
  return blocks.map(({ box, parts }) => {
    let text = '';
    for (const part of parts) {
      text = !text ? part.text : /[A-Za-z]-$/.test(text) ? text + part.text : `${text} ${part.text}`;
    }
    const sizes = parts.map((p) => p.size).sort((a, b) => a - b);
    return {
      text,
      x: box.x - origin.x,
      y: box.y - origin.y,
      width: box.width,
      height: box.height,
      size: sizes[Math.floor(sizes.length / 2)] ?? 8,
      angle: Math.round((parts[0] as TextPiece).angle),
      lines: parts.length,
    };
  });
}

const PAD = 3;

function clampBox(b: Box, page: FigurePage): Box {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  return { x, y, width: Math.min(page.width, right(b)) - x, height: Math.min(page.height, bottom(b)) - y };
}

/**
 * The figures and tables of one page. Each caption claims the drawing next to it; pictures known from ingestion
 * that no caption claimed are figures of their own.
 */
export function detectFigures(page: FigurePage, lang: string): FigureRegion[] {
  const pieces = joinPieces(page.pieces);
  const body = bodySize(pieces);
  const ink = page.ink.filter((c) => inBody(c, page) && (c.width >= 4 || c.height >= 4));
  const captions: { kind: 'figure' | 'table'; number: string; box: Box; members: TextPiece[] }[] = [];
  for (const p of pieces) {
    const start = captionStart(p.text, lang);
    if (!start || captions.some((c) => c.members.includes(p))) continue;
    captions.push({ ...start, ...captionBlock(p, pieces) });
  }

  const regions: FigureRegion[] = [];
  const claimed: Box[] = [];
  const pageBox: Box = { x: 0, y: 0, width: page.width, height: page.height };
  for (const cap of captions) {
    const others = captions.filter((c) => c !== cap).map((c) => c.box);
    // A caption printed on a shaded band: the band is where the region starts.
    const band = ink.filter((c) => intersects(c, cap.box, 2));
    const seed = band.reduce<Box>((b, c) => union(b, c), cap.box);
    const order: ('up' | 'down')[] = cap.kind === 'table' ? ['down', 'up'] : ['up', 'down'];
    let found: Box | undefined;
    let dir: 'up' | 'down' = order[0] as 'up' | 'down';
    for (const d of order) {
      const g = grow(seed, d, pageBox, ink, pieces, body, [...others, ...claimed]);
      // The drawing reaches past the caption on this side: through growth, or because the shaded band the caption
      // is printed on is the table itself.
      const extent = d === 'up' ? cap.box.y - g.box.y : bottom(g.box) - bottom(cap.box);
      if ((g.grew || band.length) && extent > 12) {
        found = g.box;
        dir = d;
        break;
      }
    }
    // A sentence that merely starts with «Table 45.18 lists …» has no drawing next to it.
    if (!found) continue;
    // A little room around the drawing, but the crop stops at the caption, which is set as text beside the image.
    let box = clampBox(
      { x: found.x - PAD, y: found.y - PAD, width: found.width + 2 * PAD, height: found.height + 2 * PAD },
      page,
    );
    if (dir === 'up') box = { ...box, height: Math.max(0, Math.min(bottom(box), cap.box.y - 1) - box.y) };
    else {
      const top = Math.max(box.y, bottom(cap.box) + 1);
      box = { ...box, y: top, height: Math.max(0, bottom(box) - top) };
    }
    if (box.height < 12 || box.width < 24) continue;
    const inside = pieces.filter((p) => !cap.members.includes(p) && centerInside(p, box));
    claimed.push(box, cap.box);
    regions.push({
      kind: cap.kind,
      page: page.index,
      number: cap.number,
      caption: cap.members.map((m) => m.text).join(' '),
      captionBox: cap.box,
      box,
      labels: groupLabels(inside, box),
    });
  }

  for (const img of page.images ?? []) {
    if (!inBody(img, page) || img.width * img.height < page.width * page.height * 0.015) continue;
    if (claimed.some((b) => intersects(b, img, -4))) continue;
    const box = clampBox(img, page);
    const inside = pieces.filter((p) => centerInside(p, box));
    claimed.push(box);
    regions.push({ kind: 'image', page: page.index, box, labels: groupLabels(inside, box) });
  }
  return regions;
}

/** Words of a text for matching segments against what a figure prints: letters and digits, case folded. */
export function figureTokens(text: string): string[] {
  return (
    toLatinDigits(text.normalize('NFKC'))
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
