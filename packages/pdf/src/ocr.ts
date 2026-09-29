import { createRequire } from 'node:module';
import type { RawItem } from './lines';
import { normalizeRunText } from './normalize';

/**
 * OCR for scanned pages (SPEC §8: pages without a text layer). A page is rendered with pdf.js onto a
 * @napi-rs/canvas canvas and read by tesseract.js (Apache-2.0, WebAssembly; the language data ships as an npm
 * package, so nothing is downloaded at run time). Recognized words become ordinary text items, so line building,
 * header/footer removal, block and structure detection run unchanged.
 */
const require = createRequire(import.meta.url);

export interface OcrWord {
  text: string;
  /** Word box in image pixels. */
  x0: number;
  x1: number;
  /** Top of the word's line and its baseline, in image pixels. */
  lineTop: number;
  baseline: number;
  confidence: number;
}

export interface OcrEngine {
  readonly lang: string;
  recognize(image: Uint8Array): Promise<OcrWord[]>;
  close(): Promise<void>;
}

/** Render scale: 3 × 72 dpi = 216 dpi — close to what Tesseract is trained on, at a reasonable speed. */
export const OCR_SCALE = 3;
/** Below this confidence only words with letters or digits are kept (noise specks are dropped). */
const MIN_CONFIDENCE = 20;
const WORDLIKE = /[\p{L}\p{N}]/u;

interface TesseractLine {
  bbox: { y0: number };
  baseline: { y0: number; y1: number };
  words: { text: string; confidence: number; bbox: { x0: number; x1: number; y1: number } }[];
}
interface TesseractResult {
  data: { blocks: { paragraphs: { lines: TesseractLine[] }[] }[] | null };
}
interface TesseractWorker {
  recognize(image: Uint8Array, opts: object, output: object): Promise<TesseractResult>;
  terminate(): Promise<unknown>;
}

/** Whether the language data for a Tesseract code is installed (`@tesseract.js-data/<code>`). */
export function hasOcrData(code: string): boolean {
  try {
    require.resolve(`@tesseract.js-data/${code}`);
    return true;
  } catch {
    return false;
  }
}

/** A tesseract.js worker for one language; null when its data package is not installed. */
export async function createTesseractEngine(code: string): Promise<OcrEngine | null> {
  if (!hasOcrData(code)) return null;
  const data = require(`@tesseract.js-data/${code}`) as { code: string; langPath: string; gzip: boolean };
  const { createWorker } = require('tesseract.js') as {
    createWorker(lang: string, oem: number, opts: object): Promise<TesseractWorker>;
  };
  // OEM 1 = LSTM only; cacheMethod 'none' keeps the data read-only (no cache files next to the app).
  const worker = await createWorker(data.code, 1, { langPath: data.langPath, gzip: data.gzip, cacheMethod: 'none' });
  return {
    lang: code,
    async recognize(image) {
      const res = await worker.recognize(image, {}, { blocks: true, text: false });
      const words: OcrWord[] = [];
      for (const block of res.data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const baseline = Math.max(line.baseline.y0, line.baseline.y1);
            for (const w of line.words) {
              words.push({
                text: w.text,
                x0: w.bbox.x0,
                x1: w.bbox.x1,
                lineTop: line.bbox.y0,
                baseline: Number.isFinite(baseline) && baseline > line.bbox.y0 ? baseline : w.bbox.y1,
                confidence: w.confidence,
              });
            }
          }
        }
      }
      return words;
    },
    async close() {
      await worker.terminate();
    },
  };
}

/**
 * OCR words → text items in PDF units (1/72 inch, y from the page top). The font size is estimated from the
 * line's ascender height (cap height ≈ 0.72 em), so headings stay larger than body text for structure detection.
 */
export function ocrItems(words: OcrWord[], scale = OCR_SCALE): RawItem[] {
  const items: RawItem[] = [];
  for (const w of words) {
    const text = normalizeRunText(w.text).trim();
    if (!text || (w.confidence < MIN_CONFIDENCE && !WORDLIKE.test(text))) continue;
    const ascent = Math.max(1, w.baseline - w.lineTop) / scale;
    items.push({
      // Tesseract already separated the words; a trailing space keeps them apart whatever the gap.
      text: `${text} `,
      x: w.x0 / scale,
      y: w.baseline / scale,
      width: Math.max(1, (w.x1 - w.x0) / scale),
      size: Math.max(4, Math.round((ascent / 0.72) * 2) / 2),
      font: 'ocr',
      bold: false,
      italic: false,
      mono: false,
    });
  }
  return items;
}

interface RenderablePage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: object): { promise: Promise<void> };
}

/** Renders a PDF page to a PNG (white background) for OCR. */
export async function renderPagePng(page: RenderablePage, scale = OCR_SCALE): Promise<Uint8Array> {
  const { createCanvas } = require('@napi-rs/canvas') as {
    createCanvas(
      w: number,
      h: number,
    ): {
      getContext(t: '2d'): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
      toBuffer(mime: 'image/png'): Uint8Array;
    };
  };
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toBuffer('image/png');
}
