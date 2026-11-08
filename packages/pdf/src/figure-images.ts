import { createRequire } from 'node:module';
import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openPdf } from './extract';
import {
  detectFigures,
  type FigureLabel,
  type FigureRegion,
  type InkComponent,
  inkComponents,
  type TextPiece,
} from './figures';
import { normalizeRunText } from './normalize';
import type { Box } from './types';

const require = createRequire(import.meta.url);

/**
 * Cuts the figures and tables of a book out of its original PDF (ADR-046). A page is drawn once *without its text*:
 * that drawing is both where the figures are found (its ink) and what is cut out, so the exporter can set the
 * translated labels back exactly where the original words were. A book that keeps its language (edited, not
 * translated) keeps the words of its pictures too.
 */
export interface FigureImage extends FigureRegion {
  image: Uint8Array;
  format: 'png' | 'jpeg';
  /** Pixel size of `image`. */
  pixelWidth: number;
  pixelHeight: number;
  /** The image is mirrored left to right (a table set right to left); labels are not — the exporter mirrors them. */
  mirrored: boolean;
  /** The original words were taken out of the image (false: they are still drawn in it). */
  textRemoved: boolean;
}

export interface FigureOptions {
  /** Source language of the book: its caption words find the figures. */
  lang: string;
  /** Page indexes to look at (0-based). */
  pages: number[];
  /** Pictures known from ingestion, by page, that may carry no caption. */
  images?: Map<number, Box[]>;
  /** Render scale of the cut-out images (3 ≈ 216 dpi). */
  scale?: number;
  /** Keep the words inside the pictures (a book edited in its own language). */
  keepText?: boolean;
  /** Mirror tables for a right-to-left target language. */
  mirrorTables?: boolean;
  onPage?: (done: number, total: number) => void;
}

interface Canvas {
  width: number;
  height: number;
  getContext(t: '2d'): Ctx;
  toBuffer(mime: 'image/png'): Uint8Array;
  toBuffer(mime: 'image/jpeg', quality: number): Uint8Array;
}
interface Ctx {
  fillStyle: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
  drawImage(
    img: Canvas,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
}
const createCanvas = (w: number, h: number): Canvas =>
  (require('@napi-rs/canvas') as { createCanvas(w: number, h: number): Canvas }).createCanvas(w, h);

type PdfDoc = Awaited<ReturnType<typeof openPdf>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDoc['getPage']>>;

const TEXT_OPS = [OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText];

/**
 * Draws a page; with `stripText` its text operators do nothing, so only the drawing is left. pdf.js has no switch
 * for that, so the operators of this one render's graphics state are replaced before it starts (tested against the
 * pinned pdf.js; when that is not possible the text stays and `stripped` says so).
 */
export async function renderPage(
  page: PdfPage,
  scale: number,
  stripText: boolean,
): Promise<{ canvas: Canvas; stripped: boolean }> {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvas, canvasContext: ctx, viewport } as never) as unknown as {
    promise: Promise<void>;
    onContinue?: (cont: () => void) => void;
    _internalRenderTask?: { gfx?: Record<number, unknown> };
  };
  let stripped = false;
  if (stripText) {
    task.onContinue = (cont) => {
      const gfx = task._internalRenderTask?.gfx;
      if (gfx && !stripped) {
        for (const op of TEXT_OPS) gfx[op] = () => {};
        stripped = true;
      }
      cont();
    };
  }
  await task.promise;
  return { canvas, stripped };
}

/**
 * A list bullet drawn from a symbol font that maps its glyphs to no characters comes out of the text as control or
 * private-use codes («\u0003\u0004 Acute respiratory distress»), which no font can show. Standing alone as a word,
 * such a run is that bullet: «•».
 */
export function symbolBullets(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: those codes are what is looked for
  return text.replace(/(^|\s)[\u0001-\u0008\u000b\u000c\u000e-\u001f\uf000-\uf8ff]+(?=\s|$)/gu, '$1•');
}

/** Words of a page with their boxes, in page points from the top-left corner. */
export async function textPieces(page: PdfPage): Promise<TextPiece[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: TextPiece[] = [];
  for (const it of content.items) {
    if (!('str' in it)) continue;
    const text = symbolBullets(normalizeRunText(it.str));
    if (!text.trim()) continue;
    const [a, b, c, d, e, f] = Util.transform(viewport.transform, it.transform) as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const size = Math.hypot(c, d);
    const len = Math.hypot(a, b) || 1;
    if (!size) continue;
    const ux = a / len;
    const uy = b / len;
    const upx = c / size;
    const upy = d / size;
    const w = it.width || text.length * size * 0.5;
    const pts = [
      [e - upx * size * 0.22, f - upy * size * 0.22],
      [e + ux * w - upx * size * 0.22, f + uy * w - upy * size * 0.22],
      [e + upx * size * 0.9, f + upy * size * 0.9],
      [e + ux * w + upx * size * 0.9, f + uy * w + upy * size * 0.9],
    ] as [number, number][];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    out.push({
      text,
      x,
      y,
      width: Math.max(...xs) - x,
      height: Math.max(...ys) - y,
      size,
      angle: Math.round((Math.atan2(-b, a) * 180) / Math.PI),
    });
  }
  return out;
}

/** Ink of a drawn page on a grid of `cell`-point squares: any pixel darker than paper marks its cell. */
export function inkOf(canvas: Canvas, scale: number, cell = 2): InkComponent[] {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const px = cell * scale;
  const cols = Math.ceil(canvas.width / px);
  const rows = Math.ceil(canvas.height / px);
  const mask = new Uint8Array(cols * rows);
  for (let y = 0; y < canvas.height; y++) {
    const row = Math.floor(y / px) * cols;
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (Math.min(data[i] as number, data[i + 1] as number, data[i + 2] as number) < 236) {
        mask[row + Math.floor(x / px)] = 1;
      }
    }
  }
  return inkComponents(mask, cols, rows, cell, 1);
}

/**
 * The free space around each label, measured on the drawing without its text: from the label outwards, as long as
 * the pixels keep the colour of the label's own background (the fill of its flowchart box, or the paper), up to a few
 * letters' width. A box's border, an arrow or another shape ends it. Positions are relative to the region.
 */
export function measureRoom(canvas: Canvas, scale: number, region: FigureRegion): void {
  const x0 = Math.max(0, Math.floor(region.box.x * scale));
  const y0 = Math.max(0, Math.floor(region.box.y * scale));
  const w = Math.min(canvas.width - x0, Math.ceil(region.box.width * scale));
  const h = Math.min(canvas.height - y0, Math.ceil(region.box.height * scale));
  if (w <= 0 || h <= 0) return;
  const { data } = canvas.getContext('2d').getImageData(x0, y0, w, h);
  const at = (x: number, y: number) => (y * w + x) * 4;
  for (const label of region.labels) {
    if (Math.abs(label.angle) >= 2 || label.printed) continue;
    let left = Math.max(0, Math.round(label.x * scale));
    let top = Math.max(0, Math.round(label.y * scale));
    let right = Math.min(w - 1, Math.round((label.x + label.width) * scale));
    let bottom = Math.min(h - 1, Math.round((label.y + label.height) * scale));
    if (right <= left || bottom <= top) continue;
    // The label's background: the most common colour inside it (its words are gone from this drawing).
    const counts = new Map<number, number>();
    for (let y = top; y <= bottom; y += 2) {
      for (let x = left; x <= right; x += 2) {
        const i = at(x, y);
        const c =
          ((data[i] as number) >> 3) * 1024 + ((data[i + 1] as number) >> 3) * 32 + ((data[i + 2] as number) >> 3);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const same = (x: number, y: number) => {
      const i = at(x, y);
      const r = ((bg >> 10) & 31) << 3;
      const g = ((bg >> 5) & 31) << 3;
      const b = (bg & 31) << 3;
      return (
        Math.abs((data[i] as number) - r) +
          Math.abs((data[i + 1] as number) - g) +
          Math.abs((data[i + 2] as number) - b) <
        48
      );
    };
    const column = (x: number) => {
      for (let y = top; y <= bottom; y++) if (!same(x, y)) return false;
      return true;
    };
    const row = (y: number) => {
      for (let x = left; x <= right; x++) if (!same(x, y)) return false;
      return true;
    };
    const maxX = label.size * 4 * scale;
    const maxY = label.size * 1.2 * scale;
    const start = { left, right, top, bottom };
    let grew = true;
    while (grew) {
      grew = false;
      if (left > 0 && start.left - left < maxX && column(left - 1)) {
        left--;
        grew = true;
      }
      if (right < w - 1 && right - start.right < maxX && column(right + 1)) {
        right++;
        grew = true;
      }
      if (top > 0 && start.top - top < maxY && row(top - 1)) {
        top--;
        grew = true;
      }
      if (bottom < h - 1 && bottom - start.bottom < maxY && row(bottom + 1)) {
        bottom++;
        grew = true;
      }
    }
    label.room = {
      x: left / scale,
      y: top / scale,
      width: (right - left + 1) / scale,
      height: (bottom - top + 1) / scale,
    };
  }
}

/**
 * Ink that reads as letters inside a window of the drawing (rows `y0`–`y1`, the middle of a line of text): dark,
 * colourless strokes, set off from the background colour `bg`, several of them side by side (three or more runs of
 * inked columns), covering most of the window's height and staying inside the line (`above` and `below` are rows
 * just outside it, which no stroke of a letter reaches without a break) — not a box's border, an arrow, a dashed
 * rule, a chart's coloured line or marker, or a drawing that runs on past the line.
 */
function lettersIn(
  data: Uint8ClampedArray,
  w: number,
  bg: [number, number, number],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  above: number,
  below: number,
): boolean {
  if (x1 - x0 < 3 || y1 - y0 < 2) return false;
  const dark = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return (
      Math.abs((data[i] as number) - bg[0]) +
        Math.abs((data[i + 1] as number) - bg[1]) +
        Math.abs((data[i + 2] as number) - bg[2]) >
      160
    );
  };
  const letter = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    return dark(x, y) && Math.max(r, g, b) < 130 && Math.max(r, g, b) - Math.min(r, g, b) < 60;
  };
  // A stroke that runs on without a break from the line to a row outside it: a drawing, not a letter (letters end
  // at the white between lines, however tightly the lines are set).
  const solid = (x: number, a: number, b: number) => {
    for (let y = Math.min(a, b); y <= Math.max(a, b); y++) if (!dark(x, y)) return false;
    return true;
  };
  const rows = new Uint8Array(y1 - y0 + 1);
  let runs = 0;
  let cols = 0;
  let through = 0;
  let prev = false;
  for (let x = x0; x <= x1; x++) {
    let any = false;
    for (let y = y0; y <= y1 && !any; y++) any = letter(x, y);
    // A column a stroke runs through (an axis, a box's side) is drawing: it neither counts as a letter nor fills
    // the line's height for the letters beside it.
    if (any && (solid(x, above, y0) || solid(x, y1, below))) {
      through++;
      any = false;
    }
    if (any) {
      cols++;
      if (!prev) runs++;
      for (let y = y0; y <= y1; y++) if (letter(x, y)) rows[y - y0] = 1;
    }
    prev = any;
  }
  if (!cols) return false;
  const rowShare = rows.reduce((s, r) => s + r, 0) / rows.length;
  return runs >= 3 && cols / (x1 - x0 + 1) > 0.2 && rowShare > 0.5 && through / (cols + through) < 0.3;
}

/**
 * Words a figure's drawing still shows once its text is taken out — letters drawn as outlines, or inside a picture
 * — and the labels they concern: `drawn`, a label whose own box still shows letters (the words are printed twice;
 * nothing is set over them), and `fragments`, a label beside such letters on its own line («help» after an outlined
 * «Call for skilled»): its line cannot be translated, so its own words go back into the image as printed rather
 * than a translation mixed into a line of the original language.
 */
export function drawnWords(
  canvas: Canvas,
  scale: number,
  region: FigureRegion,
): { drawn: Set<FigureLabel>; fragments: Set<FigureLabel> } {
  const drawn = new Set<FigureLabel>();
  const fragments = new Set<FigureLabel>();
  const x0 = Math.max(0, Math.floor(region.box.x * scale));
  const y0 = Math.max(0, Math.floor(region.box.y * scale));
  const w = Math.min(canvas.width - x0, Math.ceil(region.box.width * scale));
  const h = Math.min(canvas.height - y0, Math.ceil(region.box.height * scale));
  if (w <= 0 || h <= 0) return { drawn, fragments };
  const { data } = canvas.getContext('2d').getImageData(x0, y0, w, h);
  for (const label of region.labels) {
    if (Math.abs(label.angle) >= 2) continue;
    const left = Math.max(0, Math.round(label.x * scale));
    const right = Math.min(w - 1, Math.round((label.x + label.width) * scale));
    // The middle of the line: where letters are, above descenders and below ascenders.
    const top = Math.max(0, Math.round((label.y + label.height * 0.3) * scale));
    const bottom = Math.min(h - 1, Math.round((label.y + label.height * 0.7) * scale));
    if (right <= left || bottom <= top) continue;
    const counts = new Map<number, number>();
    for (let y = top; y <= bottom; y += 2) {
      for (let x = left; x <= right; x += 2) {
        const i = (y * w + x) * 4;
        const c =
          ((data[i] as number) >> 4) * 256 + ((data[i + 1] as number) >> 4) * 16 + ((data[i + 2] as number) >> 4);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    const q = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0xfff;
    const bg: [number, number, number] = [((q >> 8) & 15) * 16 + 8, ((q >> 4) & 15) * 16 + 8, (q & 15) * 16 + 8];
    // Rows just outside the line: letters end before them, drawings go on through them.
    const above = Math.max(0, Math.round((label.y - label.size * 0.25) * scale));
    const below = Math.min(h - 1, Math.round((label.y + label.height + label.size * 0.25) * scale));
    if (lettersIn(data, w, bg, left, right, top, bottom, above, below)) {
      drawn.add(label);
      continue;
    }
    const reach = Math.round(label.size * 2.4 * scale);
    const gap = Math.round(label.size * 0.08 * scale);
    if (
      lettersIn(data, w, bg, Math.max(0, left - reach), Math.max(0, left - gap), top, bottom, above, below) ||
      lettersIn(data, w, bg, Math.min(w - 1, right + gap), Math.min(w - 1, right + reach), top, bottom, above, below)
    ) {
      fragments.add(label);
    }
  }
  return { drawn, fragments };
}

function cut(source: Canvas, box: Box, scale: number, mirror: boolean): Canvas {
  const w = Math.max(1, Math.round(box.width * scale));
  const h = Math.max(1, Math.round(box.height * scale));
  const out = createCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, box.x * scale, box.y * scale, box.width * scale, box.height * scale, 0, 0, w, h);
  return out;
}

/** Finds and cuts out the figures of the given pages. */
export async function extractFigures(data: Uint8Array, opts: FigureOptions): Promise<FigureImage[]> {
  const scale = opts.scale ?? 3;
  const task = openPdf(data);
  const pdf = await task.promise;
  const out: FigureImage[] = [];
  try {
    const pages = [...new Set(opts.pages)].filter((i) => i >= 0 && i < pdf.numPages).sort((a, b) => a - b);
    for (const [n, index] of pages.entries()) {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const drawing = await renderPage(page, scale, true);
      const regions = detectFigures(
        {
          index,
          width: viewport.width,
          height: viewport.height,
          pieces: await textPieces(page),
          ink: inkOf(drawing.canvas, scale),
          images: opts.images?.get(index) ?? [],
        },
        opts.lang,
      );
      const withText = opts.keepText && regions.length ? (await renderPage(page, scale, false)).canvas : undefined;
      if (!withText && drawing.stripped) {
        // Words still drawn in the picture are left as they are; a label in a line of them goes back as printed.
        let printed: Canvas | undefined;
        for (const region of regions) {
          const { drawn, fragments } = drawnWords(drawing.canvas, scale, region);
          if (fragments.size) {
            printed ??= (await renderPage(page, scale, false)).canvas;
            const ctx = drawing.canvas.getContext('2d');
            for (const l of fragments) {
              const pad = l.size * 0.12;
              const sx = Math.max(0, (region.box.x + l.x - pad) * scale);
              const sy = Math.max(0, (region.box.y + l.y - pad) * scale);
              const sw = (l.width + 2 * pad) * scale;
              const sh = (l.height + 2 * pad) * scale;
              ctx.drawImage(printed, sx, sy, sw, sh, sx, sy, sw, sh);
            }
          }
          for (const l of [...drawn, ...fragments]) l.printed = true;
        }
      }
      for (const region of regions) {
        // A table's cells are bounded by their neighbours, not by drawn boxes.
        if (!withText && region.kind !== 'table') measureRoom(drawing.canvas, scale, region);
        const mirrored = Boolean(opts.mirrorTables && region.kind === 'table' && !withText);
        const canvas = cut(withText ?? drawing.canvas, region.box, scale, mirrored);
        const format = region.kind === 'image' ? 'jpeg' : 'png';
        out.push({
          ...region,
          image: format === 'jpeg' ? canvas.toBuffer('image/jpeg', 88) : canvas.toBuffer('image/png'),
          format,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          mirrored,
          textRemoved: !withText && drawing.stripped,
        });
      }
      page.cleanup();
      opts.onPage?.(n + 1, pages.length);
      // Let the server answer requests between pages.
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    await task.destroy();
  }
  return out;
}
