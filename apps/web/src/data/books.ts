import { type BookIndex, createBookIndex, translationCounter } from '@dozabaneh/core';
import type { BookBundle, TranslationRecord } from '@dozabaneh/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../lib/api';
import { useLibrary } from '../stores/library';

/** Shared query client (also read synchronously by the tutor runner). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 } },
});

export const bundleKey = (bookId: string) => ['bundle', bookId] as const;
export const booksKey = ['books'] as const;

/** Library list from the API (SPEC §13.1). */
export function useBooks() {
  return useQuery({ queryKey: booksKey, queryFn: async () => (await api.books()).books });
}

/** Whole book for the reader (nodes, segments, translations, glossary). */
export function useBookBundle(bookId: string | undefined) {
  return useQuery({
    queryKey: bundleKey(bookId ?? ''),
    queryFn: () => api.bundle(bookId as string),
    enabled: Boolean(bookId),
  });
}

const EMPTY: Record<string, TranslationRecord> = {};

/** Book index with local overrides (user edits, live translation updates) applied. */
export function useBookIndex(bundle: BookBundle | undefined): BookIndex | undefined {
  const overrides = useLibrary((s) => (bundle ? (s.overrides[bundle.book.id] ?? EMPTY) : EMPTY));
  return useMemo(() => (bundle ? createBookIndex(bundle, Object.values(overrides)) : undefined), [bundle, overrides]);
}

/** Synchronous index access for non-React code (tutor runner): from the query cache. */
export function currentBookIndex(bookId: string): BookIndex | undefined {
  const bundle = queryClient.getQueryData<BookBundle>(bundleKey(bookId));
  if (!bundle) return undefined;
  const overrides = useLibrary.getState().overrides[bookId] ?? EMPTY;
  return createBookIndex(bundle, Object.values(overrides));
}

export function targetLangOf(index: BookIndex): string {
  return index.book.targetLangs[0] ?? index.book.sourceLang;
}

export function progressRatio(index: BookIndex): { ratio: number; done: number; total: number } {
  const { done, total } = translationCounter(index, targetLangOf(index));
  return { ratio: total ? done / total : 0, done, total };
}
