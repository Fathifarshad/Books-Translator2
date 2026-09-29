import {
  applyStructureOp,
  buildSection,
  buildToc,
  createBookIndex,
  StructureError,
  type StructureOp,
} from '@dozabaneh/core';
import { API_PREFIX } from '@dozabaneh/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBookRow, getBundle, loadStructure, newId, saveStructure } from '../db/repo';
import { books } from '../db/schema';
import { httpError } from './errors';

const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), nodeId: z.string(), title: z.string().min(1).max(500) }),
  z.object({ op: z.literal('skip'), nodeId: z.string(), skip: z.boolean() }),
  z.object({ op: z.literal('promote'), nodeId: z.string() }),
  z.object({ op: z.literal('demote'), nodeId: z.string() }),
  z.object({ op: z.literal('merge'), nodeId: z.string(), with: z.enum(['prev', 'next']) }),
  z.object({ op: z.literal('split'), nodeId: z.string(), segmentId: z.string() }),
  z.object({ op: z.literal('confirm') }),
]);

/** TOC, section payloads and structure review (SPEC §8.8, §17). */
export async function structureRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { db, bus } = ctx;

  const indexOf = (bookId: string) => {
    const bundle = getBundle(db, bookId);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    return createBookIndex(bundle);
  };

  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>(`${API_PREFIX}/books/:id/toc`, async (req) => {
    const index = indexOf(req.params.id);
    const lang = req.query.lang ?? index.book.targetLangs[0] ?? 'fa';
    return { toc: buildToc(index, lang) };
  });

  app.get<{ Params: { id: string; nodeId: string }; Querystring: { lang?: string } }>(
    `${API_PREFIX}/books/:id/nodes/:nodeId`,
    async (req) => {
      const index = indexOf(req.params.id);
      const lang = req.query.lang ?? index.book.targetLangs[0] ?? 'fa';
      const section = buildSection(index, req.params.nodeId, lang);
      if (!section) throw httpError(404, 'NODE_NOT_FOUND');
      return section;
    },
  );

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/structure`, async (req) => {
    const row = getBookRow(db, req.params.id);
    if (!row) throw httpError(404, 'BOOK_NOT_FOUND');
    const body = OpSchema.parse(req.body);
    if (body.op === 'confirm') {
      // Confirming the structure unlocks translation (Phase 3).
      if (row.status === 'structure_review') {
        db.update(books)
          .set({ status: 'ready_to_translate', updatedAt: new Date().toISOString() })
          .where(eq(books.id, row.id))
          .run();
        bus.publish(row.id, { type: 'book', status: 'ready_to_translate' });
      }
      return { status: getBookRow(db, row.id)?.status };
    }
    const op: StructureOp = body.op === 'split' ? { ...body, newNodeId: newId('nd') } : body;
    try {
      saveStructure(db, row.id, applyStructureOp(loadStructure(db, row.id), op));
    } catch (err) {
      if (err instanceof StructureError)
        throw httpError(err.code === 'NOT_FOUND' ? 404 : 422, `STRUCTURE_${err.code}`, { message: err.message });
      throw err;
    }
    return { bundle: getBundle(db, row.id) };
  });
}
