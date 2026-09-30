import type { BookBundle, TranslationRecord } from '@dozabaneh/shared';
import { useEffect } from 'react';
import { bundleKey, queryClient } from '../../data/books';
import { api, type TranslationView } from '../../lib/api';
import { useLibrary } from '../../stores/library';

/**
 * Manual edits are stored by the API since Phase 3 (SPEC §9.8). After a save the reader's bundle cache is
 * patched right away (no refetch needed) and any Phase 1 local override for the segment is dropped.
 */
export function applyServerTranslation(bookId: string, view: TranslationView): void {
  queryClient.setQueryData<BookBundle>(bundleKey(bookId), (bundle) => {
    if (!bundle) return bundle;
    const previous = bundle.translations.find((t) => t.segmentId === view.segmentId && t.lang === view.lang);
    const record: TranslationRecord = {
      segmentId: view.segmentId,
      lang: view.lang,
      text: view.text,
      status: view.status,
      engine: view.status === 'user_edited' ? 'user' : (previous?.engine ?? 'user'),
      flags: view.status === 'user_edited' ? [] : (previous?.flags ?? []),
      ...(previous?.note ? { note: previous.note } : {}),
      version: view.version,
      updatedAt: new Date().toISOString(),
    };
    return {
      ...bundle,
      translations: [...bundle.translations.filter((t) => t !== previous), record],
    };
  });
  useLibrary.getState().dropOverrides(bookId, [`${view.segmentId}|${view.lang}`]);
}

/** One-time move of edits saved in this browser during Phase 1 to the server. */
export function useMigrateLocalEdits(bookId: string | undefined): void {
  useEffect(() => {
    if (!bookId) return;
    const local = Object.values(useLibrary.getState().overrides[bookId] ?? {}).filter(
      (r) => r.status === 'user_edited',
    );
    for (const r of local) {
      void api
        .editTranslation(r.segmentId, r.lang, r.text)
        .then((res) => applyServerTranslation(bookId, res.translation))
        .catch(() => {
          // Keep the local copy; the next visit tries again.
        });
    }
  }, [bookId]);
}
