import { API_PREFIX } from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBundle } from '../db/repo';
import { buildOfflineHtml } from '../export/offline';
import { httpError } from './errors';

const Query = z.object({ lang: z.string().min(2).max(12).optional() });

/**
 * A file name that is safe on Windows and Android. Latin letters only: browsers (Chromium) drop non-Latin
 * `filename*` names and save the file as «download», so the source-language title is used, else the book id.
 */
export function exportFileName(title: string, fallback: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${cleaned.length >= 3 ? cleaned : fallback}.html`;
}

/** Exports (SPEC §13.8): the offline reader for phones. */
export async function exportRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/export/offline`, async (req, reply) => {
    const bundle = getBundle(ctx.db, req.params.id);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    const { lang: asked } = Query.parse(req.query ?? {});
    const lang = asked ?? bundle.book.targetLangs[0] ?? (bundle.book.sourceLang === 'fa' ? 'en' : 'fa');
    const html = buildOfflineHtml(bundle, lang);
    const name = exportFileName(bundle.book.titles[bundle.book.sourceLang] ?? '', `dozabaneh-${bundle.book.id}`);
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('Cache-Control', 'no-store')
      .send(html);
  });
}
