import { createHash } from 'node:crypto';
import { createBookIndex, documentOrder, type Structure } from '@dozabaneh/core';
import type { IngestResult } from '@dozabaneh/pdf';
import type {
  BookBundle,
  BookRecord,
  GlossaryTermRecord,
  SegmentRecord,
  TocNodeRecord,
  TranslationRecord,
} from '@dozabaneh/shared';
import { normalizeForSearch, stripMarkup } from '@dozabaneh/text';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Db } from './client';
import { books, bookTargets, glossaryTerms, segments, tocNodes, translations, users } from './schema';

export const LOCAL_USER = 'us_local';

export const newId = (prefix: string) => `${prefix}_${ulid().toLowerCase()}`;
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const words = (s: string) => stripMarkup(s).match(/\S+/g)?.length ?? 0;

export function ensureLocalUser(db: Db): string {
  db.insert(users).values({ id: LOCAL_USER, name: 'Local user' }).onConflictDoNothing().run();
  return LOCAL_USER;
}

type BookRow = typeof books.$inferSelect;
type NodeRow = typeof tocNodes.$inferSelect;
type SegmentRow = typeof segments.$inferSelect;
type TranslationRow = typeof translations.$inferSelect;

export function toBookRecord(row: BookRow, targets: string[]): BookRecord {
  return {
    id: row.id,
    sourceLang: row.sourceLang,
    targetLangs: targets,
    titles: row.titles,
    ...(row.subtitles ? { subtitles: row.subtitles } : {}),
    authors: row.authors,
    ...(row.publisher ? { publisher: row.publisher } : {}),
    ...(row.year ? { year: row.year } : {}),
    pageCount: row.pageCount,
    pageLabels: row.pageLabels,
    status: row.status,
    ...(row.brief ? { brief: row.brief } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toNode(r: NodeRow): TocNodeRecord {
  return {
    id: r.id,
    bookId: r.bookId,
    parentId: r.parentId,
    ord: r.ord,
    depth: r.depth,
    kind: r.kind,
    ...(r.numberLabel ? { numberLabel: r.numberLabel } : {}),
    ...(r.headingSegmentId ? { headingSegmentId: r.headingSegmentId } : {}),
    ...(r.title ? { title: r.title } : {}),
    pageStart: r.pageStart,
    pageEnd: r.pageEnd,
    skip: r.skip,
    origin: r.origin,
  };
}

function toSegment(r: SegmentRow): SegmentRecord {
  return {
    id: r.id,
    bookId: r.bookId,
    nodeId: r.nodeId,
    ord: r.ord,
    type: r.type,
    src: r.src,
    page: r.page,
    pageEnd: r.pageEnd,
    meta: r.meta as SegmentRecord['meta'],
    translatable: r.translatable,
  };
}

function toTranslation(r: TranslationRow): TranslationRecord {
  return {
    segmentId: r.segmentId,
    lang: r.lang,
    text: r.final ?? r.draft ?? '',
    status: r.status,
    engine: r.engine,
    ...(r.note ? { note: r.note } : {}),
    flags: r.flags as TranslationRecord['flags'],
    ...(r.confidence !== null ? { confidence: r.confidence } : {}),
    version: r.version,
    updatedAt: r.updatedAt,
  };
}

export function targetsOf(db: Db, bookId: string): string[] {
  return db
    .select({ lang: bookTargets.lang })
    .from(bookTargets)
    .where(eq(bookTargets.bookId, bookId))
    .all()
    .map((r) => r.lang);
}

export function getBookRow(db: Db, bookId: string): BookRow | undefined {
  return db.select().from(books).where(eq(books.id, bookId)).get();
}

/** Everything the reader needs for one book (SPEC §17 — the web client builds its index from this). */
export function getBundle(db: Db, bookId: string): BookBundle | undefined {
  const row = getBookRow(db, bookId);
  if (!row) return undefined;
  // Document (pre-)order: `ord` is only the position among siblings.
  const nodes = documentOrder(db.select().from(tocNodes).where(eq(tocNodes.bookId, bookId)).all().map(toNode));
  const segs = db
    .select()
    .from(segments)
    .where(eq(segments.bookId, bookId))
    .orderBy(asc(segments.ord))
    .all()
    .map(toSegment);
  const segIds = segs.map((s) => s.id);
  const trans: TranslationRecord[] = [];
  for (let i = 0; i < segIds.length; i += 500) {
    trans.push(
      ...db
        .select()
        .from(translations)
        .where(inArray(translations.segmentId, segIds.slice(i, i + 500)))
        .all()
        .map(toTranslation),
    );
  }
  const glossary = db
    .select()
    .from(glossaryTerms)
    .where(eq(glossaryTerms.bookId, bookId))
    .all()
    .map(
      (g): GlossaryTermRecord => ({
        id: g.id,
        bookId: g.bookId,
        srcLang: g.srcLang,
        tgtLang: g.tgtLang,
        src: g.src,
        tgt: g.tgt,
        alternatives: g.alternatives,
        ...(g.definition ? { definition: g.definition } : {}),
        kind: g.kind,
        parenthetical: g.parenthetical,
        status: g.status,
      }),
    );
  return { book: toBookRecord(row, targetsOf(db, bookId)), nodes, segments: segs, translations: trans, glossary };
}

export interface BookSummary {
  book: BookRecord;
  counter: { done: number; total: number };
  /** Number of readable sections (for reading-progress percentages on the client). */
  readable: number;
  fileName?: string;
  error?: string;
}

export function listBooks(db: Db, ownerId: string): BookSummary[] {
  const rows = db.select().from(books).where(eq(books.ownerId, ownerId)).all();
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((row) => {
      const targets = db.select().from(bookTargets).where(eq(bookTargets.bookId, row.id)).all();
      const t = targets[0];
      const bundle = getBundle(db, row.id);
      return {
        readable: bundle ? createBookIndex(bundle).readingOrder.length : 0,
        book: toBookRecord(
          row,
          targets.map((x) => x.lang),
        ),
        counter: { done: t?.doneCount ?? 0, total: t?.totalCount ?? 0 },
        ...(row.fileName ? { fileName: row.fileName } : {}),
        ...(row.error ? { error: row.error } : {}),
      };
    });
}

/** Recomputes the translated counter (final + user_edited of translatable, non-skipped segments). */
export function refreshCounters(db: Db, bookId: string): void {
  const sqlite = db.$client;
  for (const { lang } of db
    .select({ lang: bookTargets.lang })
    .from(bookTargets)
    .where(eq(bookTargets.bookId, bookId))
    .all()) {
    const row = sqlite
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN t.status IN ('final','user_edited') THEN 1 ELSE 0 END) AS done
           FROM segments s
           JOIN toc_nodes n ON n.id = s.node_id
           LEFT JOIN translations t ON t.segment_id = s.id AND t.lang = ?
          WHERE s.book_id = ? AND s.translatable = 1 AND n.skip = 0 AND (t.status IS NULL OR t.status <> 'skipped')`,
      )
      .get(lang, bookId) as { total: number; done: number | null };
    db.update(bookTargets)
      .set({ totalCount: row.total, doneCount: row.done ?? 0 })
      .where(and(eq(bookTargets.bookId, bookId), eq(bookTargets.lang, lang)))
      .run();
  }
}

/** Rebuilds the FTS rows of one book from search-normalized text (SPEC §9.5-6). */
export function reindexBook(db: Db, bookId: string): void {
  const sqlite = db.$client;
  sqlite.prepare('DELETE FROM segments_fts WHERE book_id = ?').run(bookId);
  sqlite.prepare('DELETE FROM translations_fts WHERE book_id = ?').run(bookId);
  const insSrc = sqlite.prepare('INSERT INTO segments_fts (src_norm, segment_id, book_id) VALUES (?, ?, ?)');
  const insTgt = sqlite.prepare(
    'INSERT INTO translations_fts (tgt_norm, segment_id, book_id, lang) VALUES (?, ?, ?, ?)',
  );
  for (const s of db
    .select({ id: segments.id, src: segments.src })
    .from(segments)
    .where(eq(segments.bookId, bookId))
    .all()) {
    if (s.src) insSrc.run(normalizeForSearch(stripMarkup(s.src)), s.id, bookId);
  }
  const rows = sqlite
    .prepare(
      `SELECT t.segment_id AS id, t.lang AS lang, COALESCE(t.final, t.draft) AS text
         FROM translations t JOIN segments s ON s.id = t.segment_id
        WHERE s.book_id = ? AND t.status NOT IN ('pending','queued','skipped')`,
    )
    .all(bookId) as { id: string; lang: string; text: string | null }[];
  for (const r of rows) if (r.text) insTgt.run(normalizeForSearch(stripMarkup(r.text)), r.id, bookId, r.lang);
}

/** Replaces a book's structure with an ingestion result (idempotent: re-ingesting starts clean). */
export function saveIngestion(db: Db, bookId: string, result: IngestResult, fallbackTitle: string): void {
  db.transaction((tx) => {
    tx.delete(segments).where(eq(segments.bookId, bookId)).run();
    tx.delete(tocNodes).where(eq(tocNodes.bookId, bookId)).run();
    const nodeIds = new Map(result.nodes.map((n) => [n.key, newId('nd')]));
    const segIds = result.segments.map(() => newId('sg'));
    const ordByNode = new Map<string, number>();
    const childOrd = new Map<string | null, number>();
    for (const n of result.nodes) {
      const parentId = n.parentKey ? (nodeIds.get(n.parentKey) ?? null) : null;
      const ord = childOrd.get(parentId) ?? 0;
      childOrd.set(parentId, ord + 1);
      tx.insert(tocNodes)
        .values({
          id: nodeIds.get(n.key) as string,
          bookId,
          parentId,
          ord,
          depth: n.depth,
          kind: n.kind,
          numberLabel: n.numberLabel ?? null,
          headingSegmentId: n.headingIndex !== undefined ? (segIds[n.headingIndex] ?? null) : null,
          title: n.headingIndex === undefined ? n.title : null,
          pageStart: n.pageStart,
          pageEnd: n.pageEnd,
          skip: n.skip,
          origin: n.origin,
        })
        .run();
    }
    result.segments.forEach((s, i) => {
      const nodeId = nodeIds.get(s.nodeKey) as string;
      const ord = ordByNode.get(nodeId) ?? 0;
      ordByNode.set(nodeId, ord + 1);
      const { bbox, ...meta } = s.meta;
      tx.insert(segments)
        .values({
          id: segIds[i] as string,
          bookId,
          nodeId,
          ord,
          type: s.type,
          src: s.src,
          page: s.page,
          pageEnd: s.pageEnd,
          bbox: bbox ?? null,
          meta,
          srcHash: hash(s.src),
          wordCount: words(s.src),
          translatable: s.translatable,
        })
        .run();
    });
    const title = result.meta.title?.trim() || fallbackTitle;
    tx.update(books)
      .set({
        titles: { en: title },
        authors: result.meta.authors,
        pageCount: result.report.stats.pages,
        pageLabels: result.pageLabels,
        report: result.report as unknown as Record<string, unknown>,
        status: 'structure_review',
        error: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(books.id, bookId))
      .run();
  });
  reindexBook(db, bookId);
  refreshCounters(db, bookId);
}

export function loadStructure(db: Db, bookId: string): Structure {
  const bundle = getBundle(db, bookId);
  return { nodes: bundle?.nodes ?? [], segments: bundle?.segments ?? [] };
}

/** Writes an edited structure back (nodes replaced; segments updated in place — ids never change). */
export function saveStructure(db: Db, bookId: string, next: Structure): void {
  db.transaction((tx) => {
    tx.delete(tocNodes).where(eq(tocNodes.bookId, bookId)).run();
    for (const n of documentOrder(next.nodes)) {
      tx.insert(tocNodes)
        .values({
          id: n.id,
          bookId,
          parentId: n.parentId,
          ord: n.ord,
          depth: n.depth,
          kind: n.kind,
          numberLabel: n.numberLabel ?? null,
          headingSegmentId: n.headingSegmentId ?? null,
          title: n.title ?? null,
          pageStart: n.pageStart,
          pageEnd: n.pageEnd,
          skip: n.skip,
          origin: n.origin,
        })
        .run();
    }
    for (const s of next.segments) {
      tx.update(segments)
        .set({ nodeId: s.nodeId, ord: s.ord, type: s.type, src: s.src, srcHash: hash(s.src), wordCount: words(s.src) })
        .where(eq(segments.id, s.id))
        .run();
    }
    tx.update(books).set({ updatedAt: new Date().toISOString() }).where(eq(books.id, bookId)).run();
  });
  reindexBook(db, bookId);
  refreshCounters(db, bookId);
}

/** Inserts the original sample book (Phase 1 data) with its stable ids, once. */
export function seedBundle(db: Db, bundle: BookBundle, ownerId: string): boolean {
  if (getBookRow(db, bundle.book.id)) return false;
  const b = bundle.book;
  db.transaction((tx) => {
    tx.insert(books)
      .values({
        id: b.id,
        ownerId,
        sourceLang: b.sourceLang,
        titles: b.titles,
        subtitles: b.subtitles ?? null,
        authors: b.authors,
        publisher: b.publisher ?? null,
        year: b.year ?? null,
        pageCount: b.pageCount,
        pageLabels: b.pageLabels,
        brief: b.brief ?? null,
        status: b.status,
        settings: { sample: true },
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })
      .run();
    for (const lang of b.targetLangs) tx.insert(bookTargets).values({ bookId: b.id, lang }).run();
    for (const n of bundle.nodes) {
      tx.insert(tocNodes)
        .values({
          id: n.id,
          bookId: b.id,
          parentId: n.parentId,
          ord: n.ord,
          depth: n.depth,
          kind: n.kind,
          numberLabel: n.numberLabel ?? null,
          headingSegmentId: n.headingSegmentId ?? null,
          title: n.title ?? null,
          pageStart: n.pageStart,
          pageEnd: n.pageEnd,
          skip: n.skip,
          origin: n.origin,
        })
        .run();
    }
    for (const s of bundle.segments) {
      tx.insert(segments)
        .values({
          id: s.id,
          bookId: b.id,
          nodeId: s.nodeId,
          ord: s.ord,
          type: s.type,
          src: s.src,
          page: s.page,
          pageEnd: s.pageEnd,
          meta: s.meta as Record<string, unknown>,
          srcHash: hash(s.src),
          wordCount: words(s.src),
          translatable: s.translatable,
        })
        .run();
    }
    for (const t of bundle.translations) {
      tx.insert(translations)
        .values({
          segmentId: t.segmentId,
          lang: t.lang,
          final: t.text,
          status: t.status,
          engine: t.engine,
          note: t.note ?? null,
          flags: t.flags,
          confidence: t.confidence ?? null,
          version: t.version,
          updatedAt: t.updatedAt,
        })
        .run();
    }
    for (const g of bundle.glossary) {
      tx.insert(glossaryTerms)
        .values({
          id: g.id,
          bookId: b.id,
          srcLang: g.srcLang,
          tgtLang: g.tgtLang,
          src: g.src,
          tgt: g.tgt,
          alternatives: g.alternatives,
          definition: g.definition ?? null,
          kind: g.kind,
          parenthetical: g.parenthetical,
          status: g.status,
        })
        .run();
    }
  });
  reindexBook(db, b.id);
  refreshCounters(db, b.id);
  return true;
}
