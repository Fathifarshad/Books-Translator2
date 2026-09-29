import {
  type BriefResult,
  type PipelineLogEntry,
  type TranslationSettings,
  TranslationSettingsSchema,
} from '@dozabaneh/shared';
import { eq } from 'drizzle-orm';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { books } from '../db/schema';
import type { BookEvent } from '../events';

/**
 * Pipeline context shared by the API process and the agent CLI. `notify` publishes on the in-process event bus
 * (API) or writes to the `notifications` table, which the running API forwards over SSE (CLI).
 */
export interface PipelineCtx {
  db: Db;
  config: Config;
  notify: (bookId: string, event: BookEvent) => void;
}

/** Per target language pipeline state, stored in `books.settings.pipeline[lang]`. */
export interface PipelineState {
  paused: boolean;
  cancelled: boolean;
  /** Glossary jobs were created (possibly none, when no candidates were found). */
  glossaryPlanned: boolean;
  glossaryApproved: boolean;
  /** Translate/edit jobs were created. */
  translationPlanned: boolean;
  /** Chapters whose first-mention consistency pass has run. */
  finalizedChapters: string[];
  /** Sections the reader asked to translate now (their chapter's chunks up to them are boosted). */
  boosted: string[];
  startedAt?: string;
  finishedAt?: string;
  log: PipelineLogEntry[];
}

export interface BookSettings {
  sample?: boolean;
  translation?: Record<string, TranslationSettings>;
  pipeline?: Record<string, PipelineState>;
  briefs?: Record<string, BriefResult>;
}

const EMPTY_STATE: PipelineState = {
  paused: false,
  cancelled: false,
  glossaryPlanned: false,
  glossaryApproved: false,
  translationPlanned: false,
  finalizedChapters: [],
  boosted: [],
  log: [],
};

type BookRow = typeof books.$inferSelect;

export function bookSettings(row: Pick<BookRow, 'settings'>): BookSettings {
  return (row.settings ?? {}) as BookSettings;
}

export function translationSettings(row: Pick<BookRow, 'settings'>, lang: string): TranslationSettings {
  return TranslationSettingsSchema.parse(bookSettings(row).translation?.[lang] ?? {});
}

export function pipelineState(row: Pick<BookRow, 'settings'>, lang: string): PipelineState {
  return { ...EMPTY_STATE, ...(bookSettings(row).pipeline?.[lang] ?? {}) };
}

/** Read-modify-write of `books.settings` (callers run inside a transaction when consistency matters). */
export function updateSettings(db: Db, bookId: string, fn: (s: BookSettings) => void): BookSettings {
  const row = db.select({ settings: books.settings }).from(books).where(eq(books.id, bookId)).get();
  const next = structuredClone(bookSettings(row ?? { settings: {} }));
  fn(next);
  db.update(books)
    .set({ settings: next as Record<string, unknown>, updatedAt: new Date().toISOString() })
    .where(eq(books.id, bookId))
    .run();
  return next;
}

export function updatePipelineState(
  db: Db,
  bookId: string,
  lang: string,
  fn: (s: PipelineState) => void,
): PipelineState {
  let state = EMPTY_STATE;
  updateSettings(db, bookId, (s) => {
    s.pipeline ??= {};
    state = { ...EMPTY_STATE, ...(s.pipeline[lang] ?? {}) };
    fn(state);
    s.pipeline[lang] = state;
  });
  return state;
}

const MAX_LOG = 120;

/** Appends to the dashboard's live log (kept short) and pushes a pipeline refresh event. */
export function logPipeline(
  ctx: PipelineCtx,
  bookId: string,
  lang: string,
  message: string,
  level: PipelineLogEntry['level'] = 'info',
): void {
  updatePipelineState(ctx.db, bookId, lang, (s) => {
    s.log = [...s.log, { at: new Date().toISOString(), message, level }].slice(-MAX_LOG);
  });
  ctx.notify(bookId, { type: 'pipeline', lang });
}
