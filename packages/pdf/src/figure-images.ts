import { createRequire } from 'node:module';
import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openPdf } from './extract';
import { detectFigures, type FigureRegion, type InkComponent, inkComponents, type TextPiece } from './figures';
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

/** Words of a page with their boxes, in page points from the top-left corner. */
export async function textPieces(page: PdfPage): Promise<TextPiece[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const out: TextPiece[] = [];
  for (const it of content.items) {
    if (!('str' in it)) continue;
    const text = normalizeRunText(it.str);
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
    if (Math.abs(label.angle) >= 2) continue;
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
