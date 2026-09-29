import { basename } from 'node:path';
import { ingestInWorker } from '@dozabaneh/pdf';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { getBookRow, saveIngestion } from '../db/repo';
import { books } from '../db/schema';
import type { EventBus } from '../events';
import { claimNext, fail, heartbeat, type JobRow, succeed } from './queue';

export interface RunnerDeps {
  db: Db;
  bus: EventBus;
  config: Config;
  log: FastifyBaseLogger;
}

/** Stage handlers. Phase 2 has ingestion; Phase 3 adds brief/glossary/translate/edit/… */
const handlers: Partial<Record<JobRow['stage'], (job: JobRow, deps: RunnerDeps) => Promise<void>>> = {
  ingest: runIngest,
};

async function runIngest(job: JobRow, { db, bus, config }: RunnerDeps): Promise<void> {
  const book = getBookRow(db, job.bookId);
  if (!book?.filePath) throw new Error('book or file missing');
  db.update(books).set({ status: 'ingesting', error: null }).where(eq(books.id, book.id)).run();
  bus.publish(book.id, { type: 'book', status: 'ingesting' });
  let lastBeat = 0;
  const result = await ingestInWorker(book.filePath, {
    lang: book.sourceLang,
    maxPages: config.MAX_PAGES,
    onProgress: (done, total) => {
      bus.publish(book.id, { type: 'progress', stage: 'ingest', done, total });
      if (Date.now() - lastBeat > 2000 || done === total) {
        lastBeat = Date.now();
        heartbeat(db, job.id, { done, total });
      }
    },
  });
  const fallbackTitle = (book.fileName ?? basename(book.filePath)).replace(/\.pdf$/i, '');
  saveIngestion(db, book.id, result, fallbackTitle);
  bus.publish(book.id, { type: 'book', status: 'structure_review' });
}

/**
 * Inline worker (WORKER_MODE=inline): polls the DB-backed queue and runs one job at a time. PDF parsing
 * itself happens in a worker thread, so the API stays responsive during a 300+ page ingestion.
 */
export class JobRunner {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  /** Not started until start() — tests drive the queue with drain(). */
  private stopped = true;

  constructor(private readonly deps: RunnerDeps) {}

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Wake up now (e.g. right after an upload) instead of waiting for the next poll. */
  kick(): void {
    if (!this.running && !this.stopped) this.schedule(0);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  /** Runs jobs until the queue is empty; resolves when idle (used by tests). */
  async drain(): Promise<void> {
    while (await this.runOne()) {
      // keep going
    }
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    await this.drain();
    if (!this.stopped) this.schedule(1000);
  }

  private async runOne(): Promise<boolean> {
    if (this.running) return false;
    const { db, bus, log } = this.deps;
    const job = claimNext(db, Object.keys(handlers) as JobRow['stage'][]);
    if (!job) return false;
    this.running = true;
    bus.publish(job.bookId, { type: 'job', jobId: job.id, stage: job.stage, status: 'running' });
    try {
      await handlers[job.stage]?.(job, this.deps);
      succeed(db, job.id);
      bus.publish(job.bookId, { type: 'job', jobId: job.id, stage: job.stage, status: 'succeeded' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A broken or oversized PDF will not get better on retry.
      const retryable = !/Invalid PDF|too many pages|not a PDF/i.test(message);
      const outcome = fail(db, job, message, retryable);
      log.warn({ jobId: job.id, stage: job.stage, outcome }, 'job failed');
      if (outcome === 'failed' && job.stage === 'ingest') {
        db.update(books).set({ status: 'failed', error: message }).where(eq(books.id, job.bookId)).run();
        bus.publish(job.bookId, { type: 'book', status: 'failed' });
      }
      bus.publish(job.bookId, { type: 'job', jobId: job.id, stage: job.stage, status: outcome, error: message });
    } finally {
      this.running = false;
    }
    return true;
  }
}
