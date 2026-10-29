import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { newId } from '../db/repo';
import { jobs } from '../db/schema';

export type JobRow = typeof jobs.$inferSelect;
export type Stage = JobRow['stage'];

export const LEASE_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 3;

const iso = (ms = Date.now()) => new Date(ms).toISOString();

export function enqueue(
  db: Db,
  job: {
    bookId: string;
    stage: Stage;
    priority?: number;
    scope?: Record<string, unknown>;
    /** Set for work that belongs to one target language (a recording, a pipeline stage). */
    targetLang?: string;
  },
): string {
  const id = newId('jb');
  db.insert(jobs)
    .values({
      id,
      bookId: job.bookId,
      stage: job.stage,
      status: 'queued',
      priority: job.priority ?? 0,
      scope: job.scope ?? null,
      ...(job.targetLang ? { targetLang: job.targetLang } : {}),
    })
    .run();
  return id;
}

/**
 * Leases the next runnable job atomically: queued jobs, or running jobs whose lease expired (the process
 * died mid-run) — this is what makes the pipeline resumable after a crash or restart.
 */
export function claimNext(db: Db, stages?: Stage[], excludeEngines: string[] = []): JobRow | undefined {
  const now = iso();
  const stageFilter = stages?.length ? `AND j.stage IN (${stages.map(() => '?').join(',')})` : '';
  // Providers that are not connected or wait for their rate limits.
  const engineFilter = excludeEngines.length ? `AND j.engine NOT IN (${excludeEngines.map(() => '?').join(',')})` : '';
  // Agent jobs are materialized as batch files instead; a job waits until its dependencies succeeded. A job of a
  // paused pipeline is never claimed — not even one left 'running' by a process that died, which would otherwise
  // come back to life (and be re-queued) behind the user's «توقف موقت».
  const row = db.$client
    .prepare(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, started_at = COALESCE(started_at, ?)
        WHERE id = (
          SELECT j.id FROM jobs j
           WHERE (j.status = 'queued' OR (j.status = 'running' AND j.lease_until < ?)) ${stageFilter} ${engineFilter}
             AND j.engine <> 'agent'
             AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(j.depends_on, '[]')) d
                               JOIN jobs p ON p.id = d.value WHERE p.status <> 'succeeded')
             AND NOT EXISTS (SELECT 1 FROM books bk
                              WHERE bk.id = j.book_id AND j.target_lang IS NOT NULL
                                AND json_extract(bk.settings, '$.pipeline.' || j.target_lang || '.paused') = 1)
           ORDER BY j.priority DESC, j.seq ASC, j.created_at ASC LIMIT 1)
        RETURNING id`,
    )
    .get(iso(Date.now() + LEASE_MS), now, now, ...(stages ?? []), ...excludeEngines) as { id: string } | undefined;
  return row ? db.select().from(jobs).where(eq(jobs.id, row.id)).get() : undefined;
}

export function heartbeat(db: Db, jobId: string, progress?: { done: number; total: number }): void {
  db.update(jobs)
    .set({ leaseUntil: iso(Date.now() + LEASE_MS), ...(progress ? { progress } : {}) })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
    .run();
}

export function succeed(db: Db, jobId: string): void {
  db.update(jobs)
    .set({ status: 'succeeded', leaseUntil: null, finishedAt: iso(), error: null })
    .where(eq(jobs.id, jobId))
    .run();
}

/** Failed attempts are retried (with a fresh lease) until MAX_ATTEMPTS, then the job fails for good. */
export function fail(db: Db, job: JobRow, error: string, retryable = true): 'retry' | 'failed' {
  const retry = retryable && job.attempts < MAX_ATTEMPTS;
  db.update(jobs)
    .set({ status: retry ? 'queued' : 'failed', leaseUntil: null, error, ...(retry ? {} : { finishedAt: iso() }) })
    .where(eq(jobs.id, job.id))
    .run();
  return retry ? 'retry' : 'failed';
}

/** Back to the queue without using up an attempt (the provider was busy or not connected — not the job's fault). */
export function requeue(db: Db, jobId: string): void {
  db.$client
    .prepare(
      `UPDATE jobs SET status = 'queued', lease_until = NULL, attempts = MAX(attempts - 1, 0) WHERE id = ? AND status = 'running'`,
    )
    .run(jobId);
}

/** Records what a call spent; `usd` only for a model charged per token (ADR-043). */
export function addUsage(db: Db, jobId: string, usage: { tokensIn: number; tokensOut: number }, usd = 0): void {
  db.$client
    .prepare(
      'UPDATE jobs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_usd = COALESCE(cost_usd, 0) + ? WHERE id = ?',
    )
    .run(usage.tokensIn, usage.tokensOut, usd, jobId);
}

export function latestJob(db: Db, bookId: string, stage: Stage): JobRow | undefined {
  return db.$client
    .prepare('SELECT id FROM jobs WHERE book_id = ? AND stage = ? ORDER BY created_at DESC LIMIT 1')
    .all(bookId, stage)
    .map((r) =>
      db
        .select()
        .from(jobs)
        .where(eq(jobs.id, (r as { id: string }).id))
        .get(),
    )[0];
}
