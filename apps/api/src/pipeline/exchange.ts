import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Config } from '../config';
import { repoRoot } from '../config';

/**
 * File exchange with the agent (SPEC §10.3): batches in data/exchange/outbox/<bookId>/<task>/<batchId>.json, results
 * in data/exchange/inbox/<bookId>/<task>/<batchId>.result.json, imported files in data/exchange/archive/….
 */
export function exchangeDir(config: Config, box: 'outbox' | 'inbox' | 'archive', bookId: string, task: string): string {
  return join(config.dataDir, 'exchange', box, bookId, task);
}

export function batchPaths(config: Config, bookId: string, task: string, batchId: string) {
  return {
    batch: join(exchangeDir(config, 'outbox', bookId, task), `${batchId}.json`),
    result: join(exchangeDir(config, 'inbox', bookId, task), `${batchId}.result.json`),
    archiveDir: exchangeDir(config, 'archive', bookId, task),
  };
}

/** Path as the agent should see it: relative to the repository root with forward slashes, when inside it. */
export function displayPath(path: string): string {
  const rel = relative(repoRoot(), path);
  if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  return path;
}

/** Resolves a path given on the command line (relative to where the user ran the command, or the repo root). */
export function resolveUserPath(path: string, cwd = process.env.INIT_CWD ?? process.cwd()): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/** "bt_…" from ".../bt_….result.json". */
export function batchIdFromPath(path: string): string | undefined {
  return /(bt_[a-z0-9]+)(?:\.result)?\.json$/iu.exec(path)?.[1];
}
