import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Domain tables (SPEC §7.1). IDs are prefixed ULIDs; JSON columns hold small structured values. */
const createdAt = () => text('created_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const updatedAt = () => text('updated_at').notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  createdAt: createdAt(),
});

export const books = sqliteTable(
  'books',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    sourceLang: text('source_lang').notNull(),
    /** Title per language code. */
    titles: text('titles', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    subtitles: text('subtitles', { mode: 'json' }).$type<Record<string, string>>(),
    authors: text('authors', { mode: 'json' }).$type<string[]>().notNull(),
    publisher: text('publisher'),
    year: integer('year'),
    isbn: text('isbn'),
    pageCount: integer('page_count').notNull().default(0),
    pageLabels: text('page_labels', { mode: 'json' }).$type<string[]>().notNull(),
    filePath: text('file_path'),
    fileSha256: text('file_sha256'),
    fileName: text('file_name'),
    brief: text('brief', { mode: 'json' }).$type<Record<string, string>>(),
    settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    report: text('report', { mode: 'json' }).$type<Record<string, unknown>>(),
    status: text('status', {
      enum: ['uploaded', 'ingesting', 'structure_review', 'ready_to_translate', 'translating', 'ready', 'failed'],
    }).notNull(),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('books_owner_sha').on(t.ownerId, t.fileSha256)],
);

export const bookTargets = sqliteTable(
  'book_targets',
  {
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    status: text('status').notNull().default('pending'),
    engineOverrides: text('engine_overrides', { mode: 'json' }).$type<Record<string, unknown>>(),
    doneCount: integer('done_count').notNull().default(0),
    totalCount: integer('total_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.lang] })],
);

export const tocNodes = sqliteTable(
  'toc_nodes',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    ord: integer('ord').notNull(),
    depth: integer('depth').notNull(),
    kind: text('kind', {
      enum: ['front', 'part', 'chapter', 'chapter_intro', 'section', 'subsection', 'back'],
    }).notNull(),
    numberLabel: text('number_label'),
    headingSegmentId: text('heading_segment_id'),
    /** Title for nodes without a heading segment (e.g. cover pages before the first outline entry). */
    title: text('title'),
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    skip: integer('skip', { mode: 'boolean' }).notNull().default(false),
    origin: text('origin', { enum: ['outline', 'heuristic', 'manual'] }).notNull(),
  },
  (t) => [index('toc_nodes_book').on(t.bookId, t.parentId, t.ord)],
);

export const segments = sqliteTable(
  'segments',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    ord: integer('ord').notNull(),
    type: text('type', {
      enum: [
        'heading',
        'paragraph',
        'list_item',
        'quote',
        'code',
        'caption',
        'footnote',
        'table',
        'equation',
        'figure',
        'separator',
      ],
    }).notNull(),
    src: text('src').notNull(),
    page: integer('page').notNull(),
    pageEnd: integer('page_end').notNull(),
    bbox: text('bbox', { mode: 'json' }).$type<{ x: number; y: number; width: number; height: number }>(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    srcHash: text('src_hash').notNull(),
    wordCount: integer('word_count').notNull().default(0),
    translatable: integer('translatable', { mode: 'boolean' }).notNull(),
  },
  (t) => [index('segments_node').on(t.nodeId, t.ord), index('segments_book').on(t.bookId)],
);

export const translations = sqliteTable(
  'translations',
  {
    segmentId: text('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    draft: text('draft'),
    final: text('final'),
    status: text('status', {
      enum: ['pending', 'queued', 'drafted', 'edited', 'final', 'flagged', 'user_edited', 'skipped'],
    }).notNull(),
    engine: text('engine').notNull(),
    model: text('model'),
    confidence: real('confidence'),
    note: text('note'),
    flags: text('flags', { mode: 'json' })
      .$type<{ code: string; severity: string; reason: string }[]>()
      .notNull()
      .default([]),
    version: integer('version').notNull().default(1),
    /** A newer engine result for a user-edited segment: shown as a suggestion, never applied automatically. */
    suggestion: text('suggestion'),
    promptVersion: text('prompt_version'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.segmentId, t.lang] }), index('translations_status').on(t.lang, t.status)],
);

export const translationRevisions = sqliteTable(
  'translation_revisions',
  {
    id: text('id').primaryKey(),
    segmentId: text('segment_id')
      .notNull()
      .references(() => segments.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    before: text('before'),
    after: text('after').notNull(),
    actor: text('actor', { enum: ['engine', 'user'] }).notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('revisions_segment').on(t.segmentId, t.lang, t.createdAt)],
);

export const glossaryTerms = sqliteTable('glossary_terms', {
  id: text('id').primaryKey(),
  bookId: text('book_id').references(() => books.id, { onDelete: 'cascade' }),
  srcLang: text('src_lang').notNull(),
  tgtLang: text('tgt_lang').notNull(),
  src: text('src').notNull(),
  tgt: text('tgt').notNull(),
  alternatives: text('alternatives', { mode: 'json' }).$type<string[]>().notNull().default([]),
  definition: text('definition'),
  kind: text('kind', { enum: ['concept', 'term', 'person', 'org', 'place', 'work', 'acronym'] }).notNull(),
  parenthetical: text('parenthetical', { enum: ['first_in_chapter', 'always', 'never'] }).notNull(),
  status: text('status', { enum: ['proposed', 'approved', 'locked'] }).notNull(),
  occurrences: integer('occurrences').notNull().default(0),
  notes: text('notes'),
  confidence: real('confidence'),
});

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    targetLang: text('target_lang'),
    stage: text('stage', {
      enum: [
        'ingest',
        'brief',
        'glossary',
        'translate',
        'edit',
        'postprocess',
        'index',
        'summary',
        'quiz',
        'tutor_answer',
      ],
    }).notNull(),
    scope: text('scope', { mode: 'json' }).$type<Record<string, unknown>>(),
    engine: text('engine').notNull().default('local'),
    status: text('status', {
      enum: ['queued', 'running', 'awaiting_agent', 'succeeded', 'failed', 'cancelled', 'paused'],
    }).notNull(),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    leaseUntil: text('lease_until'),
    dependsOn: text('depends_on', { mode: 'json' }).$type<string[]>(),
    progress: text('progress', { mode: 'json' }).$type<{ done: number; total: number }>(),
    error: text('error'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    /** Document order of the job's scope within its book (queue tiebreaker). */
    seq: integer('seq').notNull().default(0),
    createdAt: createdAt(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => [index('jobs_queue').on(t.status, t.priority, t.createdAt), index('jobs_book').on(t.bookId, t.stage)],
);

/** Work handed to an agent (Claude Code) as JSON files (SPEC §10.3). */
export const agentBatches = sqliteTable(
  'agent_batches',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    task: text('task').notNull(),
    targetLang: text('target_lang').notNull(),
    filePath: text('file_path').notNull(),
    resultPath: text('result_path').notNull(),
    /** Short key → entity id (segment or candidate). */
    keyMap: text('key_map', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    status: text('status', { enum: ['pending', 'leased', 'submitted', 'rejected', 'imported', 'cancelled'] }).notNull(),
    priority: integer('priority').notNull().default(0),
    seq: integer('seq').notNull().default(0),
    leasedAt: text('leased_at'),
    leaseUntil: text('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    importedAt: text('imported_at'),
  },
  (t) => [index('agent_batches_queue').on(t.status, t.priority, t.seq), index('agent_batches_book').on(t.bookId)],
);

/** Cross-process change feed: the agent CLI writes here, the running API forwards the events over SSE. */
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bookId: text('book_id').notNull(),
  event: text('event', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

/** Application settings (key → JSON): provider configuration with encrypted keys, limiter state. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});
