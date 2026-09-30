import { createBookIndex, type SearchResults, type SearchSide, searchBook } from '@dozabaneh/core';
import { API_PREFIX } from '@dozabaneh/shared';
import { findNormalized, normalizeForSearch } from '@dozabaneh/text';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import { getBundle } from '../db/repo';
import { httpError } from './errors';

/** Builds an FTS5 query: every token as a quoted prefix term (normalized like the indexed text). */
export function ftsQuery(q: string): string | null {
  const tokens = normalizeForSearch(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '')}"*`);
  return tokens.length ? tokens.join(' ') : null;
}

/**
 * Full-text search (SPEC §11.9): FTS5 finds candidate segments in both languages; ranges for highlighting
 * are computed on the original text with the same normalization; results are grouped by section in reading
 * order, with glossary hits.
 */
export async function searchRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { db } = ctx;
  app.get<{ Params: { id: string }; Querystring: { q?: string; sides?: string; glossary?: string; lang?: string } }>(
    `${API_PREFIX}/books/:id/search`,
    async (req): Promise<SearchResults> => {
      const bundle = getBundle(db, req.params.id);
      if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
      const q = (req.query.q ?? '').slice(0, 200);
      const lang = req.query.lang ?? bundle.book.targetLangs[0] ?? 'fa';
      const sides = (req.query.sides ?? 'target,source')
        .split(',')
        .filter((s): s is SearchSide => s === 'target' || s === 'source');
      const empty: SearchResults = { groups: [], glossary: [], total: 0 };
      const match = ftsQuery(q);
      if (!match || normalizeForSearch(q).length < 2) return empty;

      const sqlite = db.$client;
      const candidates = new Set<string>();
      if (sides.includes('source')) {
        for (const r of sqlite
          .prepare(
            'SELECT segment_id FROM segments_fts WHERE segments_fts MATCH ? AND book_id = ? ORDER BY rank LIMIT 500',
          )
          .all(match, bundle.book.id) as { segment_id: string }[]) {
          candidates.add(r.segment_id);
        }
      }
      if (sides.includes('target')) {
        for (const r of sqlite
          .prepare(
            'SELECT segment_id FROM translations_fts WHERE translations_fts MATCH ? AND book_id = ? AND lang = ? ORDER BY rank LIMIT 500',
          )
          .all(match, bundle.book.id, lang) as { segment_id: string }[]) {
          candidates.add(r.segment_id);
        }
      }
      // Exact ranges/grouping reuse the shared implementation on the candidate subset.
      const index = createBookIndex({
        ...bundle,
        segments: bundle.segments.filter((s) => candidates.has(s.id) || s.type === 'heading'),
      });
      const results = searchBook(index, q, {
        targetLang: lang,
        sides,
        glossary: req.query.glossary !== '0',
        limit: 100,
      });
      results.groups = results.groups
        .map((g) => ({
          ...g,
          hits: g.hits.filter((h) => candidates.has(h.segmentId) && findNormalized(h.text, q).length > 0),
        }))
        .filter((g) => g.hits.length > 0);
      results.total = results.groups.reduce((n, g) => n + g.hits.length, 0);
      return results;
    },
  );
}
