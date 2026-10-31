import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { describe, expect, it, vi } from 'vitest';
import { extractPdf } from './extract';
import { hasOcrData, type OcrEngine, type OcrWord, ocrItems } from './ocr';
import { ingestPdf } from './pipeline';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../fixtures/pdf/${name}`, import.meta.url))));

const word = (text: string, x0: number, over: Partial<OcrWord> = {}): OcrWord => ({
  text,
  x0,
  x1: x0 + text.length * 18,
  lineTop: 300,
  baseline: 330,
  confidence: 90,
  ...over,
});

/** A fake engine: every page reads as the same two lines. */
function fakeEngine(): { factory: (lang: string) => Promise<OcrEngine>; engine: OcrEngine & { calls: number } } {
  const engine = {
    lang: 'eng',
    calls: 0,
    async recognize() {
      engine.calls++;
      return [
        word('Scanned', 150, { lineTop: 300, baseline: 360 }),
        word('heading', 330, { lineTop: 300, baseline: 360 }),
        word('Body', 150, { lineTop: 420, baseline: 450 }),
        word('text.', 260, { lineTop: 420, baseline: 450 }),
      ];
    },
    close: vi.fn(async () => {}),
  };
  return { factory: vi.fn(async () => engine), engine };
}

describe('OCR words → text items', () => {
  it('maps pixels to PDF units, estimates the font size from the line, and keeps words apart', () => {
    const items = ocrItems([word('Hello', 300, { lineTop: 300, baseline: 330 })], 3);
    expect(items).toEqual([
      expect.objectContaining({ text: 'Hello ', x: 100, y: 110, width: 30, size: 14, font: 'ocr', bold: false }),
    ]);
  });

  it('drops low-confidence noise but keeps low-confidence words', () => {
    const items = ocrItems([word('~', 0, { confidence: 5 }), word('water', 50, { confidence: 8 }), word(' ', 90)]);
    expect(items.map((i) => i.text)).toEqual(['water ']);
  });

  it('drops text-like noise from figures on a clean page', () => {
    const body = ['The', 'airway', 'is', 'secured', 'first.'].map((t, i) => word(t, i * 120, { confidence: 94 }));
    const items = ocrItems([word('wall', 900, { confidence: 30 }), word('dl', 1000, { confidence: 12 }), ...body]);
    expect(items.map((i) => i.text.trim())).toEqual(['The', 'airway', 'is', 'secured', 'first.']);
  });
});

/** A PDF without text or images: page i holds `shapes[i]` small filled paths, like glyph outlines. */
function drawnPdf(shapes: number[]): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    for (const count of shapes) {
      doc.addPage();
      for (let i = 0; i < count; i++) doc.rect(50 + (i % 60) * 8, 60 + Math.floor(i / 60) * 14, 5, 9).fill('#000');
    }
    doc.end();
  });
}

describe('OCR during extraction', () => {
  it('never starts the engine for a PDF with a text layer', async () => {
    const { factory } = fakeEngine();
    const ex = await extractPdf(fixture('outline-book.pdf'), { ocr: { lang: 'eng', engine: factory } });
    expect(factory).not.toHaveBeenCalled();
    expect(ex.pages.some((p) => p.ocr)).toBe(false);
  });

  it('reads scanned pages through the engine and reports progress', async () => {
    const { factory, engine } = fakeEngine();
    const progress: number[] = [];
    const ex = await extractPdf(fixture('scanned.pdf'), {
      ocr: { lang: 'eng', engine: factory },
      onPage: (_done, _total, ocrPages) => progress.push(ocrPages ?? 0),
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(engine.calls).toBe(7);
    expect(engine.close).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ex.pages.every((p) => p.ocr)).toBe(true);
    expect(ex.pages[0]?.lines.map((l) => l.text)).toEqual(['Scanned heading', 'Body text.']);
  });

  it('reads pages whose text was converted to vector outlines, but not text-less pages with a small drawing', async () => {
    const { factory, engine } = fakeEngine();
    const ex = await extractPdf(await drawnPdf([600, 20]), { ocr: { lang: 'eng', engine: factory } });
    expect(ex.pages.map((p) => p.vectorPaths)).toEqual([600, 20]);
    expect(engine.calls).toBe(1);
    expect(ex.pages.map((p) => Boolean(p.ocr))).toEqual([true, false]);
  });

  it('reports scanned pages it cannot read when the language has no OCR data', async () => {
    const result = await ingestPdf(fixture('scanned.pdf'), { ocr: { lang: 'xyz', engine: async () => null } });
    expect(result.report.stats.pagesWithoutText).toBe(7);
    expect(result.report.stats.ocrPages).toBe(0);
    expect(result.report.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['pages_without_text', 'ocr_unavailable']),
    );
  });
});

describe('Tesseract OCR (real engine)', () => {
  it('turns the scanned fixture back into a structured book', { timeout: 120_000 }, async () => {
    expect(hasOcrData('eng')).toBe(true);
    const result = await ingestPdf(fixture('scanned.pdf'), { lang: 'en', ocr: { lang: 'eng' } });
    expect(result.report.stats.ocrPages).toBe(7);
    expect(result.report.stats.pagesWithoutText).toBe(0);
    expect(result.report.warnings.map((w) => w.code)).toContain('pages_ocr');
    expect(result.nodes.filter((n) => n.kind === 'chapter')).toHaveLength(2);

    // The same original text as fixtures/pdf/no-outline.pdf: most words must come back.
    const expected = [
      'These notes began as a notebook kept on a windowsill.',
      'Rain is water that has travelled a long way.',
      'A ribbon tied to a stick is the easiest wind gauge.',
      'Keeping the same stick in the same place matters more than the stick itself.',
    ]
      .join(' ')
      .toLowerCase()
      .match(/[a-z]+/g) as string[];
    const got = new Set(
      result.segments
        .map((s) => s.src)
        .join(' ')
        .toLowerCase()
        .match(/[a-z]+/g),
    );
    const recall = expected.filter((w) => got.has(w)).length / expected.length;
    expect(recall).toBeGreaterThan(0.85);
  });
});

describe('OCR in the ingestion worker', () => {
  it('reads a scanned PDF off the main thread with OCR progress', { timeout: 120_000 }, async () => {
    const { ingestInWorker } = await import('./worker-client');
    const ocr: number[] = [];
    const result = await ingestInWorker(fileURLToPath(new URL('../../../fixtures/pdf/scanned.pdf', import.meta.url)), {
      lang: 'en',
      onProgress: (_page, _total, ocrPages) => ocr.push(ocrPages),
    });
    expect(ocr.at(-1)).toBe(7);
    expect(result.report.stats.ocrPages).toBe(7);
  });
});
