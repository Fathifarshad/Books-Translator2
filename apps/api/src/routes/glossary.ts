import { API_PREFIX, GlossaryKindSchema, ParentheticalSchema } from '@dozabaneh/shared';
import { postprocess } from '@dozabaneh/text';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBookRow, newId } from '../db/repo';
import { glossaryTerms } from '../db/schema';
import { pipelineCtx } from '../jobs/runner';
import { advancePipeline, approveGlossary } from '../pipeline/advance';
import { applyGlossaryTerm, ReviewError } from '../pipeline/review';
import { translationSettings } from '../pipeline/state';
import { httpError } from './errors';

const TermBody = z.object({
  lang: z.string().min(2).max(12),
  src: z.string().trim().min(1).max(200),
  tgt: z.string().trim().min(1).max(200),
  alternatives: z.array(z.string().trim().min(1)).max(10).default([]),
  definition: z.string().trim().max(1000).nullable().optional(),
  kind: GlossaryKindSchema.default('term'),
  parenthetical: ParentheticalSchema.default('first_in_chapter'),
  status: z.enum(['proposed', 'approved', 'locked']).default('approved'),
  notes: z.string().max(1000).nullable().optional(),
});
const PatchBody = TermBody.omit({ lang: true }).partial();
const ApproveBody = z.object({
  lang: z.string().min(2).max(12),
  /** Specific terms; without ids every proposed term is approved and translation can start. */
  ids: z.array(z.string()).optional(),
});

/** Book glossary (SPEC §13.4, §17). */
export async function glossaryRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { db } = ctx;
  const pctx = pipelineCtx(ctx);
  const bookOr404 = (id: string) => {
    const row = getBookRow(db, id);
    if (!row) throw httpError(404, 'BOOK_NOT_FOUND');
    return row;
  };
  const termOr404 = (bookId: string, termId: string) => {
    const term = db
      .select()
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.id, termId), eq(glossaryTerms.bookId, bookId)))
      .get();
    if (!term) throw httpError(404, 'TERM_NOT_FOUND');
    return term;
  };

  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>(
    `${API_PREFIX}/books/:id/glossary`,
    async (req) => {
      const row = bookOr404(req.params.id);
      const terms = db
        .select()
        .from(glossaryTerms)
        .where(
          and(eq(glossaryTerms.bookId, row.id), ...(req.query.lang ? [eq(glossaryTerms.tgtLang, req.query.lang)] : [])),
        )
        .all()
        .sort((a, b) => b.occurrences - a.occurrences || a.src.localeCompare(b.src));
      return { terms };
    },
  );

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/glossary`, async (req, reply) => {
    const row = bookOr404(req.params.id);
    const body = TermBody.parse(req.body);
    const settings = translationSettings(row, body.lang);
    const dup = db
      .select({ id: glossaryTerms.id, src: glossaryTerms.src })
      .from(glossaryTerms)
      .where(and(eq(glossaryTerms.bookId, row.id), eq(glossaryTerms.tgtLang, body.lang)))
      .all()
      .find((t) => t.src.toLowerCase() === body.src.toLowerCase());
    if (dup) throw httpError(409, 'TERM_EXISTS', { termId: dup.id });
    const id = newId('gt');
    db.insert(glossaryTerms)
      .values({
        id,
        bookId: row.id,
        srcLang: row.sourceLang,
        tgtLang: body.lang,
        src: body.src,
        tgt: postprocess(body.tgt, body.lang, { ezafe: settings.ezafe, digits: settings.digits }),
        alternatives: body.alternatives,
        definition: body.definition ?? null,
        kind: body.kind,
        parenthetical: body.parenthetical,
        status: body.status,
        notes: body.notes ?? null,
      })
      .run();
    pctx.notify(row.id, { type: 'glossary', lang: body.lang });
    reply.status(201);
    return { term: termOr404(row.id, id) };
  });

  app.patch<{ Params: { id: string; termId: string } }>(`${API_PREFIX}/books/:id/glossary/:termId`, async (req) => {
    const row = bookOr404(req.params.id);
    const term = termOr404(row.id, req.params.termId);
    const body = PatchBody.parse(req.body);
    const settings = translationSettings(row, term.tgtLang);
    db.update(glossaryTerms)
      .set({
        ...(body.src !== undefined ? { src: body.src } : {}),
        ...(body.tgt !== undefined
          ? { tgt: postprocess(body.tgt, term.tgtLang, { ezafe: settings.ezafe, digits: settings.digits }) }
          : {}),
        ...(body.alternatives !== undefined ? { alternatives: body.alternatives } : {}),
        ...(body.definition !== undefined ? { definition: body.definition } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.parenthetical !== undefined ? { parenthetical: body.parenthetical } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      })
      .where(eq(glossaryTerms.id, term.id))
      .run();
    pctx.notify(row.id, { type: 'glossary', lang: term.tgtLang });
    return { term: termOr404(row.id, term.id), changedEquivalent: body.tgt !== undefined && body.tgt !== term.tgt };
  });

  app.delete<{ Params: { id: string; termId: string } }>(
    `${API_PREFIX}/books/:id/glossary/:termId`,
    async (req, reply) => {
      const row = bookOr404(req.params.id);
      const term = termOr404(row.id, req.params.termId);
      db.delete(glossaryTerms).where(eq(glossaryTerms.id, term.id)).run();
      pctx.notify(row.id, { type: 'glossary', lang: term.tgtLang });
      reply.status(204);
    },
  );

  /** Approve selected terms, or all proposed terms — which also lets translation start (wizard step 5). */
  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/glossary/approve`, async (req) => {
    const row = bookOr404(req.params.id);
    const body = ApproveBody.parse(req.body ?? {});
    if (body.ids) {
      const known = db
        .select({ id: glossaryTerms.id })
        .from(glossaryTerms)
        .where(and(eq(glossaryTerms.bookId, row.id), inArray(glossaryTerms.id, body.ids)))
        .all().length;
      if (known !== body.ids.length) throw httpError(404, 'TERM_NOT_FOUND');
    }
    const approved = approveGlossary(pctx, row.id, body.lang, body.ids);
    if (!body.ids) advancePipeline(pctx, row.id, body.lang);
    ctx.runner.kick();
    return { approved };
  });

  /** «اعمال در متن ترجمه‌شده»: targeted edit jobs for the segments that contain the term. */
  app.post<{ Params: { id: string; termId: string } }>(
    `${API_PREFIX}/books/:id/glossary/:termId/apply`,
    async (req) => {
      const row = bookOr404(req.params.id);
      try {
        const segments = applyGlossaryTerm(pctx, row.id, req.params.termId);
        ctx.runner.kick();
        return { segments };
      } catch (err) {
        if (err instanceof ReviewError) throw httpError(err.status, err.code);
        throw err;
      }
    },
  );
}
