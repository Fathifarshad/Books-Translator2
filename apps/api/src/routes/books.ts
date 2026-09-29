import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { API_PREFIX } from '@dozabaneh/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBookRow, getBundle, LOCAL_USER, listBooks, newId, targetsOf, toBookRecord } from '../db/repo';
import { books, bookTargets } from '../db/schema';
import { enqueue, latestJob } from '../jobs/queue';
import { httpError } from './errors';

const PatchBook = z.object({
  titles: z.record(z.string(), z.string().min(1)).optional(),
  authors: z.array(z.string()).optional(),
  publisher: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
});

/** Library, upload and per-book data (SPEC §17). */
export async function bookRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { db, config } = ctx;

  app.get(`${API_PREFIX}/books`, async () => ({ books: listBooks(db, LOCAL_USER) }));

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id`, async (req) => {
    const row = getBookRow(db, req.params.id);
    if (!row || row.ownerId !== LOCAL_USER) throw httpError(404, 'BOOK_NOT_FOUND');
    const job = latestJob(db, row.id, 'ingest');
    return {
      book: toBookRecord(row, targetsOf(db, row.id)),
      fileName: row.fileName,
      error: row.error,
      ingest: job ? { status: job.status, progress: job.progress, error: job.error } : null,
    };
  });

  /** Whole book for the reader: nodes, segments, translations, glossary. */
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/bundle`, async (req, reply) => {
    const bundle = getBundle(db, req.params.id);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    reply.header('Cache-Control', 'no-cache');
    return bundle;
  });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/report`, async (req) => {
    const row = getBookRow(db, req.params.id);
    if (!row) throw httpError(404, 'BOOK_NOT_FOUND');
    return { report: row.report ?? null, status: row.status, error: row.error };
  });

  app.patch<{ Params: { id: string } }>(`${API_PREFIX}/books/:id`, async (req) => {
    const row = getBookRow(db, req.params.id);
    if (!row) throw httpError(404, 'BOOK_NOT_FOUND');
    const body = PatchBook.parse(req.body);
    db.update(books)
      .set({
        ...(body.titles ? { titles: { ...row.titles, ...body.titles } } : {}),
        ...(body.authors ? { authors: body.authors } : {}),
        ...(body.publisher !== undefined ? { publisher: body.publisher } : {}),
        ...(body.year !== undefined ? { year: body.year } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(books.id, row.id))
      .run();
    const next = getBookRow(db, row.id);
    return { book: next ? toBookRecord(next, targetsOf(db, row.id)) : null };
  });

  app.delete<{ Params: { id: string } }>(`${API_PREFIX}/books/:id`, async (req, reply) => {
    const row = getBookRow(db, req.params.id);
    if (!row) throw httpError(404, 'BOOK_NOT_FOUND');
    db.transaction((tx) => {
      // Same connection: better-sqlite3 transactions are synchronous.
      db.$client.prepare('DELETE FROM segments_fts WHERE book_id = ?').run(row.id);
      db.$client.prepare('DELETE FROM translations_fts WHERE book_id = ?').run(row.id);
      tx.delete(books).where(eq(books.id, row.id)).run();
    });
    await rm(join(config.dataDir, 'uploads', row.id), { recursive: true, force: true });
    reply.code(204);
    return null;
  });

  /** Original PDF with HTTP range support (page viewer, Phase 5). Owner only. */
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/file`, async (req, reply) => {
    const row = getBookRow(db, req.params.id);
    if (!row?.filePath || row.ownerId !== LOCAL_USER) throw httpError(404, 'FILE_NOT_FOUND');
    const { size } = await stat(row.filePath);
    reply.header('Accept-Ranges', 'bytes').header('Content-Type', 'application/pdf');
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        reply.code(416).header('Content-Range', `bytes */${size}`);
        return null;
      }
      reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1);
      return reply.send(createReadStream(row.filePath, { start, end }));
    }
    reply.header('Content-Length', size);
    return reply.send(createReadStream(row.filePath));
  });

  /**
   * Upload (multipart, one PDF): checks the %PDF- magic bytes and the size limit while streaming to disk,
   * computes SHA-256, offers the existing book for a duplicate, then queues ingestion (SPEC §8.1).
   */
  app.post(`${API_PREFIX}/books`, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
    if (!file) throw httpError(400, 'NO_FILE');
    const tmpDir = join(config.dataDir, 'uploads', 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, `${newId('up')}.pdf`);
    const sha = createHash('sha256');
    let head = Buffer.alloc(0);
    const check = new Transform({
      transform(chunk: Buffer, _enc, done) {
        if (head.length < 5) {
          head = Buffer.concat([head, chunk]).subarray(0, 5);
          if (head.length === 5 && head.toString('latin1') !== '%PDF-') return done(httpError(415, 'NOT_A_PDF'));
        }
        sha.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(file.file, check, createWriteStream(tmp));
      if (file.file.truncated) throw httpError(413, 'FILE_TOO_LARGE');
      if (head.toString('latin1') !== '%PDF-') throw httpError(415, 'NOT_A_PDF');
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    const digest = sha.digest('hex');
    const existing = db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.ownerId, LOCAL_USER), eq(books.fileSha256, digest)))
      .get();
    if (existing) {
      await rm(tmp, { force: true });
      throw httpError(409, 'DUPLICATE_BOOK', { bookId: existing.id });
    }

    const bookId = newId('bk');
    const dir = join(config.dataDir, 'uploads', bookId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'original.pdf');
    await rename(tmp, filePath);
    const title = (file.filename || 'book.pdf').replace(/\.pdf$/i, '');
    db.transaction((tx) => {
      tx.insert(books)
        .values({
          id: bookId,
          ownerId: LOCAL_USER,
          sourceLang: 'en',
          titles: { en: title },
          authors: [],
          pageLabels: [],
          filePath,
          fileName: file.filename,
          fileSha256: digest,
          status: 'uploaded',
        })
        .run();
      tx.insert(bookTargets).values({ bookId, lang: 'fa' }).run();
    });
    const jobId = enqueue(db, { bookId, stage: 'ingest', priority: 10 });
    ctx.runner.kick();
    reply.code(201);
    return { bookId, jobId };
  });
}
