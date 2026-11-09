import { createReadStream } from 'node:fs';
import {
  API_PREFIX,
  CoverDesignSaveSchema,
  type CoverDesignView,
  type CoverFont,
  CoverIdSchema,
  type CoverImage,
  type CoverTemplate,
  CoverTemplateCreateSchema,
} from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBundle } from '../db/repo';
import { COVER_TYPES } from '../export/book/build';
import {
  addImage,
  addTemplate,
  coverDesign,
  imageFile,
  listImages,
  listTemplates,
  removeImage,
  removeTemplate,
  resetCoverDesign,
  saveCoverDesign,
} from '../export/book/cover-design';
import { fontFaceCss, fontMime } from '../fonts/registry';
import { httpError } from './errors';

const LangQuery = z.object({ lang: z.string().min(2).max(12).optional() });
const FontParams = z.object({ id: CoverIdSchema, file: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,120}$/) });
const MAX_IMAGE_MB = 20;

/**
 * «استودیوی جلد» (ADR-048): the fonts a cover can use (list, `@font-face` rules, files), the book's design per
 * language, its cover images, and templates kept for later books.
 */
export async function coverStudioRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const deps = () => ({ db: ctx.db, config: ctx.config });
  const book = (id: string, asked?: string) => {
    const bundle = getBundle(ctx.db, id);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    return { bundle, lang: asked ?? bundle.book.targetLangs[0] ?? bundle.book.sourceLang };
  };

  // ── Fonts ─────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get(`${API_PREFIX}/fonts`, async (req): Promise<CoverFont[]> => {
    if ((req.query as { refresh?: string } | undefined)?.refresh === '1') ctx.fonts.refresh();
    return ctx.fonts.list();
  });

  app.get(`${API_PREFIX}/fonts.css`, async (_req, reply) => {
    const css = fontFaceCss(
      ctx.fonts.all(),
      (font, face) => `${API_PREFIX}/fonts/${font.id}/${encodeURIComponent(face.name)}`,
    );
    return reply.header('Content-Type', 'text/css; charset=utf-8').header('Cache-Control', 'no-cache').send(css);
  });

  app.get(`${API_PREFIX}/fonts/:id/:file`, async (req, reply) => {
    const p = FontParams.safeParse(req.params);
    const face = p.success ? ctx.fonts.face(p.data.id, p.data.file) : undefined;
    if (!face) throw httpError(404, 'FONT_NOT_FOUND');
    return reply
      .header('Content-Type', fontMime(face))
      .header('Cache-Control', 'public, max-age=86400')
      .send(createReadStream(face.file));
  });

  // ── The design ────────────────────────────────────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-design`, async (req): Promise<CoverDesignView> => {
    const { lang } = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
    return coverDesign(deps(), req.params.id, lang);
  });

  app.put<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-design`, async (req): Promise<CoverDesignView> => {
    const body = CoverDesignSaveSchema.parse(req.body ?? {});
    const { lang } = book(req.params.id, body.lang);
    return saveCoverDesign(deps(), req.params.id, lang, body.design);
  });

  app.delete<{ Params: { id: string } }>(
    `${API_PREFIX}/books/:id/cover-design`,
    async (req): Promise<CoverDesignView> => {
      const { lang } = book(req.params.id, LangQuery.parse(req.query ?? {}).lang);
      return resetCoverDesign(deps(), req.params.id, lang);
    },
  );

  // ── Images ────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-images`, async (req): Promise<CoverImage[]> => {
    book(req.params.id);
    return listImages(ctx.config, req.params.id);
  });

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/cover-images`, async (req): Promise<CoverImage> => {
    book(req.params.id);
    const file = await req.file({ limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024, files: 1 } });
    if (!file) throw httpError(400, 'NO_FILE');
    if (!COVER_TYPES[file.mimetype]) throw httpError(415, 'NOT_AN_IMAGE');
    const data = await file.toBuffer();
    if (file.file.truncated) throw httpError(413, 'FILE_TOO_LARGE');
    if (imageType(data) !== file.mimetype) throw httpError(415, 'NOT_AN_IMAGE');
    return addImage(ctx.config, req.params.id, data, file.mimetype, { source: 'upload' });
  });

  app.get<{ Params: { id: string; imageId: string } }>(
    `${API_PREFIX}/books/:id/cover-images/:imageId`,
    async (req, reply) => {
      book(req.params.id);
      const img = CoverIdSchema.safeParse(req.params.imageId).success
        ? imageFile(ctx.config, req.params.id, req.params.imageId)
        : undefined;
      if (!img) throw httpError(404, 'IMAGE_NOT_FOUND');
      return reply
        .header('Content-Type', img.mime)
        .header('Cache-Control', 'public, max-age=86400')
        .send(createReadStream(img.file));
    },
  );

  app.delete<{ Params: { id: string; imageId: string } }>(
    `${API_PREFIX}/books/:id/cover-images/:imageId`,
    async (req): Promise<CoverImage[]> => {
      const { bundle } = book(req.params.id);
      // An image the saved cover of any language shows stays until the design lets it go.
      for (const lang of [bundle.book.sourceLang, ...bundle.book.targetLangs]) {
        const view = coverDesign(deps(), req.params.id, lang);
        if (view.saved && view.design.background.image === req.params.imageId) throw httpError(409, 'IMAGE_IN_USE');
      }
      if (!removeImage(ctx.config, req.params.id, req.params.imageId)) throw httpError(404, 'IMAGE_NOT_FOUND');
      return listImages(ctx.config, req.params.id);
    },
  );

  // ── Templates ─────────────────────────────────────────────────────────────────────────────────────────────────
  app.get(`${API_PREFIX}/cover-templates`, async (): Promise<CoverTemplate[]> => listTemplates(ctx.db));

  app.post(`${API_PREFIX}/cover-templates`, async (req): Promise<CoverTemplate[]> => {
    const body = CoverTemplateCreateSchema.parse(req.body ?? {});
    // Images belong to one book: a template keeps the ground's colours, not its picture.
    const design = body.design.background.image
      ? { ...body.design, background: { ...body.design.background, kind: 'gradient' as const, image: null } }
      : body.design;
    addTemplate(ctx.db, body.name, design);
    return listTemplates(ctx.db);
  });

  app.delete<{ Params: { tid: string } }>(
    `${API_PREFIX}/cover-templates/:tid`,
    async (req): Promise<CoverTemplate[]> => {
      if (!removeTemplate(ctx.db, req.params.tid)) throw httpError(404, 'TEMPLATE_NOT_FOUND');
      return listTemplates(ctx.db);
    },
  );
}

/** JPEG, PNG or WebP by the first bytes — the declared type alone is not trusted. */
export function imageType(data: Buffer): string | undefined {
  if (data.length < 12) return undefined;
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}
