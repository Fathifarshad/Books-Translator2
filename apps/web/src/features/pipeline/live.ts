import type { BookRecord } from '@dozabaneh/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { booksKey, bundleKey } from '../../data/books';
import { api, subscribeBookEvents } from '../../lib/api';

export const pipelineKey = (bookId: string, lang: string) => ['pipeline', bookId, lang] as const;
export const glossaryKey = (bookId: string, lang: string) => ['glossary', bookId, lang] as const;
export const reviewKey = (bookId: string, lang: string, filter: string) => ['review', bookId, lang, filter] as const;

/** The target language a book is (or will be) translated into. */
export function targetOf(book: Pick<BookRecord, 'targetLangs' | 'sourceLang'>): string {
  return book.targetLangs[0] ?? (book.sourceLang === 'fa' ? 'en' : 'fa');
}

export function usePipeline(bookId: string, lang: string | undefined) {
  return useQuery({
    queryKey: pipelineKey(bookId, lang ?? ''),
    queryFn: () => api.pipeline(bookId, lang as string),
    enabled: Boolean(bookId && lang),
  });
}

/**
 * Live updates for one book over SSE (SPEC §10.3-7, §9.1 progressive availability): pipeline, glossary, review and
 * the reader's bundle are refreshed shortly after the server (or the agent CLI) changes them.
 */
export function useBookLiveUpdates(bookId: string | undefined): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!bookId) return;
    const pending = new Map<string, readonly unknown[]>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      for (const key of pending.values()) void queryClient.invalidateQueries({ queryKey: key });
      pending.clear();
    };
    const schedule = (...keys: (readonly unknown[])[]) => {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      timer ??= setTimeout(flush, 700);
    };
    const unsubscribe = subscribeBookEvents(bookId, (e) => {
      switch (e.type) {
        case 'segment':
          schedule(bundleKey(bookId), ['review', bookId], ['pipeline', bookId]);
          break;
        case 'pipeline':
        case 'agent':
          schedule(['pipeline', bookId], booksKey);
          break;
        case 'glossary':
          schedule(['glossary', bookId], ['pipeline', bookId], bundleKey(bookId));
          break;
        case 'book':
          schedule(['book', bookId], ['pipeline', bookId], booksKey, bundleKey(bookId));
          break;
        default:
          break;
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [bookId, queryClient]);
}
