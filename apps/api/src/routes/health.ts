import { API_PREFIX, APP } from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config';

export interface HealthResponse {
  status: 'ok';
  name: string;
  version: string;
  engines: { default: Config['ENGINE_DEFAULT']; tutor: Config['TUTOR_ENGINE'] };
  time: string;
}

export async function healthRoutes(app: FastifyInstance, opts: { config: Config }): Promise<void> {
  app.get(
    `${API_PREFIX}/health`,
    async (): Promise<HealthResponse> => ({
      status: 'ok',
      name: APP.latinName,
      version: APP.version,
      engines: { default: opts.config.ENGINE_DEFAULT, tutor: opts.config.TUTOR_ENGINE },
      time: new Date().toISOString(),
    }),
  );
}
