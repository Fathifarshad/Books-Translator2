import {
  API_PREFIX,
  CoverAiRequestSchema,
  type CoverAiStatus,
  PAINTER_ENGINES,
  type PainterTestResult,
  PainterUpdateSchema,
  type PainterView,
} from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBundle } from '../db/repo';
import { httpError } from './errors';

const LangQuery = z.object({ lang: z.string().min(2).max(12).optional() });
const TestBody = z.object({ engine: z.enum(PAINTER_ENGINES).exclude(['none']) });

/**
 * «طراحی خودکار جلد» (ADR-048, stage 2): the illustrator's settings (Cloudflare or ComfyUI), a round of AI designs
 * for a book, and drawing one option's picture again.
 */
export async function coverAiRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const book = (id: string, asked?: string) => {
    const bundle = getBundle(ctx.db, id);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    return asked ?? bundle.book.targetLangs[0] ?? bundle.book.sourceLang;
  };

  app.get(`${API_PREFIX}/settings/painter`, async (): Promise<PainterView> => ctx.painter.view());

  app.put(
    `${API_PREFIX}/settings/painter`,
    async (req): Promise<PainterView> => ctx.painter.update(PainterUpdateSchema.parse(req.body ?? {})),
  );

  app.post(
    `${API_PREFIX}/settings/painter/test`,
    async (req): Promise<PainterTestResult> => ctx.painter.test(TestBody.parse(req.body ?? {}).engine),
  );

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-ai`, async (req): Promise<CoverAiStatus> => {
    const lang = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
    return ctx.coverAi.status(req.params.id, lang);
  });

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-ai`, async (req): Promise<CoverAiStatus> => {
    const body = CoverAiRequestSchema.parse(req.body ?? {});
    const lang = book(req.params.id, body.lang);
    return ctx.coverAi.start(req.params.id, lang, { request: body.request, count: body.count }).status;
  });

  app.post<{ Params: { id: string; optionId: string } }>(
    `${API_PREFIX}/books/:id/cover-ai/:optionId/repaint`,
    async (req): Promise<CoverAiStatus> => {
      const lang = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
      return ctx.coverAi.repaint(req.params.id, lang, req.params.optionId).status;
    },
  );
}
