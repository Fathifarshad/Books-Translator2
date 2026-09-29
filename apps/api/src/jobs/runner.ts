import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  createMockEngine,
  createProviderEngine,
  type Engine,
  loadTaskPrompt,
  ProviderError,
  validateResult,
} from '@dozabaneh/ai';
import { ingestInWorker } from '@dozabaneh/pdf';
import { type AgentBatch, isProviderId } from '@dozabaneh/shared';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { type Config, repoRoot } from '../config';
import type { Db } from '../db/client';
import { getBookRow, getBundle, saveIngestion } from '../db/repo';
import { books } from '../db/schema';
import type { EventBus } from '../events';
import { advancePipeline } from '../pipeline/advance';
import { applyMemory, importResult } from '../pipeline/apply';
import { approvedTerms, planBatch } from '../pipeline/batches';
import { promptVersionOf } from '../pipeline/prompts';
import { logPipeline, type PipelineCtx } from '../pipeline/state';
import type { ProviderService } from '../settings/providers';
import { addUsage, claimNext, fail, heartbeat, type JobRow, requeue, succeed } from './queue';

export interface RunnerDeps {
  db: Db;
  bus: EventBus;
  config: Config;
  providers: ProviderService;
  log: FastifyBaseLogger;
}

/** A provider request may wait this long for its per-minute limit; longer waits put the job back in the queue. */
const MAX_INLINE_WAIT_MS = 65_000;

const readPrompt = (ref: string) => readFileSync(join(repoRoot(), ref), 'utf8');

const PIPELINE: ReadonlySet<string> = new Set(['brief', 'glossary', 'translate', 'edit']);

/** Stage handlers: ingestion, and pipeline stages run by in-process engines (agent jobs are batch files). */
const handlers: Partial<Record<JobRow['stage'], (job: JobRow, deps: RunnerDeps) => Promise<void>>> = {
  ingest: runIngest,
  brief: runPipelineJob,
  glossary: runPipelineJob,
  translate: runPipelineJob,
  edit: runPipelineJob,
};

export function pipelineCtx({
  db,
  config,
  bus,
  providers,
}: Pick<RunnerDeps, 'db' | 'config' | 'bus'> & { providers?: ProviderService }): PipelineCtx {
  return {
    db,
    config,
    notify: (bookId, event) => bus.publish(bookId, event),
    ...(providers ? { providers } : {}),
  };
}

/** In-process engine for a job: the offline mock, or a free provider (system prompt from prompts/). */
function engineFor(
  job: JobRow,
  deps: RunnerDeps,
  validate: (b: AgentBatch, raw: unknown) => ReturnType<typeof validateResult>,
): Engine {
  if (job.engine === 'mock') return createMockEngine({ latencyMs: deps.config.MOCK_LATENCY_MS });
  const id = job.engine;
  if (!isProviderId(id)) throw new Error(`engine "${job.engine}" is not available in this version`);
  return createProviderEngine({
    client: deps.providers.client(id),
    systemPrompt: (b) =>
      loadTaskPrompt(b.task, { sourceLang: b.sourceLanguage, targetLang: b.targetLanguage }, readPrompt).system,
    validate,
    beforeRequest: () => deps.providers.acquire(id, MAX_INLINE_WAIT_MS, () => heartbeat(deps.db, job.id)),
  });
}

async function runPipelineJob(job: JobRow, deps: RunnerDeps): Promise<void> {
  const ctx = pipelineCtx(deps);
  const lang = job.targetLang as string;
  const plan = planBatch(ctx, job);
  applyMemory(ctx, job.bookId, lang, plan.memory);
  if (!plan.built) return;
  const { batch, keyMap } = plan.built;
  const bundle = getBundle(deps.db, job.bookId);
  const glossary = bundle
    ? approvedTerms(bundle, lang).map((g) => ({ src: g.src, tgt: g.tgt, alternatives: g.alternatives, kind: g.kind }))
    : [];
  const validate = (b: AgentBatch, raw: unknown) =>
    validateResult(b, raw, { sourceLang: b.sourceLanguage, targetLang: lang, glossary });
  const res = await engineFor(job, deps, validate).run(batch, {});
  if (res.kind !== 'done') throw new Error('in-process engines must return a result');
  if (isProviderId(job.engine)) deps.providers.reportSuccess(job.engine);
  if (res.usage) addUsage(deps.db, job.id, res.usage);
  // Provider answers were validated inside the engine (with a repair round); validate every engine's output here.
  const report = validate(batch, { schemaVersion: 1, batchId: batch.batchId, ...res.output });
  if (!report.ok || !report.output) {
    throw new Error(report.errors.map((e) => `${e.key ? `[${e.key}] ` : ''}${e.rule}: ${e.message}`).join(' · '));
  }
  importResult(ctx, job, keyMap, report.output, {
    engine: job.engine,
    ...(res.model ? { model: res.model } : {}),
    promptVersion: promptVersionOf(batch.promptRefs[0] ?? ''),
  });
}

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

  /** Jobs whose provider is rate-limited or not connected wait in the queue; everything else keeps moving. */
  private claim(): JobRow | undefined {
    return claimNext(this.deps.db, Object.keys(handlers) as JobRow['stage'][], this.deps.providers.blockedEngines());
  }

  private async runOne(): Promise<boolean> {
    if (this.running) return false;
    const { db, bus, log } = this.deps;
    const job = this.claim();
    if (!job) return false;
    this.running = true;
    bus.publish(job.bookId, { type: 'job', jobId: job.id, stage: job.stage, status: 'running' });
    const pipeline = PIPELINE.has(job.stage) && job.targetLang ? job.targetLang : null;
    // Slow providers (a local model on a CPU) can take minutes: keep the lease alive.
    const beat = setInterval(() => heartbeat(db, job.id), 60_000);
    try {
      await handlers[job.stage]?.(job, this.deps);
      succeed(db, job.id);
      bus.publish(job.bookId, { type: 'job', jobId: job.id, stage: job.stage, status: 'succeeded' });
      if (pipeline) advancePipeline(pipelineCtx(this.deps), job.bookId, pipeline);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ProviderError && isProviderId(job.engine)) {
        if (this.deps.providers.reportError(job.engine, err) === 'requeue') {
          requeue(db, job.id);
          if (pipeline && err.status !== 0)
            logPipeline(pipelineCtx(this.deps), job.bookId, pipeline, `${job.engine}: ${message}`, 'warn');
          bus.publish(job.bookId, { type: 'job', jobId: job.id, stage: job.stage, status: 'queued' });
          return true;
        }
      }
      // A broken or oversized PDF will not get better on retry.
      const retryable = !/Invalid PDF|too many pages|not a PDF/i.test(message);
      const outcome = fail(db, job, message, retryable);
      log.warn({ jobId: job.id, stage: job.stage, outcome }, 'job failed');
      if (outcome === 'failed' && job.stage === 'ingest') {
        db.update(books).set({ status: 'failed', error: message }).where(eq(books.id, job.bookId)).run();
        bus.publish(job.bookId, { type: 'book', status: 'failed' });
      }
      if (pipeline)
        logPipeline(
          pipelineCtx(this.deps),
          job.bookId,
          pipeline,
          `${job.stage}: ${message}`,
          outcome === 'failed' ? 'error' : 'warn',
        );
      bus.publish(job.bookId, { type: 'job', jobId: job.id, stage: job.stage, status: outcome, error: message });
    } finally {
      clearInterval(beat);
      this.running = false;
    }
    return true;
  }
}
