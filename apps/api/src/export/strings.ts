import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../config';

/**
 * UI strings an export writes into the file itself (headings, footer). They come from the app's own catalogue
 * (`apps/web/src/i18n/fa.json` → "offline"), so no exporter carries a literal in any language (golden rule 3).
 */
export interface ExportStrings {
  glossary: string;
  footer: string;
  untranslated: string;
}

let cache: ExportStrings | undefined;

export function exportStrings(): ExportStrings {
  if (!cache) {
    const all = JSON.parse(readFileSync(join(repoRoot(), 'apps/web/src/i18n/fa.json'), 'utf8')) as {
      offline: Record<string, string | undefined>;
    };
    const o = all.offline;
    cache = { glossary: o.glossary ?? '', footer: o.footer ?? '', untranslated: o.untranslated ?? '' };
  }
  return cache;
}

/** `{{name}}` placeholders filled in, the way i18next would. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (_m, key: string) => values[key] ?? '');
}
