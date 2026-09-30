import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';

/** A synthetic 320-page book: 16 chapters × 20 pages, outline, running heads and page numbers. */
function largePdf(pages: number): Promise<Buffer> {
  const doc = new PDFDocument({ size: [360, 480], margin: 0, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const sentence = 'Each page of this generated book repeats a plain sentence so that extraction has real work to do.';
  for (let p = 0; p < pages; p++) {
    if (p > 0) doc.addPage({ size: [360, 480], margin: 0 });
    if (p % 20 === 0) {
      doc.outline.addItem(`Chapter ${p / 20 + 1}: Generated Part ${p / 20 + 1}`);
      doc
        .font('Times-Bold')
        .fontSize(18)
        .text(`Generated Part ${p / 20 + 1}`, 45, 70, { lineBreak: false });
    } else {
      doc.font('Times-Italic').fontSize(8).text('A Large Generated Book', 45, 26, { lineBreak: false });
    }
    doc
      .font('Times-Roman')
      .fontSize(10.5)
      .text(`${sentence} ${sentence} ${sentence} ${sentence}`, 45, 110, { width: 270 });
    doc
      .font('Times-Roman')
      .fontSize(9)
      .text(String(p + 1), 170, 444, { lineBreak: false });
  }
  doc.end();
  return done;
}

const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-large-'));
const app = await buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir, AUTO_SEED: '0' }), {
  startRunner: false,
});
afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('large book (SPEC §19 Phase 2)', () => {
  it('ingests a 320-page PDF without blocking the API, with live progress', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(await largePdf(320))]), 'large.pdf');
    const { bookId } = (await (await fetch(`${base}/api/v1/books`, { method: 'POST', body: form })).json()) as {
      bookId: string;
    };

    const progress: number[] = [];
    const off = app.ctx.bus.subscribe(bookId, (e) => {
      if (e.type === 'progress') progress.push(e.done);
    });
    const ingestion = app.ctx.runner.drain();
    // While the worker thread parses, the API must keep answering quickly.
    const latencies: number[] = [];
    let finished = false;
    void ingestion.then(() => {
      finished = true;
    });
    while (!finished) {
      const t = performance.now();
      const res = await fetch(`${base}/api/v1/health`);
      expect(res.status).toBe(200);
      latencies.push(performance.now() - t);
      await new Promise((r) => setTimeout(r, 50));
    }
    off();
    const book = (await (await fetch(`${base}/api/v1/books/${bookId}`)).json()) as {
      book: { status: string; pageCount: number };
    };
    expect(book.book).toMatchObject({ status: 'structure_review', pageCount: 320 });
    expect(progress.at(-1)).toBe(320);
    expect(progress.length).toBeGreaterThan(100);
    expect(latencies.length).toBeGreaterThan(5);
    expect(Math.max(...latencies)).toBeLessThan(500);
    const report = (await (await fetch(`${base}/api/v1/books/${bookId}/report`)).json()) as {
      report: { stats: { chapters: number; removedHeaderFooterLines: number } };
    };
    expect(report.report.stats.chapters).toBe(16);
    expect(report.report.stats.removedHeaderFooterLines).toBeGreaterThanOrEqual(600);
  }, 180_000);
});
