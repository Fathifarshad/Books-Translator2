import { Worker } from 'node:worker_threads';
import type { Analysis } from './pipeline';
import type { IngestWorkerData, IngestWorkerMessage } from './worker';

export interface IngestInWorkerOptions {
  lang?: string;
  maxPages?: number;
  /** Read scanned pages with OCR (default true). */
  ocr?: boolean;
  onProgress?: (page: number, total: number, ocrPages: number) => void;
  /** No progress for this long (ms) terminates the worker; OCR of a long scanned book takes hours, not a hang. */
  idleTimeoutMs?: number;
  signal?: AbortSignal;
}

export type IngestResult = Omit<Analysis, 'blocks'>;

/**
 * Runs PDF ingestion in a worker thread. The worker can be terminated (timeout/abort), so a hostile or
 * huge PDF never blocks the API process.
 */
export function ingestInWorker(filePath: string, opts: IngestInWorkerOptions = {}): Promise<IngestResult> {
  // From TypeScript sources the worker boots through tsx; a bundled build would start worker.js directly.
  const fromSource = import.meta.url.endsWith('.ts');
  const url = new URL(fromSource ? './worker-boot.mjs' : './worker.js', import.meta.url);
  const data: IngestWorkerData = {
    filePath,
    ...(opts.lang ? { lang: opts.lang } : {}),
    ...(opts.maxPages ? { maxPages: opts.maxPages } : {}),
    ...(opts.ocr === false ? { ocr: false } : {}),
  };
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, { workerData: data });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
      void worker.terminate();
    };
    const idle = opts.idleTimeoutMs ?? 5 * 60_000;
    let timer = setTimeout(() => finish(() => reject(new Error('ingestion timed out'))), idle);
    const onAbort = () => finish(() => reject(new Error('ingestion aborted')));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    worker.on('message', (m: IngestWorkerMessage) => {
      if (m.type === 'progress') {
        clearTimeout(timer);
        timer = setTimeout(() => finish(() => reject(new Error('ingestion timed out'))), idle);
        opts.onProgress?.(m.page, m.total, m.ocrPages);
      } else if (m.type === 'done') finish(() => resolve(m.result));
      else finish(() => reject(new Error(m.message)));
    });
    worker.on('error', (err) => finish(() => reject(err)));
    worker.on('exit', (code) => finish(() => reject(new Error(`ingestion worker exited (${code})`))));
  });
}
