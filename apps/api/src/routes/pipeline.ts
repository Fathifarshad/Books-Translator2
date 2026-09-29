import { API_PREFIX, TranslationSettingsSchema } from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBookRow } from '../db/repo';
import { pipelineCtx } from '../jobs/runner';
import { agentStatus } from '../pipeline/agent';
import {
  cancelPipeline,
  estimatePipeline,
  PipelineError,
  pausePipeline,
  pipelineStatus,
  prioritize,
  resumePipeline,
  retryJob,
  startPipeline,
} from '../pipeline/control';
import { httpError } from './errors';

const LangBody = z.object({ lang: z.string().min(2).max(12) });
const StartBody = LangBody.extend({ settings: TranslationSettingsSchema.partial().default({}) });
const PriorityBody = z.object({ nodeId: z.string().min(1), lang: z.string().min(2).max(12).optional() });

/** Pipeline control and dashboard data (SPEC §13.3, §17). */
export async function pipelineRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const pctx = pipelineCtx(ctx);
  const guard = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof PipelineError) throw httpError(err.status, err.code, err.details);
      throw err;
    }
  };
  const langOf = (bookId: string, lang?: string) => {
    const row = getBookRow(ctx.db, bookId);
    if (!row) throw httpError(404, 'BOOK_NOT_FOUND');
    const targets = Object.keys((row.settings as { translation?: Record<string, unknown> }).translation ?? {});
    return lang ?? targets[0] ?? (row.sourceLang === 'fa' ? 'en' : 'fa');
  };

  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>(
    `${API_PREFIX}/books/:id/pipeline`,
    async (req) => {
      const lang = langOf(req.params.id, req.query.lang);
      return guard(() => pipelineStatus(pctx, req.params.id, lang));
    },
  );

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/pipeline/estimate`, async (req) => {
    const body = StartBody.parse(req.body ?? {});
    return guard(() => estimatePipeline(pctx, req.params.id, body.lang, body.settings));
  });

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/pipeline/start`, async (req) => {
    const body = StartBody.parse(req.body ?? {});
    guard(() => startPipeline(pctx, req.params.id, body.lang, body.settings));
    ctx.runner.kick();
    return guard(() => pipelineStatus(pctx, req.params.id, body.lang));
  });

  for (const [action, fn] of [
    ['pause', pausePipeline],
    ['resume', resumePipeline],
    ['cancel', cancelPipeline],
  ] as const) {
    app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/pipeline/${action}`, async (req) => {
      const { lang } = LangBody.parse(req.body ?? {});
      guard(() => fn(pctx, req.params.id, lang));
      ctx.runner.kick();
      return guard(() => pipelineStatus(pctx, req.params.id, lang));
    });
  }

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/priority`, async (req) => {
    const body = PriorityBody.parse(req.body ?? {});
    const lang = langOf(req.params.id, body.lang);
    const moved = guard(() => prioritize(pctx, req.params.id, lang, body.nodeId));
    ctx.runner.kick();
    return { moved };
  });

  app.post<{ Params: { id: string; jobId: string } }>(`${API_PREFIX}/books/:id/jobs/:jobId/retry`, async (req) => {
    const job = guard(() => retryJob(pctx, req.params.jobId));
    if (job.bookId !== req.params.id) throw httpError(404, 'JOB_NOT_FOUND');
    ctx.runner.kick();
    return { ok: true };
  });

  /** Open agent batches (for the «… بسته در انتظار Claude Code» hint). */
  app.get(`${API_PREFIX}/agent/status`, async () => agentStatus(pctx));
}
