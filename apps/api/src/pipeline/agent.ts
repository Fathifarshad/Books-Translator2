import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { formatReport, validateResult } from '@dozabaneh/ai';
import type { AgentBatch, AgentTask } from '@dozabaneh/shared';
import { eq } from 'drizzle-orm';
import { getBookRow, getBundle } from '../db/repo';
import { agentBatches, jobs } from '../db/schema';
import { advancePipeline, agentCounts } from './advance';
import { AlreadyDone, importResult } from './apply';
import { approvedTerms } from './batches';
import { batchIdFromPath, batchPaths, displayPath, resolveUserPath } from './exchange';
import { promptVersionOf } from './prompts';
import type { PipelineCtx } from './state';

/**
 * Agent protocol (SPEC §10.3): status → next (lease) → the agent writes the result → submit (validate + import in
 * one transaction) → follow-up batches are created in the same step. Works with or without the API running.
 */
type BatchRow = typeof agentBatches.$inferSelect;

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const TASK_ORDER: AgentTask[] = ['tutor_answer', 'summary', 'quiz', 'brief', 'glossary', 'translate', 'edit'];

/** Expired leases go back to the pool. */
export function releaseExpiredLeases(ctx: PipelineCtx): number {
  return ctx.db.$client
    .prepare(
      `UPDATE agent_batches SET status = 'pending', lease_until = NULL WHERE status = 'leased' AND lease_until < ?`,
    )
    .run(iso()).changes;
}

export interface AgentStatusRow {
  bookId: string;
  title: string;
  pending: number;
  leased: number;
  byTask: Partial<Record<AgentTask, { pending: number; leased: number }>>;
}

export function agentStatus(ctx: PipelineCtx): { books: AgentStatusRow[]; pending: number; leased: number } {
  releaseExpiredLeases(ctx);
  const rows = ctx.db.$client
    .prepare(
      `SELECT b.book_id AS bookId, b.task AS task, b.status AS status, COUNT(*) AS n
         FROM agent_batches b JOIN jobs j ON j.id = b.job_id
        WHERE b.status IN ('pending','leased') AND j.status = 'awaiting_agent'
        GROUP BY b.book_id, b.task, b.status`,
    )
    .all() as { bookId: string; task: AgentTask; status: 'pending' | 'leased'; n: number }[];
  const books = new Map<string, AgentStatusRow>();
  for (const r of rows) {
    const row = getBookRow(ctx.db, r.bookId);
    const entry = books.get(r.bookId) ?? {
      bookId: r.bookId,
      title: row?.titles[row.sourceLang] ?? r.bookId,
      pending: 0,
      leased: 0,
      byTask: {},
    };
    const t = entry.byTask[r.task] ?? { pending: 0, leased: 0 };
    t[r.status] += r.n;
    entry[r.status] += r.n;
    entry.byTask[r.task] = t;
    books.set(r.bookId, entry);
  }
  const list = [...books.values()];
  return {
    books: list,
    pending: list.reduce((n, b) => n + b.pending, 0),
    leased: list.reduce((n, b) => n + b.leased, 0),
  };
}

export interface NextBatch {
  batchId: string;
  bookId: string;
  task: AgentTask;
  batchPath: string;
  resultPath: string;
  promptRefs: string[];
  items: number;
  leaseUntil: string;
}

/** Leases the next batch: tutor answers, summaries/quizzes, brief, glossary, then translate/edit by priority and document order. */
export function agentNext(ctx: PipelineCtx, filter: { task?: string; bookId?: string } = {}): NextBatch | null {
  releaseExpiredLeases(ctx);
  const conds = ["b.status = 'pending'", "j.status = 'awaiting_agent'"];
  const args: unknown[] = [];
  if (filter.task) {
    conds.push('b.task = ?');
    args.push(filter.task);
  }
  if (filter.bookId) {
    conds.push('b.book_id = ?');
    args.push(filter.bookId);
  }
  const order = `CASE b.task ${TASK_ORDER.map((t, i) => `WHEN '${t}' THEN ${i}`).join(' ')} ELSE 99 END`;
  const leaseUntil = iso(Date.now() + ctx.config.AGENT_LEASE_MINUTES * 60_000);
  const picked = ctx.db.$client
    .prepare(
      `UPDATE agent_batches SET status = 'leased', leased_at = ?, lease_until = ?
        WHERE id = (SELECT b.id FROM agent_batches b JOIN jobs j ON j.id = b.job_id
                     WHERE ${conds.join(' AND ')}
                     ORDER BY b.priority DESC, ${order}, b.seq ASC, b.created_at ASC LIMIT 1)
        RETURNING id`,
    )
    .get(iso(), leaseUntil, ...args) as { id: string } | undefined;
  if (!picked) return null;
  const row = ctx.db.select().from(agentBatches).where(eq(agentBatches.id, picked.id)).get() as BatchRow;
  const batch = JSON.parse(readFileSync(row.filePath, 'utf8')) as AgentBatch<{
    items?: unknown[];
    candidates?: unknown[];
  }>;
  ctx.notify(row.bookId, { type: 'agent', ...agentCounts(ctx, row.bookId) });
  return {
    batchId: row.id,
    bookId: row.bookId,
    task: row.task as AgentTask,
    batchPath: displayPath(row.filePath),
    resultPath: displayPath(row.resultPath),
    promptRefs: batch.promptRefs,
    items: batch.input.items?.length ?? batch.input.candidates?.length ?? 1,
    leaseUntil,
  };
}

export function agentRelease(ctx: PipelineCtx, batchId: string): boolean {
  const row = ctx.db.select().from(agentBatches).where(eq(agentBatches.id, batchId)).get();
  if (row?.status !== 'leased') return false;
  ctx.db
    .update(agentBatches)
    .set({ status: 'pending', leaseUntil: null, lastError: row.lastError ?? 'released' })
    .where(eq(agentBatches.id, batchId))
    .run();
  ctx.notify(row.bookId, { type: 'agent', ...agentCounts(ctx, row.bookId) });
  return true;
}

export interface SubmitOutcome {
  ok: boolean;
  /** The batch was imported before: nothing happened (idempotent re-submit). */
  alreadyImported?: boolean;
  batchId?: string;
  report: string;
  imported?: number;
  followUps?: number;
}

/** Validates (dry run) or validates and imports a result file. */
export function agentSubmit(ctx: PipelineCtx, resultPathArg: string, opts: { dryRun?: boolean } = {}): SubmitOutcome {
  const resultPath = resolveUserPath(resultPathArg);
  let raw: string | undefined;
  if (existsSync(resultPath)) raw = readFileSync(resultPath, 'utf8');
  let batchId = batchIdFromPath(resultPath);
  if (raw) {
    try {
      const parsed = JSON.parse(raw.replace(/^\u{FEFF}/u, '')) as { batchId?: unknown };
      if (typeof parsed.batchId === 'string') batchId = parsed.batchId;
    } catch {
      // reported by validation below
    }
  }
  if (!batchId) {
    return {
      ok: false,
      report: `✗ Cannot tell which batch ${resultPathArg} belongs to: add "batchId" or keep the <batchId>.result.json file name.`,
    };
  }
  const row = ctx.db.select().from(agentBatches).where(eq(agentBatches.id, batchId)).get();
  if (!row)
    return {
      ok: false,
      batchId,
      report: `✗ Unknown batch ${batchId}. Run \`pnpm -s agent:status\` to see open batches.`,
    };
  if (row.status === 'imported') {
    return { ok: true, alreadyImported: true, batchId, report: `✓ ${batchId} was already imported — nothing to do.` };
  }
  if (row.status === 'cancelled') {
    return {
      ok: false,
      batchId,
      report: `✗ ${batchId} was cancelled (the pipeline was cancelled or restarted). Take the next batch.`,
    };
  }
  if (!raw) return { ok: false, batchId, report: `✗ Result file not found: ${resultPathArg}` };

  const batch = JSON.parse(readFileSync(row.filePath, 'utf8')) as AgentBatch;
  const bundle = getBundle(ctx.db, row.bookId);
  const glossary = bundle
    ? approvedTerms(bundle, row.targetLang).map((g) => ({
        src: g.src,
        tgt: g.tgt,
        alternatives: g.alternatives,
        kind: g.kind,
      }))
    : [];
  const report = validateResult(batch, raw, {
    sourceLang: batch.sourceLanguage,
    targetLang: batch.targetLanguage,
    glossary,
  });
  const text = formatReport(report, batchId);
  if (!report.ok || !report.output) {
    if (!opts.dryRun) {
      ctx.db
        .update(agentBatches)
        .set({ attempts: row.attempts + 1, lastError: report.errors[0]?.message ?? 'invalid result' })
        .where(eq(agentBatches.id, batchId))
        .run();
    }
    return { ok: false, batchId, report: text };
  }
  if (opts.dryRun) return { ok: true, batchId, report: text.replace(': valid', ': valid (dry run, nothing imported)') };

  const job = ctx.db.select().from(jobs).where(eq(jobs.id, row.jobId)).get();
  if (!job) return { ok: false, batchId, report: `✗ The job of ${batchId} no longer exists.` };
  let imported = 0;
  try {
    const version = promptVersionOf(batch.promptRefs[0] ?? '');
    imported = importResult(ctx, job, row.keyMap, report.output, { engine: 'agent', promptVersion: version }).length;
  } catch (err) {
    if (err instanceof AlreadyDone) {
      return {
        ok: true,
        alreadyImported: true,
        batchId,
        report: `✓ ${batchId}: its job is already ${err.status} — nothing to do.`,
      };
    }
    throw err;
  }
  ctx.db
    .update(agentBatches)
    .set({ status: 'imported', importedAt: iso(), attempts: row.attempts + 1, lastError: null })
    .where(eq(agentBatches.id, batchId))
    .run();
  // Archive both files; a later re-submit of the same path is recognized as already imported.
  const archive = batchPaths(ctx.config, row.bookId, row.task, row.id).archiveDir;
  mkdirSync(archive, { recursive: true });
  for (const file of [resultPath, row.filePath]) {
    if (existsSync(file)) renameSync(file, join(archive, basename(file)));
  }
  const next = advancePipeline(ctx, row.bookId, row.targetLang);
  ctx.notify(row.bookId, { type: 'agent', ...agentCounts(ctx, row.bookId) });
  const extra = next.materialized ? `\n  → ${next.materialized} new batch(es) created.` : '';
  return { ok: true, batchId, report: `${text}${extra}`, imported, followUps: next.materialized };
}
