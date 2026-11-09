import { createReadStream, readFileSync } from 'node:fs';
import { COVER_STYLE, coverMarkup } from '@dozabaneh/cover';
import {
  API_PREFIX,
  BOOK_PAGE_MM,
  BookPdfRequestSchema,
  type BookPdfStatus,
  COVER_THEMES,
  PreparerSchema,
} from '@dozabaneh/shared';
import { getLanguage } from '@dozabaneh/text';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBundle } from '../db/repo';
import { COVER_TYPES, coverFile, outputFile, removeCover, saveCover, saveOptions } from '../export/book/build';
import { COVER_CSS, type CoverContent, generatedCover, imageCover, THEMES } from '../export/book/cover';
import { coverDesign } from '../export/book/cover-design';
import { bookPdfStatus } from '../export/book/status';
import { embeddedFonts } from '../export/offline';
import { bookStrings, fill } from '../export/strings';
import { coverFontFamily, fontFaceCss } from '../fonts/registry';
import { enqueue } from '../jobs/queue';
import { httpError } from './errors';
import { exportFileName } from './export';

const LangQuery = z.object({ lang: z.string().min(2).max(12).optional() });

const PreviewQuery = PreparerSchema.extend({
  theme: z.enum(COVER_THEMES).default('navy'),
  cover: z.enum(['designed', 'generated', 'uploaded']).default('generated'),
  coverText: z.enum(['0', '1']).default('1'),
  lang: z.string().min(2).max(12).optional(),
});

const MAX_COVER_MB = 15;

/**
 * «کتاب PDF» (ADR-046): start a build, follow it, download the book; upload the owner's cover image; and a live
 * preview of the cover as the options change. The build itself is a job (`book_pdf`) in the shared queue.
 */
export async function bookPdfRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const deps = () => ({ db: ctx.db, config: ctx.config });
  const book = (id: string, asked?: string) => {
    const bundle = getBundle(ctx.db, id);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    const lang = asked ?? bundle.book.targetLangs[0] ?? bundle.book.sourceLang;
    return { bundle, lang };
  };

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/book-pdf`, async (req): Promise<BookPdfStatus> => {
    const { lang } = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
    return bookPdfStatus(deps(), req.params.id, lang);
  });

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/book-pdf`, async (req): Promise<BookPdfStatus> => {
    const { lang: asked, ...options } = BookPdfRequestSchema.parse(req.body ?? {});
    const { lang } = book(req.params.id, asked);
    const current = bookPdfStatus(deps(), req.params.id, lang);
    if (current.state === 'running') return current;
    saveOptions(ctx.db, req.params.id, options);
    enqueue(ctx.db, {
      bookId: req.params.id,
      stage: 'book_pdf',
      targetLang: lang,
      // Asked for and waited on: ahead of the translation jobs a book may have queued.
      priority: 100,
      scope: { options },
    });
    ctx.runner.kick();
    return bookPdfStatus(deps(), req.params.id, lang, options);
  });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/book-pdf/file`, async (req, reply) => {
    const { bundle, lang } = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
    const status = bookPdfStatus(deps(), req.params.id, lang);
    if (!status.file) throw httpError(404, 'BOOK_PDF_NOT_BUILT');
    const name = exportFileName(bundle.book.titles[bundle.book.sourceLang] ?? '', `dozabaneh-${bundle.book.id}`, 'pdf');
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('Content-Length', String(status.file.bytes))
      .header('Cache-Control', 'no-store')
      .send(createReadStream(outputFile(ctx.config, req.params.id, lang)));
  });

  /** The owner's own cover image (JPG, PNG or WebP). */
  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover`, async (req): Promise<BookPdfStatus> => {
    const { lang } = book(req.params.id);
    const file = await req.file({ limits: { fileSize: MAX_COVER_MB * 1024 * 1024, files: 1 } });
    if (!file) throw httpError(400, 'NO_FILE');
    if (!COVER_TYPES[file.mimetype]) throw httpError(415, 'NOT_AN_IMAGE');
    const data = await file.toBuffer();
    if (file.file.truncated) throw httpError(413, 'FILE_TOO_LARGE');
    if (!looksLikeImage(data)) throw httpError(415, 'NOT_AN_IMAGE');
    saveCover(ctx.config, req.params.id, data, file.mimetype);
    return bookPdfStatus(deps(), req.params.id, lang);
  });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover`, async (req, reply) => {
    book(req.params.id);
    const file = coverFile(ctx.config, req.params.id);
    if (!file) throw httpError(404, 'NO_COVER');
    const ext = file.split('.').pop() ?? '';
    const mime = Object.entries(COVER_TYPES).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
    return reply.header('Content-Type', mime).header('Cache-Control', 'no-store').send(readFileSync(file));
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover`, async (req): Promise<BookPdfStatus> => {
    const { lang } = book(req.params.id);
    removeCover(ctx.config, req.params.id);
    return bookPdfStatus(deps(), req.params.id, lang);
  });

  /** The cover alone, as it will be printed, for the page's live preview. */
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/book-pdf/cover-preview`, async (req, reply) => {
    const q = PreviewQuery.parse(req.query ?? {});
    const { bundle, lang } = book(req.params.id, q.lang);
    const strings = bookStrings();
    const src = bundle.book.sourceLang;
    const content: CoverContent = {
      title: bundle.book.titles[lang] ?? bundle.book.titles[src] ?? '',
      titleSrc: bundle.book.titles[src] ?? '',
      srcDir: getLanguage(src).dir,
      srcLang: src,
      authors: bundle.book.authors.length ? fill(strings.by, { authors: bundle.book.authors.join('، ') }) : '',
      preparer: { role: q.role || strings.defaultRole, name: q.name, title: q.title },
    };
    const uploaded = q.cover === 'uploaded' && coverFile(ctx.config, req.params.id);
    let designedCss = '';
    let section: string;
    if (q.cover === 'designed') {
      // The studio's design, with its fonts and images loaded from this server.
      const { design } = coverDesign(deps(), req.params.id, lang);
      designedCss =
        fontFaceCss(
          ctx.fonts.all(),
          (font, face) => `${API_PREFIX}/fonts/${font.id}/${encodeURIComponent(face.name)}`,
        ) + COVER_STYLE;
      section = `<section class="cover">${coverMarkup(design, {
        imageUrl: (id) => `${API_PREFIX}/books/${req.params.id}/cover-images/${id}`,
        fontFamily: coverFontFamily,
      })}</section>`;
    } else {
      section = uploaded
        ? imageCover(`${API_PREFIX}/books/${req.params.id}/cover`, content, q.coverText === '1', strings.defaultRole)
        : generatedCover(content, THEMES[q.theme], strings.defaultRole);
    }
    const a4 = BOOK_PAGE_MM.a4;
    // The cover at its printed size (A4), scaled to whatever frame shows it.
    const html = `<!doctype html><html lang="${lang}" dir="${getLanguage(lang).dir}"><head><meta charset="utf-8">
<style>${embeddedFonts()}:root{--f-head:"Vazirmatn Offline",sans-serif;--f-latin:"Vazirmatn Offline",sans-serif;--page-w:${a4.width}mm;--page-h:${a4.height}mm}
html,body{margin:0;overflow:hidden;font-family:"Vazirmatn Offline",sans-serif;background:#fff}${COVER_CSS}${designedCss}</style>
</head><body>${section}<script>function fit(){document.body.style.zoom=String(innerWidth/(${a4.width}*96/25.4))}fit();addEventListener('resize',fit)</script></body></html>`;
    return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });
}

/** JPEG, PNG or WebP by their first bytes — the declared type alone is not trusted. */
function looksLikeImage(data: Buffer): boolean {
  if (data.length < 12) return false;
  const jpeg = data[0] === 0xff && data[1] === 0xd8;
  const png = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
  return jpeg || png || webp;
}
