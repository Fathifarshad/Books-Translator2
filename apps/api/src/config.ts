import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const EngineSchema = z.enum(['agent', 'mock', 'gemini', 'ollama', 'openrouter']);
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
  /** Read scanned pages (no text layer) with OCR during ingestion. */
  OCR: bool,
  AGENT_MAX_PENDING: z.coerce.number().int().positive().default(40),
  AGENT_LEASE_MINUTES: z.coerce.number().positive().default(60),
  /** Simulated latency of the mock engine per batch (ms), so progress is visible in demos. */
  MOCK_LATENCY_MS: z.coerce.number().int().nonnegative().default(0),
  ENGINE_DEFAULT: EngineSchema.default('agent'),
  TUTOR_ENGINE: z.enum(['local', 'mock', 'gemini', 'ollama', 'openrouter']).default('local'),
  /**
   * Encrypts API keys stored in the database. When unset (or left at the example value) a random key is created
   * once in DATA_DIR/secret.key.
   */
  APP_SECRET: z.string().optional(),
  /** Default endpoints; each can be changed in Settings (Ollama on another computer, tests with a fake server). */
  GEMINI_BASE_URL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().optional(),
  /** OpenRouter's authorization page for the one-click connection (OAuth PKCE). */
  OPENROUTER_AUTH_URL: z.string().default('https://openrouter.ai/auth'),
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
