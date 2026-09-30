import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promptVersion } from '@dozabaneh/ai';
import { repoRoot } from '../config';

const cache = new Map<string, string>();

/** Version of a prompt file in prompts/ (stored with every result, SPEC §10.1). */
export function promptVersionOf(ref: string): string {
  const cached = cache.get(ref);
  if (cached) return cached;
  let v = 'v0';
  try {
    v = promptVersion(readFileSync(join(repoRoot(), ref), 'utf8'));
  } catch {
    // missing prompt file: keep v0
  }
  cache.set(ref, v);
  return v;
}
