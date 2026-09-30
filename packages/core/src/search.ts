import { findNormalized, normalizeForSearch, stripMarkup, type TextRange } from '@dozabaneh/text';
import { type BookIndex, glossaryFor, visibleTranslation } from './book';

export type SearchSide = 'source' | 'target';

export interface SearchHit {
  segmentId: string;
  side: SearchSide;
  text: string;
  ranges: TextRange[];
}

export interface SearchGroup {
  nodeId: string;
  hits: SearchHit[];
}

export interface GlossaryHit {
  termId: string;
  src: string;
  tgt: string;
  definition?: string;
}

export interface SearchResults {
  groups: SearchGroup[];
  glossary: GlossaryHit[];
  total: number;
}

export interface SearchOptions {
  targetLang: string;
  sides?: SearchSide[];
  glossary?: boolean;
  limit?: number;
}

/**
 * Client-side search over one book (Phase 1). Phase 2 moves this to SQLite FTS5 on the server with the
 * same normalization and the same result shape.
 */
export function searchBook(index: BookIndex, query: string, opts: SearchOptions): SearchResults {
  const q = normalizeForSearch(query);
  const sides = opts.sides ?? ['target', 'source'];
  const limit = opts.limit ?? 100;
  const result: SearchResults = { groups: [], glossary: [], total: 0 };
  if (q.length < 2) return result;

  for (const node of index.readingOrder) {
    const hits: SearchHit[] = [];
    for (const seg of index.segmentsByNode.get(node.id) ?? []) {
      if (sides.includes('target')) {
        const tgt = visibleTranslation(index, seg.id, opts.targetLang);
        if (tgt) {
          const text = stripMarkup(tgt);
          const ranges = findNormalized(text, query);
          if (ranges.length) hits.push({ segmentId: seg.id, side: 'target', text, ranges });
        }
      }
      if (sides.includes('source') && seg.src) {
        const text = stripMarkup(seg.src);
        const ranges = findNormalized(text, query);
        if (ranges.length) hits.push({ segmentId: seg.id, side: 'source', text, ranges });
      }
    }
    if (hits.length) {
      result.groups.push({ nodeId: node.id, hits });
      result.total += hits.length;
      if (result.total >= limit) break;
    }
  }

  if (opts.glossary !== false) {
    for (const g of glossaryFor(index, opts.targetLang)) {
      const hay = normalizeForSearch(`${g.src} ${g.tgt} ${g.alternatives.join(' ')}`);
      if (hay.includes(q)) {
        result.glossary.push({
          termId: g.id,
          src: g.src,
          tgt: g.tgt,
          ...(g.definition ? { definition: g.definition } : {}),
        });
      }
    }
  }
  return result;
}
