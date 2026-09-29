import {
  chapterOf,
  createBookIndex,
  extractCandidates,
  needsTranslation,
  taskPriority,
  translationCounter,
} from '@dozabaneh/core';
import {
  isProviderId,
  PIPELINE_TASKS,
  type PipelineEstimate,
  type PipelineStage,
  type PipelineStatus,
  type TranslationSettings,
  TranslationSettingsSchema,
} from '@dozabaneh/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getBookRow, getBundle, refreshCounters } from '../db/repo';
import { agentBatches, books, bookTargets, jobs, translations } from '../db/schema';
import { advancePipeline, agentCounts } from './advance';
import { type JobRow, pipelineJobs, planTranslation, scopeOf } from './jobs';
import {
  logPipeline,
  type PipelineCtx,
  pipelineState,
  translationSettings,
  updatePipelineState,
  updateSettings,
} from './state';

/** Pipeline control used by the HTTP routes (SPEC §17: estimate, start, pause, resume, cancel, priority). */
export class PipelineError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const STARTABLE = new Set(['ready_to_translate', 'translating', 'ready']);

export function startPipeline(
  ctx: PipelineCtx,
  bookId: string,
  lang: string,
  input: Partial<TranslationSettings>,
): void {
  const { db } = ctx;
  const row = getBookRow(db, bookId);
  if (!row) throw new PipelineError('BOOK_NOT_FOUND', 404);
  if (!STARTABLE.has(row.status)) throw new PipelineError('BOOK_NOT_READY');
  if (lang === row.sourceLang) throw new PipelineError('SAME_LANGUAGE', 400);
  const settings = TranslationSettingsSchema.parse({ ...translationSettings(row, lang), ...input });
  // A free provider must be connected (key + model) before its jobs are created.
  const notReady = (ctx.providers?.status(PIPELINE_TASKS.map((t) => settings.engines[t])) ?? []).filter(
    (p) => !p.ready,
  );
  if (notReady.length) throw new PipelineError('PROVIDER_NOT_READY', 409, { providers: notReady.map((p) => p.id) });
  db.transaction(() => {
    updateSettings(db, bookId, (s) => {
      s.translation = { ...(s.translation ?? {}), [lang]: settings };
    });
    db.insert(bookTargets).values({ bookId, lang }).onConflictDoNothing().run();
    const glossaryDone = pipelineJobs(db, bookId, lang)
      .filter((j) => j.stage === 'glossary')
      .every((j) => j.status === 'succeeded');
    updatePipelineState(db, bookId, lang, (s) => {
      const restart = s.cancelled || Boolean(s.finishedAt) || !s.startedAt;
      s.paused = false;
      s.cancelled = false;
      if (restart) {
        s.startedAt = new Date().toISOString();
        delete s.finishedAt;
        s.translationPlanned = false;
        s.glossaryPlanned = s.glossaryPlanned && glossaryDone;
      }
    });
    // Resume paused work too.
    resumeJobs(ctx, bookId, lang);
    db.update(books)
      .set({ status: 'translating', updatedAt: new Date().toISOString() })
      .where(eq(books.id, bookId))
      .run();
  });
  refreshCounters(db, bookId);
  ctx.notify(bookId, { type: 'book', status: 'translating' });
  logPipeline(ctx, bookId, lang, `pipeline started (${settings.profile})`);
  advancePipeline(ctx, bookId, lang);
}

function resumeJobs(ctx: PipelineCtx, bookId: string, lang: string): void {
  ctx.db.$client
    .prepare(
      `UPDATE jobs SET status = CASE WHEN EXISTS (SELECT 1 FROM agent_batches b WHERE b.job_id = jobs.id AND b.status IN ('pending','leased'))
                                THEN 'awaiting_agent' ELSE 'queued' END
        WHERE book_id = ? AND target_lang = ? AND status = 'paused'`,
    )
    .run(bookId, lang);
}

export function pausePipeline(ctx: PipelineCtx, bookId: string, lang: string): void {
  updatePipelineState(ctx.db, bookId, lang, (s) => {
    s.paused = true;
  });
  ctx.db
    .update(jobs)
    .set({ status: 'paused' })
    .where(and(eq(jobs.bookId, bookId), eq(jobs.targetLang, lang), inArray(jobs.status, ['queued', 'awaiting_agent'])))
    .run();
  logPipeline(ctx, bookId, lang, 'pipeline paused');
}

export function resumePipeline(ctx: PipelineCtx, bookId: string, lang: string): void {
  updatePipelineState(ctx.db, bookId, lang, (s) => {
    s.paused = false;
  });
  resumeJobs(ctx, bookId, lang);
  logPipeline(ctx, bookId, lang, 'pipeline resumed');
  advancePipeline(ctx, bookId, lang);
}

export function cancelPipeline(ctx: PipelineCtx, bookId: string, lang: string): void {
  const { db } = ctx;
  db.transaction(() => {
    const open = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.bookId, bookId),
          eq(jobs.targetLang, lang),
          inArray(jobs.status, ['queued', 'paused', 'awaiting_agent', 'failed']),
        ),
      )
      .all()
      .map((j) => j.id);
    if (open.length) {
      db.update(jobs)
        .set({ status: 'cancelled', finishedAt: new Date().toISOString() })
        .where(inArray(jobs.id, open))
        .run();
      db.update(agentBatches)
        .set({ status: 'cancelled' })
        .where(and(inArray(agentBatches.jobId, open), inArray(agentBatches.status, ['pending', 'leased'])))
        .run();
    }
    db.$client
      .prepare(
        `UPDATE translations SET status = 'pending'
          WHERE lang = ? AND status = 'queued' AND segment_id IN (SELECT id FROM segments WHERE book_id = ?)`,
      )
      .run(lang, bookId);
    updatePipelineState(db, bookId, lang, (s) => {
      s.cancelled = true;
      s.paused = false;
      s.translationPlanned = false;
      delete s.startedAt;
    });
    db.update(books)
      .set({ status: 'ready_to_translate', updatedAt: new Date().toISOString() })
      .where(eq(books.id, bookId))
      .run();
  });
  ctx.notify(bookId, { type: 'book', status: 'ready_to_translate' });
  ctx.notify(bookId, { type: 'agent', ...agentCounts(ctx, bookId) });
  logPipeline(ctx, bookId, lang, 'pipeline cancelled', 'warn');
}

/**
 * «ترجمه‌ی این بخش را الان انجام بده»: the section's chapter — up to and including the section, since chunks of a
 * chapter run in order — moves to the front of the queue (jobs and already written agent batches).
 */
export function prioritize(ctx: PipelineCtx, bookId: string, lang: string, nodeId: string): number {
  const { db } = ctx;
  const bundle = getBundle(db, bookId);
  if (!bundle) throw new PipelineError('BOOK_NOT_FOUND', 404);
  const index = createBookIndex(bundle);
  const chapterId = chapterOf(index, nodeId)?.id ?? nodeId;
  const list = pipelineJobs(db, bookId, lang).filter(
    (j) => (j.stage === 'translate' || j.stage === 'edit') && (scopeOf(j).chapterId ?? scopeOf(j).nodeId) === chapterId,
  );
  const own = list.filter((j) => scopeOf(j).nodeId === nodeId);
  const limit = own.length ? Math.max(...own.map((j) => j.seq)) : Number.POSITIVE_INFINITY;
  const targets = list.filter((j) => j.seq <= limit && j.status !== 'succeeded');
  db.transaction(() => {
    for (const j of targets) {
      const priority = taskPriority(j.stage as 'translate' | 'edit', true) + 100;
      db.update(jobs).set({ priority }).where(eq(jobs.id, j.id)).run();
      db.update(agentBatches)
        .set({ priority })
        .where(and(eq(agentBatches.jobId, j.id), inArray(agentBatches.status, ['pending', 'leased'])))
        .run();
    }
    updatePipelineState(db, bookId, lang, (s) => {
      if (!s.boosted.includes(nodeId)) s.boosted = [...s.boosted, nodeId];
    });
  });
  logPipeline(ctx, bookId, lang, `priority: ${targets.length} job(s) moved to the front`);
  advancePipeline(ctx, bookId, lang);
  return targets.length;
}

export function retryJob(ctx: PipelineCtx, jobId: string): JobRow {
  const job = ctx.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!job) throw new PipelineError('JOB_NOT_FOUND', 404);
  if (job.status !== 'failed') throw new PipelineError('JOB_NOT_FAILED');
  ctx.db
    .update(jobs)
    .set({ status: 'queued', error: null, attempts: 0, finishedAt: null })
    .where(eq(jobs.id, jobId))
    .run();
  if (job.targetLang) {
    logPipeline(ctx, job.bookId, job.targetLang, `${job.stage}: retry`);
    advancePipeline(ctx, job.bookId, job.targetLang);
  }
  return job;
}

export function estimatePipeline(
  ctx: PipelineCtx,
  bookId: string,
  lang: string,
  input: Partial<TranslationSettings> = {},
): PipelineEstimate {
  const row = getBookRow(ctx.db, bookId);
  const bundle = getBundle(ctx.db, bookId);
  if (!row || !bundle) throw new PipelineError('BOOK_NOT_FOUND', 404);
  const settings = TranslationSettingsSchema.parse({ ...translationSettings(row, lang), ...input });
  const plan = planTranslation(bundle, lang, settings);
  const skipped = new Set(bundle.nodes.filter((n) => n.skip).map((n) => n.id));
  const candidates = row.brief?.[lang]
    ? 0
    : extractCandidates(
        bundle.segments.filter((s) => needsTranslation(s) && !skipped.has(s.nodeId)).map((s) => s.src),
        bundle.book.sourceLang,
        { max: 160 },
      ).length;
  return {
    words: plan.words,
    segments: plan.segments,
    batches: {
      brief: row.brief?.[lang] ? 0 : 1,
      glossary: Math.ceil(candidates / 40),
      translate: plan.units.reduce((n, u) => n + u.chunks.length, 0),
      edit: plan.units.reduce((n, u) => n + u.edits.length, 0),
    },
  };
}

/** Snapshot for the pipeline dashboard. */
export function pipelineStatus(ctx: PipelineCtx, bookId: string, lang: string): PipelineStatus {
  const { db } = ctx;
  const row = getBookRow(db, bookId);
  const bundle = getBundle(db, bookId);
  if (!row || !bundle) throw new PipelineError('BOOK_NOT_FOUND', 404);
  const state = pipelineState(row, lang);
  const settings = translationSettings(row, lang);
  const list = pipelineJobs(db, bookId, lang);
  const count = (stage: string) => {
    const js = list.filter((j) => j.stage === stage && !scopeOf(j).rerun);
    return { done: js.filter((j) => j.status === 'succeeded').length, total: js.length };
  };
  const index = createBookIndex(bundle);
  const counter = translationCounter(index, lang);
  const status = (id: string) => index.translations.get(`${id}|${lang}`)?.status ?? 'pending';
  const skipped = new Set(bundle.nodes.filter((n) => n.skip).map((n) => n.id));
  const work = bundle.segments.filter((s) => needsTranslation(s) && !skipped.has(s.nodeId));
  const translated = work.filter((s) => !['pending', 'queued'].includes(status(s.id))).length;
  const edited = work.filter((s) => ['final', 'flagged', 'user_edited'].includes(status(s.id))).length;
  const flagged = work.filter((s) => status(s.id) === 'flagged').length;

  const chapters = index.nodes
    .filter((n) => n.depth === 0 && !n.skip)
    .map((n) => {
      const segs = work.filter((s) => (chapterOf(index, s.nodeId)?.id ?? topAncestor(index, s.nodeId)) === n.id);
      const seg = n.headingSegmentId ? index.segmentById.get(n.headingSegmentId) : undefined;
      const tgt = seg ? index.translations.get(`${seg.id}|${lang}`) : undefined;
      return {
        nodeId: n.id,
        title:
          tgt?.text && tgt.status !== 'queued'
            ? { src: seg?.src ?? n.title ?? '', tgt: tgt.text }
            : { src: seg?.src ?? n.title ?? '' },
        done: segs.filter((s) => ['final', 'user_edited'].includes(status(s.id))).length,
        total: segs.length,
        flagged: segs.filter((s) => status(s.id) === 'flagged').length,
      };
    })
    .filter((c) => c.total > 0);

  const batchRows = db.$client
    .prepare(
      `SELECT status, COUNT(*) AS n, SUM(CASE WHEN last_error IS NOT NULL AND status IN ('pending','leased') THEN 1 ELSE 0 END) AS rejected
         FROM agent_batches WHERE book_id = ? AND target_lang = ? GROUP BY status`,
    )
    .all(bookId, lang) as { status: string; n: number; rejected: number }[];
  const agent = {
    pending: batchRows.find((r) => r.status === 'pending')?.n ?? 0,
    leased: batchRows.find((r) => r.status === 'leased')?.n ?? 0,
    imported: batchRows.find((r) => r.status === 'imported')?.n ?? 0,
    rejected: batchRows.reduce((n, r) => n + (r.rejected ?? 0), 0),
  };

  const briefDone = Boolean(row.brief?.[lang]);
  const glossary = count('glossary');
  const translate = count('translate');
  const edit = count('edit');
  const glossaryDone = state.glossaryPlanned && glossary.done === glossary.total;
  let stage: PipelineStage = 'brief';
  if (state.finishedAt) stage = 'done';
  else if (!briefDone) stage = 'brief';
  else if (!glossaryDone) stage = 'glossary';
  else if (!state.glossaryApproved) stage = 'glossary_review';
  else if (translate.done < translate.total) stage = 'translate';
  else if (edit.done < edit.total) stage = 'edit';
  else stage = 'qa';

  const overall: PipelineStatus['state'] = state.cancelled
    ? 'cancelled'
    : state.paused
      ? 'paused'
      : state.finishedAt
        ? 'done'
        : !state.startedAt
          ? 'idle'
          : stage === 'glossary_review'
            ? 'waiting_glossary_review'
            : 'running';

  return {
    lang,
    state: overall,
    stage,
    settings,
    stages: {
      brief: { done: briefDone ? 1 : 0, total: 1 },
      glossary,
      translate: { done: translated, total: work.length },
      edit: settings.profile === 'economy' ? { done: 0, total: 0 } : { done: edited, total: work.length },
      qa: { done: counter.done, total: counter.total },
    },
    counter,
    flagged,
    chapters,
    agent,
    errors: list
      .filter((j) => j.status === 'failed')
      .map((j) => ({ jobId: j.id, stage: j.stage, error: j.error ?? '', attempts: j.attempts })),
    log: state.log.slice(-60),
    providers: ctx.providers?.status(PIPELINE_TASKS.map((t) => settings.engines[t]).filter(isProviderId)) ?? [],
  };
}

function topAncestor(index: ReturnType<typeof createBookIndex>, nodeId: string): string {
  let node = index.nodeById.get(nodeId);
  while (node?.parentId) node = index.nodeById.get(node.parentId);
  return node?.id ?? nodeId;
}

/** Marks queued translations of a book back to pending (used when a job is dropped). */
export function unqueue(ctx: PipelineCtx, lang: string, segmentIds: string[]): void {
  if (segmentIds.length === 0) return;
  ctx.db
    .update(translations)
    .set({ status: 'pending' })
    .where(
      and(
        eq(translations.lang, lang),
        inArray(translations.segmentId, segmentIds),
        sql`${translations.status} = 'queued'`,
      ),
    )
    .run();
}
