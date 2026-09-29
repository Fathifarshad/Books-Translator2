import { normalizeForSearch, stripMarkup } from '@dozabaneh/text';
import { type BookIndex, visibleTranslation } from '../book';

const STOP_WORDS = new Set(
  [
    'the a an and or of to in on is are was be it this that what why how for with as by at from we you can does do not its than',
    'و در به از که این آن را با است برای یک چه چرا هم یا اما ما تو من می شود کند بخش یعنی چیست چیه توضیح بده برایم تکه',
  ]
    .join(' ')
    .split(' ')
    .map((w) => normalizeForSearch(w)),
);

export function keywords(text: string): string[] {
  return normalizeForSearch(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

interface Doc {
  segmentId: string;
  nodeId: string;
  terms: Map<string, number>;
  length: number;
}

export interface Retriever {
  search(
    query: string,
    k: number,
    exclude?: (segmentId: string, nodeId: string) => boolean,
  ): { segmentId: string; nodeId: string; score: number }[];
}

/** BM25 over both languages of every segment (SPEC §12.4 — FTS5 BM25 on the server later). */
export function createRetriever(index: BookIndex, targetLang: string): Retriever {
  const docs: Doc[] = [];
  for (const seg of index.segmentById.values()) {
    if (seg.type === 'heading' || !seg.src) continue;
    const text = `${stripMarkup(seg.src)} ${stripMarkup(visibleTranslation(index, seg.id, targetLang) ?? '')}`;
    const words = keywords(text);
    const terms = new Map<string, number>();
    for (const w of words) terms.set(w, (terms.get(w) ?? 0) + 1);
    docs.push({ segmentId: seg.id, nodeId: seg.nodeId, terms, length: words.length });
  }
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, docs.length);
  const k1 = 1.2;
  const b = 0.75;

  return {
    search(query, k, exclude) {
      const qTerms = [...new Set(keywords(query))];
      if (qTerms.length === 0) return [];
      const scored = docs
        .filter((d) => !exclude?.(d.segmentId, d.nodeId))
        .map((d) => {
          let score = 0;
          for (const t of qTerms) {
            const tf = d.terms.get(t) ?? 0;
            if (!tf) continue;
            const n = df.get(t) ?? 0;
            const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
            score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avgLen)));
          }
          return { segmentId: d.segmentId, nodeId: d.nodeId, score };
        })
        .filter((r) => r.score > 0)
        .sort((x, y) => y.score - x.score);
      return scored.slice(0, k);
    },
  };
}
