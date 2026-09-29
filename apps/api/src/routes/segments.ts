import { API_PREFIX } from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBookRow } from '../db/repo';
import { pipelineCtx } from '../jobs/runner';
import { editTranslation, ReviewError, reviewAction, reviewQueue, revisionsOf } from '../pipeline/review';
import { httpError } from './errors';

const EditBody = z.object({
  lang: z.string().min(2).max(12),
  text: z.string().max(20_000),
  /** "edit", "undo" or the user's own short note, stored with the revision. */
  reason: z.string().trim().min(1).max(200).default('edit'),
});
const ReviewBody = z.object({
  lang: z.string().min(2).max(12),
  action: z.enum(['approve', 'reject', 'rerun', 'accept_suggestion', 'dismiss_suggestion']),
});

/** Manual editing with history and the review queue (SPEC §9.8, §13.5, §17). */
export async function segmentRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const pctx = pipelineCtx(ctx);
  const guard = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof ReviewError) throw httpError(err.status, err.code);
      throw err;
    }
  };

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/segments/:id/translation`, async (req) => {
    const body = EditBody.parse(req.body);
    return { translation: guard(() => editTranslation(pctx, req.params.id, body.lang, body.text, body.reason)) };
  });

  app.get<{ Params: { id: string }; Querystring: { lang: string } }>(
    `${API_PREFIX}/segments/:id/revisions`,
    async (req) => {
      const lang = z.string().min(2).parse(req.query.lang);
      return { revisions: revisionsOf(pctx, req.params.id, lang) };
    },
  );

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/segments/:id/review`, async (req) => {
    const body = ReviewBody.parse(req.body);
    const translation = guard(() => reviewAction(pctx, req.params.id, body.lang, body.action));
    if (body.action === 'rerun') ctx.runner.kick();
    return { translation };
  });

  app.get<{ Params: { id: string }; Querystring: { lang?: string; filter?: string } }>(
    `${API_PREFIX}/books/:id/review`,
    async (req) => {
      const row = getBookRow(ctx.db, req.params.id);
      if (!row) throw httpError(404, 'BOOK_NOT_FOUND');
      const lang =
        req.query.lang ?? Object.keys((row.settings as { translation?: object }).translation ?? {})[0] ?? 'fa';
      const filter = req.query.filter === 'all' ? 'all' : 'flagged';
      return { lang, items: guard(() => reviewQueue(pctx, row.id, lang, filter)) };
    },
  );
}
