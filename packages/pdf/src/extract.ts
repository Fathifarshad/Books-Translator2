import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildLines, type RawItem } from './lines';
import { fontStyle, normalizeRunText } from './normalize';
import { createTesseractEngine, type OcrEngine, ocrItems, renderPagePng } from './ocr';
import type { Box, ExtractedBook, OutlineEntry, PageData } from './types';

const require = createRequire(import.meta.url);
const pdfjsRoot = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');

export interface OcrOptions {
  /** Tesseract language code (from the language registry). */
  lang: string;
  /** Engine factory (tests inject a fake); defaults to tesseract.js with the installed language data. */
  engine?: (lang: string) => Promise<OcrEngine | null>;
  /** A page with fewer text characters than this is read with OCR. */
  minChars?: number;
  /** Maximum time to render and read one page (ms). */
  pageTimeoutMs?: number;
}

export interface ExtractOptions {
  /** Called after each page is processed (`ocrPages`: pages read with OCR so far). */
  onPage?: (done: number, total: number, ocrPages?: number) => void;
  /** Read pages without a text layer (scanned books) with OCR. */
  ocr?: OcrOptions;
  /** Maximum time for one page (ms). */
  pageTimeoutMs?: number;
  maxPages?: number;
  /** Only extract these page indexes (inspect tool). */
  pages?: number[];
}

type PdfDoc = Awaited<ReturnType<typeof getDocument>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDoc['getPage']>>;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${what}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Loads a PDF with pdf.js hardened for untrusted input (SPEC §8.2). pdf.js 6 never evaluates code from the
 * PDF (the former `isEvalSupported` switch is gone); XFA forms and system fonts stay disabled.
 */
export function openPdf(data: Uint8Array) {
  return getDocument({
    data,
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
    standardFontDataUrl: pathToFileURL(`${pdfjsRoot}standard_fonts/`).href,
    cMapUrl: pathToFileURL(`${pdfjsRoot}cmaps/`).href,
    cMapPacked: true,
  });
}

async function resolveOutline(pdf: PdfDoc, heights: Map<number, number>): Promise<OutlineEntry[]> {
  const raw = await pdf.getOutline();
  if (!raw) return [];
  const visit = async (items: typeof raw): Promise<OutlineEntry[]> => {
    const out: OutlineEntry[] = [];
    for (const item of items) {
      let pageIndex: number | null = null;
      let top: number | null = null;
      try {
        const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        if (Array.isArray(dest) && dest[0]) {
          const ref = dest[0];
          pageIndex = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref as { num: number; gen: number });
          const kind = (dest[1] as { name?: string } | undefined)?.name;
          // [page, /XYZ, left, top, zoom] · [page, /FitH, top] · [page, /FitBH, top]
          const rawTop = kind === 'XYZ' ? dest[3] : kind === 'FitH' || kind === 'FitBH' ? dest[2] : null;
          if (typeof rawTop === 'number' && pageIndex !== null) {
            const h = heights.get(pageIndex);
            top = h === undefined ? null : Math.max(0, h - rawTop);
          }
        }
      } catch {
        pageIndex = null;
      }
      out.push({
        title: normalizeRunText(item.title ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        pageIndex,
        top,
        children: item.items?.length ? await visit(item.items) : [],
      });
    }
    return out;
  };
  return visit(raw);
}

/** Image placements from the operator list: tracks the CTM through save/restore/transform. */
function imageBoxes(ops: { fnArray: number[]; argsArray: unknown[] }, pageHeight: number): Box[] {
  const boxes: Box[] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const mul = (m: number[], n: number[]) => [
    (m[0] as number) * (n[0] as number) + (m[1] as number) * (n[2] as number),
    (m[0] as number) * (n[1] as number) + (m[1] as number) * (n[3] as number),
    (m[2] as number) * (n[0] as number) + (m[3] as number) * (n[2] as number),
    (m[2] as number) * (n[1] as number) + (m[3] as number) * (n[3] as number),
    (m[4] as number) * (n[0] as number) + (m[5] as number) * (n[2] as number) + (n[4] as number),
    (m[4] as number) * (n[1] as number) + (m[5] as number) * (n[3] as number) + (n[5] as number),
  ];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(ops.argsArray[i] as number[], ctm);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const [a, b, c, d, e, f] = ctm as [number, number, number, number, number, number];
      const xs = [e, e + a, e + c, e + a + c];
      const ys = [f, f + b, f + d, f + b + d];
      const x = Math.min(...xs);
      const width = Math.max(...xs) - x;
      const yBottom = Math.min(...ys);
      const height = Math.max(...ys) - yBottom;
      // Ignore tiny images (rules, bullets, decorations).
      if (width > 30 && height > 30) boxes.push({ x, y: pageHeight - (yBottom + height), width, height });
    }
  }
  return boxes;
}

async function extractPage(page: PdfPage, index: number): Promise<PageData> {
  const viewport = page.getViewport({ scale: 1 });
  const height = viewport.height;
  const content = await page.getTextContent();
  // Fonts are resolved while building the operator list; it also gives us image placements.
  const ops = await page.getOperatorList();
  const items: RawItem[] = [];
  for (const it of content.items) {
    if (!('str' in it)) continue;
    const [a, b, c, d, e, f] = it.transform as [number, number, number, number, number, number];
    if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue; // rotated / vertical text
    const text = normalizeRunText(it.str);
    if (!text) continue;
    const size = Math.hypot(c, d) || Math.abs(a);
    const style = content.styles[it.fontName];
    const font = page.commonObjs.has(it.fontName)
      ? (page.commonObjs.get(it.fontName) as { name?: string; bold?: boolean; italic?: boolean; isMonospace?: boolean })
      : undefined;
    const name = font?.name ?? it.fontName;
    items.push({
      text,
      x: e,
      y: height - f,
      width: it.width,
      size,
      font: name,
      ...fontStyle(name, {
        family: style?.fontFamily,
        bold: font?.bold,
        italic: font?.italic,
        mono: font?.isMonospace,
      }),
    });
  }
  return {
    index,
    width: viewport.width,
    height,
    lines: buildLines(items, index),
    images: imageBoxes(ops as { fnArray: number[]; argsArray: unknown[] }, height),
  };
}

const textLength = (p: PageData) => p.lines.reduce((n, l) => n + l.text.length, 0);

/** A scanned page is (mostly) one picture: images cover at least half of it. Title pages keep their text. */
function looksScanned(p: PageData): boolean {
  const area = p.images.reduce((n, b) => n + b.width * b.height, 0);
  return area >= p.width * p.height * 0.5;
}

/** pdf.js pass: metadata, page labels, outline with resolved destinations, and per-page lines (OCR when needed). */
export async function extractPdf(data: Uint8Array, opts: ExtractOptions = {}): Promise<ExtractedBook> {
  const task = openPdf(data);
  const pdf = await task.promise;
  try {
    const total = pdf.numPages;
    if (opts.maxPages && total > opts.maxPages) throw new Error(`too many pages: ${total}`);
    const info = (await pdf.getMetadata().catch(() => null))?.info as Record<string, unknown> | undefined;
    const labels = await pdf.getPageLabels().catch(() => null);
    const wanted = opts.pages ?? Array.from({ length: total }, (_, i) => i);
    const pages: PageData[] = [];
    const heights = new Map<number, number>();
    let done = 0;
    let ocrPages = 0;
    // The OCR engine starts only when the first page without text appears (text PDFs never pay for it).
    let engine: OcrEngine | null | undefined;
    const ocr = opts.ocr;
    try {
      for (const i of wanted) {
        const page = await pdf.getPage(i + 1);
        try {
          let data: PageData;
          try {
            data = await withTimeout(extractPage(page, i), opts.pageTimeoutMs ?? 20_000, `page ${i + 1}`);
          } catch {
            // A page that cannot be parsed in time is treated as empty (reported as "no text").
            const viewport = page.getViewport({ scale: 1 });
            data = { index: i, width: viewport.width, height: viewport.height, lines: [], images: [] };
          }
          if (ocr && textLength(data) < (ocr.minChars ?? 30) && looksScanned(data)) {
            if (engine === undefined) engine = await (ocr.engine ?? createTesseractEngine)(ocr.lang);
            if (engine) {
              const reader = engine;
              try {
                const words = await withTimeout(
                  renderPagePng(page).then((png) => reader.recognize(png)),
                  ocr.pageTimeoutMs ?? 120_000,
                  `OCR of page ${i + 1}`,
                );
                const lines = buildLines(ocrItems(words), i);
                if (lines.length) {
                  data = { ...data, lines, ocr: true };
                  ocrPages++;
                }
              } catch {
                // Unreadable page: stays empty and is reported as "no text".
              }
            }
          }
          pages.push(data);
          heights.set(i, data.height);
        } finally {
          page.cleanup();
        }
        done++;
        opts.onPage?.(done, wanted.length, ocrPages);
      }
    } finally {
      await engine?.close();
    }
    // Destinations need page heights; pages outside `wanted` are measured lazily.
    for (let i = 0; i < total && !opts.pages; i++) if (!heights.has(i)) heights.set(i, 842);
    const outline = await resolveOutline(pdf, heights);
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? normalizeRunText(v).trim() : undefined);
    const meta: ExtractedBook['meta'] = {};
    const title = str(info?.Title);
    const author = str(info?.Author);
    const subject = str(info?.Subject);
    const producer = str(info?.Producer);
    if (title) meta.title = title;
    if (author) meta.author = author;
    if (subject) meta.subject = subject;
    if (producer) meta.producer = producer;
    return {
      meta,
      pageCount: total,
      pageLabels: labels ?? null,
      outline,
      pages,
      ocr: { lang: ocr?.lang ?? null, available: engine ? true : engine === null ? false : null },
    };
  } finally {
    await task.destroy();
  }
}
