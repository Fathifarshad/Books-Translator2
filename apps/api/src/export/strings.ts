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

/** Strings of the errata list («فایل سوتی», `fa.json` → "errata"). */
export interface ErrataStrings {
  title: string;
  subtitle: string;
  summary: string;
  none: string;
  systematic: string;
  exported: string;
  paragraph: string;
  heading: string;
  deleted: string;
  inserted: string;
  columns: Record<string, string | undefined>;
  types: Record<string, string | undefined>;
}

let errataCache: ErrataStrings | undefined;

export function errataStrings(): ErrataStrings {
  if (!errataCache) {
    const all = JSON.parse(readFileSync(join(repoRoot(), 'apps/web/src/i18n/fa.json'), 'utf8')) as {
      errata: ErrataStrings;
    };
    errataCache = all.errata;
  }
  return errataCache;
}

/** Strings printed inside the book PDF (`fa.json` → "bookPdf.book"), and the preparer's default role. */
export interface BookStrings {
  toc: string;
  figures: string;
  tables: string;
  glossary: string;
  figure: string;
  table: string;
  image: string;
  by: string;
  imprint: string;
  fields: Record<'title' | 'original' | 'authors' | 'publisher' | 'kind' | 'date' | 'figures', string>;
  kinds: Record<'translation' | 'edition', string>;
  made: string;
  personalUse: string;
  defaultRole: string;
}

let bookCache: BookStrings | undefined;

export function bookStrings(): BookStrings {
  if (!bookCache) {
    const all = JSON.parse(readFileSync(join(repoRoot(), 'apps/web/src/i18n/fa.json'), 'utf8')) as {
      bookPdf: { book: Omit<BookStrings, 'defaultRole'>; defaultRole: string };
    };
    bookCache = { ...all.bookPdf.book, defaultRole: all.bookPdf.defaultRole };
  }
  return bookCache;
}

/** `{{name}}` placeholders filled in, the way i18next would. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (_m, key: string) => values[key] ?? '');
}
