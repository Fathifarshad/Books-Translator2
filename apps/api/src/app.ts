import { sampleBook } from '@dozabaneh/shared/sample-book';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config';
import { type Db, openDb } from './db/client';
import { ensureLocalUser, seedBundle } from './db/repo';
import { EventBus } from './events';
import { JobRunner, pipelineCtx } from './jobs/runner';
import { advanceAll } from './pipeline/advance';
import { NotificationPoller } from './pipeline/notify';
import { bookRoutes } from './routes/books';
import { HttpError } from './routes/errors';
import { eventRoutes } from './routes/events';
import { glossaryRoutes } from './routes/glossary';
import { healthRoutes } from './routes/health';
import { pipelineRoutes } from './routes/pipeline';
import { searchRoutes } from './routes/search';
import { segmentRoutes } from './routes/segments';
import { structureRoutes } from './routes/structure';

export interface AppContext {
  config: Config;
  db: Db;
  bus: EventBus;
  runner: JobRunner;
}

export interface BuildOptions {
  /** Start the inline job runner (tests drive it manually with `runner.drain()`). */
  startRunner?: boolean;
  /** Database file name inside DATA_DIR (':memory:' for tests). */
  dbFile?: string;
}

export async function buildApp(
  config: Config,
  opts: BuildOptions = {},
): Promise<FastifyInstance & { ctx: AppContext }> {
  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL },
    bodyLimit: 2 * 1024 * 1024,
  });

  const db = openDb(config.dataDir, opts.dbFile);
  ensureLocalUser(db);
  if (config.AUTO_SEED) seedBundle(db, sampleBook, 'us_local');
  const bus = new EventBus();
  const ctx: AppContext = { config, db, bus, runner: undefined as unknown as JobRunner };
  ctx.runner = new JobRunner({ db, bus, config, log: app.log });

  // CORS only for configured web origins (SPEC §16); the mobile app will use bearer tokens later.
  await app.register(cors, {
    origin: config.webOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  await app.register(multipart);

  app.setErrorHandler((error: FastifyError | HttpError | ZodError, _req, reply) => {
    if (error instanceof HttpError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.code, details: error.details } });
    }
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send({ error: { code: 'INVALID_REQUEST', message: 'Invalid request', details: { issues: error.issues } } });
    }
    const fe = error as FastifyError;
    if (fe.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'FILE_TOO_LARGE', details: {} } });
    }
    const status = fe.statusCode ?? 500;
    if (status >= 500) app.log.error(fe);
    return reply.status(status).send({
      error: { code: fe.code ?? 'INTERNAL', message: status >= 500 ? 'Internal error' : fe.message, details: {} },
    });
  });

  await app.register(healthRoutes, { config });
  await app.register(bookRoutes, { ctx });
  await app.register(structureRoutes, { ctx });
  await app.register(searchRoutes, { ctx });
  await app.register(eventRoutes, { ctx });
  await app.register(pipelineRoutes, { ctx });
  await app.register(glossaryRoutes, { ctx });
  await app.register(segmentRoutes, { ctx });

  // Events written by the agent CLI (another process) reach open pages through the notifications table.
  const poller = new NotificationPoller(db, bus, () => ctx.runner.kick());
  if (opts.startRunner !== false) {
    advanceAll(pipelineCtx(ctx));
    ctx.runner.start();
    poller.start();
  }
  app.addHook('onClose', async () => {
    ctx.runner.stop();
    poller.stop();
    db.$client.close();
  });
  return Object.assign(app, { ctx }) as unknown as FastifyInstance & { ctx: AppContext };
}
