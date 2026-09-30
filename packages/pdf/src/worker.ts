import { readFile } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { ocrLanguageOf } from '@dozabaneh/text';
import { ingestPdf } from './pipeline';

export interface IngestWorkerData {
  filePath: string;
  lang?: string;
  maxPages?: number;
  /** Read scanned pages with OCR (default true). */
  ocr?: boolean;
}

export type IngestWorkerMessage =
  | { type: 'progress'; page: number; total: number; ocrPages: number }
  | { type: 'done'; result: Omit<Awaited<ReturnType<typeof ingestPdf>>, 'blocks'> }
  | { type: 'error'; message: string };

/** worker_threads entry: pdf.js work runs here so the API event loop stays responsive (SPEC §8.2). */
async function main() {
  const { filePath, lang, maxPages, ocr } = workerData as IngestWorkerData;
  const post = (m: IngestWorkerMessage) => parentPort?.postMessage(m);
  try {
    const data = new Uint8Array(await readFile(filePath));
    const ocrLang = ocr === false ? undefined : ocrLanguageOf(lang ?? 'en');
    const { blocks: _blocks, ...result } = await ingestPdf(data, {
      ...(lang ? { lang } : {}),
      ...(maxPages ? { maxPages } : {}),
      ...(ocrLang ? { ocr: { lang: ocrLang } } : {}),
      onPage: (page, total, ocrPages = 0) => post({ type: 'progress', page, total, ocrPages }),
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

void main();
