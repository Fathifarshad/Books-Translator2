import { chapterOf, createBookIndex, locationPath, taskPriority } from '@dozabaneh/core';
import type { QaFlag, TranslationStatus } from '@dozabaneh/shared';
import { createGlossaryMatcher, stripMarkup } from '@dozabaneh/text';
import { and, desc, eq } from 'drizzle-orm';
import { getBookRow, getBundle, newId, refreshCounters } from '../db/repo';
import { glossaryTerms, segments, translationRevisions, translations } from '../db/schema';
import { advancePipeline } from './advance';
import { insertJob } from './jobs';
import { reindexSegments } from './search-index';
import { logPipeline, type PipelineCtx, translationSettings } from './state';

/**
 * Manual editing with history (SPEC §9.8) and the review queue (SPEC §13.5). User edits get status `user_edited`,
 * which automation never overwrites; every change is stored in `translation_revisions`.
 */
export class ReviewError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}

type Row = typeof translations.$inferSelect;

function getRow(ctx: PipelineCtx, segmentId: string, lang: string): Row | undefined {
  return ctx.db
    .select()
    .from(translations)
    .where(and(eq(translations.segmentId, segmentId), eq(translations.lang, lang)))
    .get();
}

function segmentOrThrow(ctx: PipelineCtx, segmentId: string) {
  const seg = ctx.db.select().from(segments).where(eq(segments.id, segmentId)).get();
  if (!seg) throw new ReviewError('SEGMENT_NOT_FOUND', 404);
  return seg;
}

function afterChange(ctx: PipelineCtx, bookId: string, segmentId: string, lang: string): void {
  reindexSegments(ctx.db, bookId, [segmentId], lang);
  refreshCounters(ctx.db, bookId);
  ctx.notify(bookId, { type: 'segment', lang, ids: [segmentId] });
  ctx.notify(bookId, { type: 'pipeline', lang });
}

export interface TranslationView {
  segmentId: string;
  lang: string;
  text: string;
  status: TranslationStatus;
  version: number;
  suggestion: string | null;
}

const view = (r: Row): TranslationView => ({
  segmentId: r.segmentId,
  lang: r.lang,
  text: r.final ?? r.draft ?? '',
  status: r.status,
  version: r.version,
  suggestion: r.suggestion,
});

/** Saves a user edit (or an undo, which is an edit back to an earlier text). */
export function editTranslation(
  ctx: PipelineCtx,
  segmentId: string,
  lang: string,
  text: string,
  reason = 'edit',
): TranslationView {
  const seg = segmentOrThrow(ctx, segmentId);
  const value = text.trim();
  if (!value) throw new ReviewError('EMPTY_TRANSLATION');
  const row = getRow(ctx, segmentId, lang);
  const before = row ? (row.final ?? row.draft) : null;
  if (before === value && row?.status === 'user_edited') return view(row);
  ctx.db.transaction(() => {
    const set = {
      final: value,
      status: 'user_edited' as const,
      engine: 'user',
      flags: [] as QaFlag[],
      version: (row?.version ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    ctx.db
      .insert(translations)
      .values({ segmentId, lang, ...set })
      .onConflictDoUpdate({ target: [translations.segmentId, translations.lang], set })
      .run();
    ctx.db
      .insert(translationRevisions)
      .values({ id: newId('rv'), segmentId, lang, before, after: value, actor: 'user', reason })
      .run();
  });
  afterChange(ctx, seg.bookId, segmentId, lang);
  return view(getRow(ctx, segmentId, lang) as Row);
}

export function revisionsOf(ctx: PipelineCtx, segmentId: string, lang: string) {
  return ctx.db
    .select()
    .from(translationRevisions)
    .where(and(eq(translationRevisions.segmentId, segmentId), eq(translationRevisions.lang, lang)))
    .orderBy(desc(translationRevisions.createdAt), desc(translationRevisions.id))
    .all();
}

export type ReviewAction = 'approve' | 'reject' | 'rerun' | 'accept_suggestion' | 'dismiss_suggestion';

export function reviewAction(ctx: PipelineCtx, segmentId: string, lang: string, action: ReviewAction): TranslationView {
  const seg = segmentOrThrow(ctx, segmentId);
  const row = getRow(ctx, segmentId, lang);
  if (!row) throw new ReviewError('NO_TRANSLATION', 404);
  const now = new Date().toISOString();
  const where = and(eq(translations.segmentId, segmentId), eq(translations.lang, lang));
  switch (action) {
    case 'approve': {
      if (row.status !== 'flagged' && row.status !== 'drafted') throw new ReviewError('NOTHING_TO_APPROVE');
      ctx.db
        .update(translations)
        .set({ status: 'final', final: row.final ?? row.draft, flags: [], version: row.version + 1, updatedAt: now })
        .where(where)
        .run();
      break;
    }
    case 'reject': {
      if (!row.draft || row.final === null || row.final === row.draft) throw new ReviewError('NOTHING_TO_REJECT');
      ctx.db.transaction(() => {
        ctx.db
          .update(translations)
          .set({ status: 'final', final: row.draft, flags: [], version: row.version + 1, updatedAt: now })
          .where(where)
          .run();
        ctx.db
          .insert(translationRevisions)
          .values({
            id: newId('rv'),
            segmentId,
            lang,
            before: row.final,
            after: row.draft as string,
            actor: 'user',
            reason: 'reject',
          })
          .run();
      });
      break;
    }
    case 'accept_suggestion': {
      if (!row.suggestion) throw new ReviewError('NO_SUGGESTION');
      editTranslation(ctx, segmentId, lang, row.suggestion, 'accept-suggestion');
      ctx.db.update(translations).set({ suggestion: null }).where(where).run();
      break;
    }
    case 'dismiss_suggestion': {
      ctx.db.update(translations).set({ suggestion: null, updatedAt: now }).where(where).run();
      break;
    }
    case 'rerun': {
      rerunEdit(ctx, seg.bookId, lang, [segmentId]);
      break;
    }
  }
  afterChange(ctx, seg.bookId, segmentId, lang);
  return view(getRow(ctx, segmentId, lang) as Row);
}

/** Targeted edit jobs for some segments (review «اجرای دوباره‌ی ویراستاری», glossary «اعمال در متن ترجمه‌شده»). */
export function rerunEdit(ctx: PipelineCtx, bookId: string, lang: string, segmentIds: string[]): number {
  const row = getBookRow(ctx.db, bookId);
  const bundle = getBundle(ctx.db, bookId);
  if (!row || !bundle || segmentIds.length === 0) return 0;
  const settings = translationSettings(row, lang);
  const index = createBookIndex(bundle);
  const byNode = new Map<string, string[]>();
  for (const id of segmentIds) {
    const seg = index.segmentById.get(id);
    if (seg) byNode.set(seg.nodeId, [...(byNode.get(seg.nodeId) ?? []), id]);
  }
  for (const [nodeId, ids] of byNode) {
    insertJob(ctx.db, {
      bookId,
      lang,
      stage: 'edit',
      engine: settings.engines.edit,
      priority: taskPriority('edit', true) + 200,
      seq: 0,
      scope: { nodeId, chapterId: chapterOf(index, nodeId)?.id ?? nodeId, segmentIds: ids, rerun: true },
    });
  }
  logPipeline(ctx, bookId, lang, `edit: re-run for ${segmentIds.length} segment(s)`);
  advancePipeline(ctx, bookId, lang);
  return byNode.size;
}

/** Changing an approved equivalent: re-edit only the segments whose source contains the term (SPEC §13.4). */
export function applyGlossaryTerm(ctx: PipelineCtx, bookId: string, termId: string): number {
  const term = ctx.db.select().from(glossaryTerms).where(eq(glossaryTerms.id, termId)).get();
  const bundle = getBundle(ctx.db, bookId);
  if (!term || !bundle) throw new ReviewError('TERM_NOT_FOUND', 404);
  const matcher = createGlossaryMatcher([{ id: term.id, text: term.src }], bundle.book.sourceLang);
  const done = new Map(bundle.translations.filter((t) => t.lang === term.tgtLang).map((t) => [t.segmentId, t.status]));
  const ids = bundle.segments
    .filter((s) => ['drafted', 'edited', 'final', 'flagged', 'user_edited'].includes(done.get(s.id) ?? ''))
    .filter((s) => matcher.find(stripMarkup(s.src)).length > 0)
    .map((s) => s.id);
  rerunEdit(ctx, bookId, term.tgtLang, ids);
  return ids.length;
}

export interface ReviewItem {
  segmentId: string;
  nodeId: string;
  location: string[];
  type: string;
  src: string;
  draft: string | null;
  final: string | null;
  status: TranslationStatus;
  flags: QaFlag[];
  confidence: number | null;
  note: string | null;
  suggestion: string | null;
  lastChange: { before: string | null; after: string; reason: string | null } | null;
}

/** Flagged or low-confidence segments (and, with `all`, anything with flags or a pending suggestion), in book order. */
export function reviewQueue(
  ctx: PipelineCtx,
  bookId: string,
  lang: string,
  filter: 'flagged' | 'all' = 'flagged',
): ReviewItem[] {
  const bundle = getBundle(ctx.db, bookId);
  if (!bundle) throw new ReviewError('BOOK_NOT_FOUND', 404);
  const index = createBookIndex(bundle);
  const rows = new Map(
    ctx.db.$client
      .prepare(
        `SELECT t.* FROM translations t JOIN segments s ON s.id = t.segment_id
          WHERE s.book_id = ? AND t.lang = ?`,
      )
      .all(bookId, lang)
      .map((r) => {
        const x = r as Record<string, unknown>;
        return [x.segment_id as string, x] as const;
      }),
  );
  const items: ReviewItem[] = [];
  for (const node of index.nodes) {
    for (const seg of index.segmentsByNode.get(node.id) ?? []) {
      const r = rows.get(seg.id);
      if (!r) continue;
      const flags = JSON.parse((r.flags as string) ?? '[]') as QaFlag[];
      const include = r.status === 'flagged' || (filter === 'all' && (flags.length > 0 || Boolean(r.suggestion)));
      if (!include) continue;
      const last = revisionsOf(ctx, seg.id, lang).find((v) => v.actor === 'engine');
      items.push({
        segmentId: seg.id,
        nodeId: node.id,
        location: locationPath(index, node.id, lang),
        type: seg.type,
        src: seg.src,
        draft: (r.draft as string | null) ?? null,
        final: (r.final as string | null) ?? null,
        status: r.status as TranslationStatus,
        flags,
        confidence: (r.confidence as number | null) ?? null,
        note: (r.note as string | null) ?? null,
        suggestion: (r.suggestion as string | null) ?? null,
        lastChange: last ? { before: last.before, after: last.after, reason: last.reason } : null,
      });
    }
  }
  return items;
}
