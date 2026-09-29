import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const EngineSchema = z.enum(['agent', 'anthropic', 'openai', 'mock']);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENGINE_DEFAULT: EngineSchema.default('agent'),
  TUTOR_ENGINE: z.enum(['local', 'agent', 'anthropic', 'openai', 'mock']).default('local'),
});

export type Config = z.infer<typeof EnvSchema> & { webOrigins: string[] };

/** Loads `.env` from the repo root (or the current directory) when present — Node's built-in loader. */
export function loadEnvFiles(): void {
  for (const file of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    ...parsed,
    webOrigins: parsed.WEB_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
