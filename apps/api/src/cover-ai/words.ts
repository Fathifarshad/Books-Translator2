import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BasicWords } from '@dozabaneh/cover';
import { repoRoot } from '../config';

/**
 * Names and reasons of the app's own cover designer (used when no AI engine is connected). They come from the UI
 * catalogue (`fa.json` → coverStudio.ai.basic), so the server carries no literal in any language (golden rule 3).
 */
export type BasicDesignerWords = BasicWords[];

let cache: BasicDesignerWords | undefined;

export function basicDesignerWords(): BasicDesignerWords {
  if (!cache) {
    const all = JSON.parse(readFileSync(join(repoRoot(), 'apps/web/src/i18n/fa.json'), 'utf8')) as {
      coverStudio?: { ai?: { basic?: BasicWords[] } };
    };
    cache = all.coverStudio?.ai?.basic ?? [];
  }
  return cache;
}
