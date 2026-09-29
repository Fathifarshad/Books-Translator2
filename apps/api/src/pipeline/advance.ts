import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getBookRow, getBundle } from '../db/repo';
import { agentBatches, books, glossaryTerms, jobs } from '../db/schema';
import { applyMemory, finalizeChapter } from './apply';
import { planBatch } from './batches';
import { batchPaths } from './exchange';
import {
  createBriefJob,
  createGlossaryJobs,
  createTranslationJobs,
  type JobRow,
  pipelineJobs,
  runnableJobs,
  scopeOf,
} from './jobs';
import { logPipeline, type PipelineCtx, pipelineState, translationSettings, updatePipelineState } from './state';

/**
 * Moves a book's pipeline forward (idempotent; called after start, every import, approvals and priority changes —
 * by the API and by the agent CLI alike). It creates the next jobs whose inputs are ready, writes agent batches up to
 * AGENT_MAX_PENDING, runs the chapter consistency pass, and marks the book ready when everything is done.
 */
export interface AdvanceResult {
  created: number;
  materialized: number;
  done: boolean;
}

const allSucceeded = (list: JobRow[]) => list.every((j) => j.status === 'succeeded');

export function advancePipeline(ctx: PipelineCtx, bookId: string, lang: string): AdvanceResult {
  const { db } = ctx;
  const result: AdvanceResult = { created: 0, materialized: 0, done: false };
  let row = getBookRow(db, bookId);
  if (!row) return result;
  let state = pipelineState(row, lang);
  if (state.cancelled || state.paused || !state.startedAt) return result;
  const settings = translationSettings(row, lang);
  let list = pipelineJobs(db, bookId, lang);
  const of = (stage: string) => list.filter((j) => j.stage === stage);

  // 1. Brief.
  if (!row.brief?.[lang] && of('brief').length === 0) {
    createBriefJob(db, bookId, lang, settings);
    result.created++;
    logPipeline(ctx, bookId, lang, 'brief: queued');
    list = pipelineJobs(db, bookId, lang);
  }
  const briefDone = Boolean(row.brief?.[lang]) || (of('brief').length > 0 && allSucceeded(of('brief')));

  // 2. Glossary candidates → consolidation batches.
  if (briefDone && !state.glossaryPlanned) {
    const bundle = getBundle(db, bookId);
    const n = bundle ? createGlossaryJobs(db, bundle, lang, settings) : 0;
    result.created += n;
    state = updatePipelineState(db, bookId, lang, (s) => {
      s.glossaryPlanned = true;
    });
    logPipeline(ctx, bookId, lang, `glossary: ${n} batch(es) queued`);
    list = pipelineJobs(db, bookId, lang);
  }
  const glossaryDone = state.glossaryPlanned && allSucceeded(of('glossary'));

  // 3. Glossary review (human, unless auto-approve).
  if (glossaryDone && !state.glossaryApproved && settings.autoApproveGlossary) {
    approveGlossary(ctx, bookId, lang);
    row = getBookRow(db, bookId) ?? row;
    state = pipelineState(row, lang);
  }

  // 4. Translate and edit jobs.
  if (state.glossaryApproved && !state.translationPlanned) {
    const n = createTranslationJobs(db, bookId, lang, settings, state.boosted);
    result.created += n;
    state = updatePipelineState(db, bookId, lang, (s) => {
      s.translationPlanned = true;
    });
    logPipeline(ctx, bookId, lang, `translation: ${n} job(s) queued`);
  }

  // 5. Agent batches.
  result.materialized = materializeAgentJobs(ctx, bookId, lang);

  // 6. Chapter consistency pass and completion.
  if (state.translationPlanned) {
    list = pipelineJobs(db, bookId, lang);
    const byChapter = new Map<string, JobRow[]>();
    for (const j of list) {
      if (j.stage !== 'translate' && j.stage !== 'edit') continue;
      const ch = scopeOf(j).chapterId ?? scopeOf(j).nodeId;
      if (!ch || scopeOf(j).rerun) continue;
      byChapter.set(ch, [...(byChapter.get(ch) ?? []), j]);
    }
    const finalized = new Set(state.finalizedChapters);
    for (const [chapterId, chapterJobs] of byChapter) {
      if (finalized.has(chapterId) || !allSucceeded(chapterJobs)) continue;
      finalizeChapter(ctx, bookId, lang, chapterId);
      finalized.add(chapterId);
    }
    if (finalized.size !== state.finalizedChapters.length) {
      state = updatePipelineState(db, bookId, lang, (s) => {
        s.finalizedChapters = [...finalized];
      });
    }
    if (allSucceeded(list) && !state.finishedAt) {
      updatePipelineState(db, bookId, lang, (s) => {
        s.finishedAt = new Date().toISOString();
      });
      db.update(books).set({ status: 'ready', updatedAt: new Date().toISOString() }).where(eq(books.id, bookId)).run();
      ctx.notify(bookId, { type: 'book', status: 'ready' });
      logPipeline(ctx, bookId, lang, 'pipeline finished');
      result.done = true;
    }
  }
  return result;
}

/** Approves every proposed glossary term of the book and opens the translation stage. */
export function approveGlossary(ctx: PipelineCtx, bookId: string, lang: string, ids?: string[]): number {
  const where = and(
    eq(glossaryTerms.bookId, bookId),
    eq(glossaryTerms.tgtLang, lang),
    eq(glossaryTerms.status, 'proposed'),
    ...(ids ? [inArray(glossaryTerms.id, ids)] : []),
  );
  const n = ctx.db.update(glossaryTerms).set({ status: 'approved' }).where(where).run().changes;
  if (!ids) {
    updatePipelineState(ctx.db, bookId, lang, (s) => {
      s.glossaryApproved = true;
    });
    logPipeline(ctx, bookId, lang, 'glossary: approved');
  }
  ctx.notify(bookId, { type: 'glossary', lang });
  return n;
}

export function agentCounts(ctx: PipelineCtx, bookId: string): { pending: number; leased: number } {
  const rows = ctx.db.$client
    .prepare(
      `SELECT status, COUNT(*) AS n FROM agent_batches WHERE book_id = ? AND status IN ('pending','leased') GROUP BY status`,
    )
    .all(bookId) as { status: string; n: number }[];
  return {
    pending: rows.find((r) => r.status === 'pending')?.n ?? 0,
    leased: rows.find((r) => r.status === 'leased')?.n ?? 0,
  };
}

/**
 * Writes batch files for runnable agent jobs (at most AGENT_MAX_PENDING open batches per book). Jobs with nothing
 * left to do (all segments done or reused from translation memory) succeed immediately, which may unlock others.
 */
export function materializeAgentJobs(ctx: PipelineCtx, bookId: string, lang: string): number {
  const { db, config } = ctx;
  let written = 0;
  for (let round = 0; round < 1000; round++) {
    const open = agentCounts(ctx, bookId);
    const capacity = config.AGENT_MAX_PENDING - open.pending - open.leased;
    if (capacity <= 0) break;
    const runnable = runnableJobs(db, { bookId, lang, engine: 'agent' }, capacity);
    if (runnable.length === 0) break;
    let progressed = false;
    for (const job of runnable) {
      try {
        const plan = planBatch(ctx, job);
        applyMemory(ctx, bookId, lang, plan.memory);
        if (!plan.built) {
          db.update(jobs)
            .set({ status: 'succeeded', finishedAt: new Date().toISOString() })
            .where(eq(jobs.id, job.id))
            .run();
          progressed = true;
          continue;
        }
        const { batch, keyMap } = plan.built;
        const paths = batchPaths(config, bookId, batch.task, batch.batchId);
        mkdirSync(dirname(paths.batch), { recursive: true });
        mkdirSync(dirname(paths.result), { recursive: true });
        writeFileSync(paths.batch, `${JSON.stringify(batch, null, 2)}\n`, 'utf8');
        db.transaction(() => {
          db.insert(agentBatches)
            .values({
              id: batch.batchId,
              bookId,
              jobId: job.id,
              task: batch.task,
              targetLang: lang,
              filePath: paths.batch,
              resultPath: paths.result,
              keyMap,
              status: 'pending',
              priority: job.priority,
              seq: job.seq,
            })
            .run();
          db.update(jobs)
            .set({ status: 'awaiting_agent', startedAt: new Date().toISOString() })
            .where(eq(jobs.id, job.id))
            .run();
        });
        written++;
        progressed = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.update(jobs)
          .set({ status: 'failed', error: message, finishedAt: new Date().toISOString() })
          .where(eq(jobs.id, job.id))
          .run();
        logPipeline(ctx, bookId, lang, `${job.stage}: ${message}`, 'error');
      }
    }
    if (!progressed) break;
  }
  if (written > 0) {
    ctx.notify(bookId, { type: 'agent', ...agentCounts(ctx, bookId) });
    ctx.notify(bookId, { type: 'pipeline', lang });
  }
  return written;
}

/** Re-runs advance for every book that is translating (API start-up, after the CLI changed the database). */
export function advanceAll(ctx: PipelineCtx): void {
  const rows = ctx.db.select({ id: books.id }).from(books).where(sql`${books.status} = 'translating'`).all();
  for (const { id } of rows) {
    const row = getBookRow(ctx.db, id);
    for (const lang of Object.keys((row?.settings as { pipeline?: Record<string, unknown> })?.pipeline ?? {})) {
      advancePipeline(ctx, id, lang);
    }
  }
}
