-- Full-text search (SPEC §7.1, §11.9): fed with search-normalized text (packages/text normalizeForSearch).
CREATE VIRTUAL TABLE `segments_fts` USING fts5(
  `src_norm`,
  `segment_id` UNINDEXED,
  `book_id` UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `translations_fts` USING fts5(
  `tgt_norm`,
  `segment_id` UNINDEXED,
  `book_id` UNINDEXED,
  `lang` UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
