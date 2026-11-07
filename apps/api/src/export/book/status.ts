import { existsSync } from 'node:fs';
import type { BookPdfOptions, BookPdfStatus, BookPdfStep } from '@dozabaneh/shared';
import { isEditOnly } from '@dozabaneh/text';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import { getBookRow } from '../../db/repo';
import { builtFile, coverFile, savedOptions } from './build';
import { findBrowser } from './print';

/**
 * What the «کتاب PDF» page shows (ADR-046): the last build's file, the job that is making a new one, and whether this
 * computer can make one at all. The step a running build is on lives in memory — it only matters while the server
 * that runs the job is up.
 */
const live = new Map<string, { step: BookPdfStep; done: number; total: number; fraction: number }>();
const key = (bookId: string, lang: string) => `${bookId}|${lang}`;

export function reportProgress(
  bookId: string,
  lang: string,
  p: { step: BookPdfStep; done: number; total: number; fraction: number },
) {
  live.set(key(bookId, lang), p);
}

export function clearProgress(bookId: string, lang: string): void {
  live.delete(key(bookId, lang));
}

let browser: boolean | undefined;
/** Looked up once per server: installing a browser is rare enough to need a restart. */
export function hasBrowser(): boolean {
  browser ??= Boolean(findBrowser());
  return browser;
}

export function bookPdfStatus(
  deps: { db: Db; config: Pick<Config, 'dataDir'> },
  bookId: string,
  lang: string,
  options?: BookPdfOptions,
): BookPdfStatus {
  const { db, config } = deps;
  const row = db.$client
    .prepare(
      `SELECT status, error FROM jobs WHERE book_id = ? AND stage = 'book_pdf' AND target_lang = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(bookId, lang) as { status?: string; error?: string | null } | undefined;
  const running = row?.status === 'queued' || row?.status === 'running';
  const progress = running ? live.get(key(bookId, lang)) : undefined;
  const file = builtFile(config, bookId, lang);
  const book = getBookRow(db, bookId);
  const failed = row?.status === 'failed';
  const code = failed ? (/^[A-Z_]+$/.test(row?.error ?? '') ? (row?.error as string) : 'BUILD_FAILED') : undefined;
  return {
    state: running ? 'running' : failed ? 'failed' : file ? 'done' : 'idle',
    ...(progress ? { step: progress.step } : {}),
    done: progress?.done ?? 0,
    total: progress?.total ?? 0,
    fraction: running ? (progress?.fraction ?? 0) : file ? 1 : 0,
    ...(code ? { error: code } : {}),
    ...(failed && code === 'BUILD_FAILED' && row?.error ? { message: row.error.slice(0, 300) } : {}),
    ...(file ? { file } : {}),
    options: options ?? savedOptions(db, bookId),
    coverUploaded: Boolean(coverFile(config, bookId)),
    browser: hasBrowser(),
    editOnly: book ? isEditOnly(book.sourceLang, lang) : false,
    sourcePdf: Boolean(book?.filePath && existsSync(book.filePath)),
  };
}
