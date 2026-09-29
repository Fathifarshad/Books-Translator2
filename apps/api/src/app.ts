import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config';
import { healthRoutes } from './routes/health';

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL },
  });

  // CORS only for configured web origins (SPEC §16); the mobile app will use bearer tokens later.
  await app.register(cors, { origin: config.webOrigins, credentials: false });

  app.setErrorHandler((error: FastifyError, _req, reply) => {
    const status = error.statusCode ?? 500;
    reply.status(status).send({
      error: { code: error.code ?? 'INTERNAL', message: status >= 500 ? 'Internal error' : error.message, details: {} },
    });
  });

  await app.register(healthRoutes, { config });
  return app;
}
