import { API_PREFIX } from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBundle } from '../db/repo';
import { bookDocument } from '../export/document';
import { bookErrata, errataCsv, errataDocx, errataMarkdown } from '../export/errata';
import { toMarkdown } from '../export/markdown';
import { buildOfflineHtml } from '../export/offline';
import { buildPrintHtml } from '../export/print';
import { toDocx } from '../export/word';
import { httpError } from './errors';

const Query = z.object({
  lang: z.string().min(2).max(12).optional(),
  /** Which columns the file carries: the translation, both languages, or the original. */
  mode: z.enum(['target', 'bilingual', 'source']).default('target'),
});

const ErrataQuery = z.object({ format: z.enum(['word', 'csv', 'markdown']).default('word') });

/**
 * A file name that is safe on Windows and Android. Latin letters only: browsers (Chromium) drop non-Latin
 * `filename*` names and save the file as «download», so the source-language title is used, else the book id.
 */
export function exportFileName(title: string, fallback: string, extension = 'html'): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${cleaned.length >= 3 ? cleaned : fallback}.${extension}`;
}

/**
 * Exports (SPEC §13.8): the offline reader for phones, and «گرفتن خروجی» once a book is translated — Markdown,
 * Word, and a printable page that the browser saves as a PDF. Every format is rendered from the one model in
 * `export/document.ts`, so they can never drift apart.
 */
export async function exportRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  /** The book, the chosen target language and the mode — or 404. */
  const read = (id: string, query: unknown) => {
    const bundle = getBundle(ctx.db, id);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    const { lang: asked, mode } = Query.parse(query ?? {});
    const lang = asked ?? bundle.book.targetLangs[0] ?? (bundle.book.sourceLang === 'fa' ? 'en' : 'fa');
    const name = (extension: string) =>
      exportFileName(bundle.book.titles[bundle.book.sourceLang] ?? '', `dozabaneh-${bundle.book.id}`, extension);
    return { bundle, lang, mode, name };
  };

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/export/offline`, async (req, reply) => {
    const { bundle, lang, name } = read(req.params.id, req.query);
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${name('html')}"`)
      .header('Cache-Control', 'no-store')
      .send(buildOfflineHtml(bundle, lang));
  });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/export/markdown`, async (req, reply) => {
    const { bundle, lang, mode, name } = read(req.params.id, req.query);
    return reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${name('md')}"`)
      .header('Cache-Control', 'no-store')
      .send(toMarkdown(bookDocument(bundle, lang), mode));
  });

  /** The same Markdown, for «رونوشت» in the browser: shown, not downloaded. */
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/export/markdown.txt`, async (req, reply) => {
    const { bundle, lang, mode } = read(req.params.id, req.query);
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(toMarkdown(bookDocument(bundle, lang), mode));
  });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/export/word`, async (req, reply) => {
    const { bundle, lang, mode, name } = read(req.params.id, req.query);
    const file = await toDocx(bookDocument(bundle, lang), mode);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${name('docx')}"`)
      .header('Cache-Control', 'no-store')
      .send(file);
  });

  /** «فایل سوتی» (ADR-045): every correction of the edit pass — Word table, CSV for Excel, or Markdown. */
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/export/errata`, async (req, reply) => {
    const { bundle, lang } = read(req.params.id, req.query);
    const { format } = ErrataQuery.parse(req.query ?? {});
    const errata = bookErrata(ctx.db, bundle, lang);
    const title = bundle.book.titles[lang] ?? bundle.book.titles[bundle.book.sourceLang] ?? '';
    const base = exportFileName(bundle.book.titles[bundle.book.sourceLang] ?? '', `dozabaneh-${bundle.book.id}`, 'x');
    const file = (extension: string) => `${base.slice(0, -2)}-errata.${extension}`;
    reply.header('Cache-Control', 'no-store');
    if (format === 'csv') {
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${file('csv')}"`)
        .send(errataCsv(errata, lang));
    }
    if (format === 'markdown') {
      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${file('md')}"`)
        .send(errataMarkdown(errata, title, lang));
    }
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${file('docx')}"`)
      .send(await errataDocx(errata, title, lang));
  });

  /** Opened in a tab, not downloaded: the browser's print dialog saves it as a PDF, with Persian shaped right. */
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/export/print`, async (req, reply) => {
    const { bundle, lang, mode } = read(req.params.id, req.query);
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(buildPrintHtml(bookDocument(bundle, lang), mode));
  });
}
