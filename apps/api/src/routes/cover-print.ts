import { createReadStream } from 'node:fs';
import {
  API_PREFIX,
  CoverBlurbRequestSchema,
  type CoverBlurbResult,
  CoverPrintSaveSchema,
  type CoverPrintView,
} from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBundle } from '../db/repo';
import {
  buildSheet,
  coverPrintView,
  PagesUnknownError,
  printWrapPdf,
  saveCoverPrint,
  writeBlurb,
} from '../export/book/cover-print';
import { BrowserNotFoundError } from '../export/book/print';
import { httpError } from './errors';
import { exportFileName } from './export';

const LangQuery = z.object({ lang: z.string().min(2).max(12).optional() });

/**
 * The printer's cover (ADR-048, stage 3): settings and the back's design, the AI blurb, a preview of the whole
 * sheet, and the one-sheet PDF (back, spine, front with bleed and optional crop marks).
 */
export async function coverPrintRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const deps = () => ({ db: ctx.db, config: ctx.config });
  const book = (id: string, asked?: string) => {
    const bundle = getBundle(ctx.db, id);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    return { bundle, lang: asked ?? bundle.book.targetLangs[0] ?? bundle.book.sourceLang };
  };

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-print`, async (req): Promise<CoverPrintView> => {
    const { lang } = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
    return coverPrintView(deps(), req.params.id, lang);
  });

  app.put<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-print`, async (req): Promise<CoverPrintView> => {
    const body = CoverPrintSaveSchema.parse(req.body ?? {});
    const { lang } = book(req.params.id, body.lang);
    return saveCoverPrint(deps(), req.params.id, lang, body.print, body.back);
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/books/:id/cover-print/blurb`,
    async (req): Promise<CoverBlurbResult> => {
      const body = CoverBlurbRequestSchema.parse(req.body ?? {});
      const { lang } = book(req.params.id, body.lang);
      return writeBlurb({ ...deps(), providers: ctx.providers }, req.params.id, lang, body.request ?? '');
    },
  );

  /** The whole sheet as it will print, scaled to the frame that shows it. */
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-print/preview`, async (req, reply) => {
    const { lang } = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
    try {
      const sheet = buildSheet(deps(), ctx.fonts, req.params.id, lang, { kind: 'preview', apiPrefix: API_PREFIX });
      return reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .header('Cache-Control', 'no-store')
        .send(sheet.html);
    } catch (err) {
      if (err instanceof PagesUnknownError) throw httpError(409, 'PAGES_UNKNOWN');
      throw err;
    }
  });

  /** Prints the sheet (a few seconds) and sends the PDF. */
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-print/pdf`, async (req, reply) => {
    const { bundle, lang } = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
    try {
      const { file } = await printWrapPdf(deps(), ctx.fonts, req.params.id, lang);
      const name = exportFileName(
        `${bundle.book.titles[bundle.book.sourceLang] ?? ''}-cover`,
        `dozabaneh-${bundle.book.id}-cover`,
        'pdf',
      );
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${name}"`)
        .header('Cache-Control', 'no-store')
        .send(createReadStream(file));
    } catch (err) {
      if (err instanceof PagesUnknownError) throw httpError(409, 'PAGES_UNKNOWN');
      if (err instanceof BrowserNotFoundError) throw httpError(503, 'BROWSER_NOT_FOUND');
      throw err;
    }
  });
}
