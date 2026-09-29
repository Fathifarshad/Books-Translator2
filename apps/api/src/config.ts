import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const EngineSchema = z.enum(['agent', 'anthropic', 'openai', 'mock']);
const bool = z
  .enum(['0', '1', 'true', 'false'])
  .default('1')
  .transform((v) => v === '1' || v === 'true');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('127.0.0.1'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATA_DIR: z.string().default('./data'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(200),
  MAX_PAGES: z.coerce.number().int().positive().default(2000),
  WORKER_MODE: z.enum(['inline', 'separate']).default('inline'),
  /** Seed the original sample book into an empty database at startup. */
  AUTO_SEED: bool,
  ENGINE_DEFAULT: EngineSchema.default('agent'),
  TUTOR_ENGINE: z.enum(['local', 'agent', 'anthropic', 'openai', 'mock']).default('local'),
});

export type Config = z.infer<typeof EnvSchema> & { webOrigins: string[]; dataDir: string };

/** Repository root (folder with pnpm-workspace.yaml); relative paths in .env resolve against it. */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

/** Loads `.env` from the repo root when present — Node's built-in loader. */
export function loadEnvFiles(): void {
  const file = resolve(repoRoot(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  return {
    ...parsed,
    webOrigins: parsed.WEB_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    dataDir: isAbsolute(parsed.DATA_DIR) ? parsed.DATA_DIR : resolve(repoRoot(), parsed.DATA_DIR),
  };
}
