import { API_PREFIX } from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import { getBookRow } from '../db/repo';
import type { BookEvent } from '../events';
import { latestJob } from '../jobs/queue';
import { httpError } from './errors';

export const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events for one book (SPEC §12.6 transport rules): correct headers, no buffering by proxies,
 * a heartbeat comment every 15 s, and an initial snapshot so late subscribers see the current state.
 */
export async function eventRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { db, bus } = ctx;
  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/events`, async (req, reply) => {
    const row = getBookRow(db, req.params.id);
    if (!row) throw httpError(404, 'BOOK_NOT_FOUND');
    const origin = req.headers.origin;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(origin && ctx.config.webOrigins.includes(origin)
        ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
        : {}),
    });
    const send = (event: BookEvent) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.write(': connected\n\n');
    send({ type: 'book', status: row.status });
    const job = latestJob(db, row.id, 'ingest');
    if (job?.progress && (job.status === 'running' || job.status === 'queued')) {
      send({ type: 'progress', stage: 'ingest', ...job.progress });
    }
    const unsubscribe = bus.subscribe(row.id, send);
    const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), HEARTBEAT_MS);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
