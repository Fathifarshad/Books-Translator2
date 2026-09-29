import {
  chapterOf,
  chunkSegments,
  createBookIndex,
  EDIT_UNIT_WORDS,
  extractCandidates,
  needsTranslation,
  TRANSLATE_CHUNK_WORDS,
  taskPriority,
} from '@dozabaneh/core';
import type { BookBundle, PipelineTask, SegmentRecord, TranslationSettings } from '@dozabaneh/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { getBundle, newId } from '../db/repo';
import { glossaryTerms, jobs, translations } from '../db/schema';

/**
 * Job planning for one book × target language (SPEC §9.1). Jobs form a DAG through `depends_on`:
 * brief → glossary batches → (glossary review) → translate chunks (sequential within a chapter) → edit units
 * (per section, after its chunks). A job is runnable when it is queued and all its dependencies succeeded.
 */
export type JobRow = typeof jobs.$inferSelect;

export const PIPELINE_STAGES: PipelineTask[] = ['brief', 'glossary', 'translate', 'edit'];
const DONE_STATUSES = new Set(['final', 'user_edited']);
const GLOSSARY_BATCH = 40;

export interface JobScope {
  nodeId?: string;
  chapterId?: string;
  segmentIds?: string[];
  candidates?: { src: string; freq: number; examples: string[] }[];
  /** Created by a review action for a single segment rather than by the plan. */
  rerun?: boolean;
}

export function scopeOf(job: Pick<JobRow, 'scope'>): JobScope {
  return (job.scope ?? {}) as JobScope;
}

export function insertJob(
  db: Db,
  job: {
    bookId: string;
    lang: string;
    stage: PipelineTask;
    engine: string;
    priority: number;
    seq: number;
    scope?: JobScope;
    dependsOn?: string[];
  },
): string {
  const id = newId('jb');
  db.insert(jobs)
    .values({
      id,
      bookId: job.bookId,
      targetLang: job.lang,
      stage: job.stage,
      engine: job.engine,
      status: 'queued',
      priority: job.priority,
      seq: job.seq,
      scope: (job.scope ?? null) as Record<string, unknown> | null,
      dependsOn: job.dependsOn?.length ? job.dependsOn : null,
    })
    .run();
  return id;
}

/** Pipeline jobs of a book × language that are not cancelled. */
export function pipelineJobs(db: Db, bookId: string, lang: string): JobRow[] {
  return db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.bookId, bookId),
        eq(jobs.targetLang, lang),
        inArray(jobs.stage, PIPELINE_STAGES),
        sql`${jobs.status} <> 'cancelled'`,
      ),
    )
    .all();
}

/** Queued jobs whose dependencies all succeeded, highest priority first, then document order. */
export function runnableJobs(
  db: Db,
  where: { bookId?: string; lang?: string; engine?: string; excludeEngine?: string },
  limit = 50,
): JobRow[] {
  const conds = ["j.status = 'queued'", `j.stage IN (${PIPELINE_STAGES.map((s) => `'${s}'`).join(',')})`];
  const args: unknown[] = [];
  if (where.bookId) {
    conds.push('j.book_id = ?');
    args.push(where.bookId);
  }
  if (where.lang) {
    conds.push('j.target_lang = ?');
    args.push(where.lang);
  }
  if (where.engine) {
    conds.push('j.engine = ?');
    args.push(where.engine);
  }
  if (where.excludeEngine) {
    conds.push('j.engine <> ?');
    args.push(where.excludeEngine);
  }
  const rows = db.$client
    .prepare(
      `SELECT j.id FROM jobs j
        WHERE ${conds.join(' AND ')}
          AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(j.depends_on, '[]')) d
                            JOIN jobs p ON p.id = d.value WHERE p.status <> 'succeeded')
        ORDER BY j.priority DESC, j.seq ASC, j.created_at ASC
        LIMIT ?`,
    )
    .all(...args, limit) as { id: string }[];
  if (rows.length === 0) return [];
  const byId = new Map(
    db
      .select()
      .from(jobs)
      .where(
        inArray(
          jobs.id,
          rows.map((r) => r.id),
        ),
      )
      .all()
      .map((j) => [j.id, j]),
  );
  return rows.map((r) => byId.get(r.id)).filter((j): j is JobRow => Boolean(j));
}

export function createBriefJob(db: Db, bookId: string, lang: string, settings: TranslationSettings): string {
  return insertJob(db, {
    bookId,
    lang,
    stage: 'brief',
    engine: settings.engines.brief,
    priority: taskPriority('brief'),
    seq: 0,
  });
}

/** Glossary consolidation batches from code-found candidates; returns the number of jobs created. */
export function createGlossaryJobs(db: Db, bundle: BookBundle, lang: string, settings: TranslationSettings): number {
  const existing = new Set(
    db
      .select({ src: glossaryTerms.src })
      .from(glossaryTerms)
      .where(
        and(
          eq(glossaryTerms.tgtLang, lang),
          sql`(${glossaryTerms.bookId} = ${bundle.book.id} OR ${glossaryTerms.bookId} IS NULL)`,
        ),
      )
      .all()
      .map((g) => g.src.toLowerCase()),
  );
  const skipped = new Set(bundle.nodes.filter((n) => n.skip).map((n) => n.id));
  const texts = bundle.segments.filter((s) => needsTranslation(s) && !skipped.has(s.nodeId)).map((s) => s.src);
  const candidates = extractCandidates(texts, bundle.book.sourceLang, { exclude: existing, max: 160 });
  for (let i = 0; i < candidates.length; i += GLOSSARY_BATCH) {
    insertJob(db, {
      bookId: bundle.book.id,
      lang,
      stage: 'glossary',
      engine: settings.engines.glossary,
      priority: taskPriority('glossary'),
      seq: i,
      scope: {
        candidates: candidates.slice(i, i + GLOSSARY_BATCH).map(({ src, freq, examples }) => ({ src, freq, examples })),
      },
    });
  }
  return Math.ceil(candidates.length / GLOSSARY_BATCH);
}

export interface TranslationPlan {
  /** Per readable node: its chunks (segment ids) and edit units. */
  units: { nodeId: string; chapterId: string; chunks: string[][]; edits: string[][]; seq: number }[];
  /** Translatable segments that need no AI (already done). */
  words: number;
  segments: number;
}

function effectiveSkip(bundle: BookBundle): Set<string> {
  const byId = new Map(bundle.nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const n of bundle.nodes) {
    let cur: typeof n | undefined = n;
    while (cur) {
      if (cur.skip) {
        out.add(n.id);
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return out;
}

/** The translate/edit work for a book (also used for the estimate before starting). */
export function planTranslation(bundle: BookBundle, lang: string, settings: TranslationSettings): TranslationPlan {
  const index = createBookIndex(bundle);
  const skipped = effectiveSkip(bundle);
  const status = new Map(bundle.translations.filter((t) => t.lang === lang).map((t) => [t.segmentId, t.status]));
  const units: TranslationPlan['units'] = [];
  let words = 0;
  let count = 0;
  bundle.nodes.forEach((node, i) => {
    if (skipped.has(node.id)) return;
    const segs = (index.segmentsByNode.get(node.id) ?? []).filter(needsTranslation);
    const todo = segs.filter((s) => !DONE_STATUSES.has(status.get(s.id) ?? 'pending'));
    if (todo.length === 0) return;
    const toTranslate = todo.filter((s) => !['drafted', 'edited', 'flagged'].includes(status.get(s.id) ?? 'pending'));
    for (const s of todo) {
      count++;
      words += s.src.split(/\s+/u).length;
    }
    const chunks = chunkSegments(toTranslate, { lang: bundle.book.sourceLang, maxWords: TRANSLATE_CHUNK_WORDS }).map(
      (c) => c.map((s: SegmentRecord) => s.id),
    );
    const edits =
      settings.profile === 'economy'
        ? []
        : chunkSegments(todo, { lang: bundle.book.sourceLang, maxWords: EDIT_UNIT_WORDS }).map((c) =>
            c.map((s: SegmentRecord) => s.id),
          );
    const chapter = chapterOf(index, node.id);
    units.push({ nodeId: node.id, chapterId: chapter?.id ?? node.id, chunks, edits, seq: i * 100 });
  });
  return { units, words, segments: count };
}

/**
 * Creates translate and edit jobs for every section with remaining work (after the glossary is approved) and marks
 * the segments as queued. Translate chunks of one chapter run in order; a section's edit waits for its chunks.
 */
export function createTranslationJobs(
  db: Db,
  bookId: string,
  lang: string,
  settings: TranslationSettings,
  boosted: string[],
): number {
  const bundle = getBundle(db, bookId);
  if (!bundle) return 0;
  const plan = planTranslation(bundle, lang, settings);
  const index = createBookIndex(bundle);
  const priorityChapters = new Set(
    [...settings.priorityNodeIds, ...boosted].map((id) => chapterOf(index, id)?.id ?? id),
  );
  const lastInChapter = new Map<string, string>();
  let created = 0;
  db.transaction(() => {
    for (const unit of plan.units) {
      const prioritized = priorityChapters.has(unit.chapterId) || priorityChapters.has(unit.nodeId);
      const translateIds: string[] = [];
      unit.chunks.forEach((segmentIds, k) => {
        const prev = lastInChapter.get(unit.chapterId);
        const id = insertJob(db, {
          bookId,
          lang,
          stage: 'translate',
          engine: settings.engines.translate,
          priority: taskPriority('translate', prioritized),
          seq: unit.seq + k,
          scope: { nodeId: unit.nodeId, chapterId: unit.chapterId, segmentIds },
          ...(prev ? { dependsOn: [prev] } : {}),
        });
        lastInChapter.set(unit.chapterId, id);
        translateIds.push(id);
        created++;
      });
      unit.edits.forEach((segmentIds, k) => {
        const deps = translateIds.length
          ? translateIds
          : lastInChapter.get(unit.chapterId)
            ? [lastInChapter.get(unit.chapterId) as string]
            : [];
        insertJob(db, {
          bookId,
          lang,
          stage: 'edit',
          engine: settings.engines.edit,
          priority: taskPriority('edit', prioritized),
          seq: unit.seq + 50 + k,
          scope: { nodeId: unit.nodeId, chapterId: unit.chapterId, segmentIds },
          dependsOn: deps,
        });
        created++;
      });
      const queued = unit.chunks.flat();
      for (const segmentId of queued) {
        db.insert(translations)
          .values({ segmentId, lang, status: 'queued', engine: settings.engines.translate })
          .onConflictDoUpdate({
            target: [translations.segmentId, translations.lang],
            set: { status: 'queued', engine: settings.engines.translate },
            setWhere: sql`${translations.status} IN ('pending', 'queued')`,
          })
          .run();
      }
    }
  });
  return created;
}
