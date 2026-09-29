import { Worker } from 'node:worker_threads';
import type { Analysis } from './pipeline';
import type { IngestWorkerData, IngestWorkerMessage } from './worker';

export interface IngestInWorkerOptions {
  lang?: string;
  maxPages?: number;
  onProgress?: (page: number, total: number) => void;
  /** Whole-document limit; the worker is terminated when it is exceeded. */
  timeoutMs?: number;
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
    const timer = setTimeout(
      () => finish(() => reject(new Error('ingestion timed out'))),
      opts.timeoutMs ?? 10 * 60_000,
    );
    const onAbort = () => finish(() => reject(new Error('ingestion aborted')));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    worker.on('message', (m: IngestWorkerMessage) => {
      if (m.type === 'progress') opts.onProgress?.(m.page, m.total);
      else if (m.type === 'done') finish(() => resolve(m.result));
      else finish(() => reject(new Error(m.message)));
    });
    worker.on('error', (err) => finish(() => reject(err)));
    worker.on('exit', (code) => finish(() => reject(new Error(`ingestion worker exited (${code})`))));
  });
}
