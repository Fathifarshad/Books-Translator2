import { normalizeForSearch, stripMarkup } from '@dozabaneh/text';
import type { Db } from '../db/client';

/** Incremental FTS update for changed translations (the full rebuild stays in `reindexBook`). */
export function reindexSegments(db: Db, bookId: string, segmentIds: string[], lang: string): void {
  if (segmentIds.length === 0) return;
  const sqlite = db.$client;
  const del = sqlite.prepare('DELETE FROM translations_fts WHERE segment_id = ? AND lang = ?');
  const ins = sqlite.prepare('INSERT INTO translations_fts (tgt_norm, segment_id, book_id, lang) VALUES (?, ?, ?, ?)');
  const get = sqlite.prepare(
    `SELECT COALESCE(final, draft) AS text, status FROM translations WHERE segment_id = ? AND lang = ?`,
  );
  sqlite.transaction(() => {
    for (const id of segmentIds) {
      del.run(id, lang);
      const row = get.get(id, lang) as { text: string | null; status: string } | undefined;
      if (row?.text && !['pending', 'queued', 'skipped'].includes(row.status)) {
        ins.run(normalizeForSearch(stripMarkup(row.text)), id, bookId, lang);
      }
    }
  })();
}
