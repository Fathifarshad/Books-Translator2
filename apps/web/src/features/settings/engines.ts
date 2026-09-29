import type { AssistantEngine, BookRecord } from '@dozabaneh/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

/** Free AI providers and the assistant engine (Settings → «موتور هوش مصنوعی»). */
export const providersKey = ['providers'] as const;

export function useProviders() {
  return useQuery({ queryKey: providersKey, queryFn: api.providers, staleTime: 15_000, retry: false });
}

/** Engine of the tutor, summaries and quizzes; the offline mock until a provider is chosen (or while loading). */
export function useAssistantEngine(): AssistantEngine {
  return useProviders().data?.assistant.engine ?? 'mock';
}

/** Book info sent with assistant requests (title in the target language when there is one). */
export function assistBook(book: BookRecord, targetLang: string): { title: string; authors: string[] } {
  return { title: book.titles[targetLang] ?? book.titles[book.sourceLang] ?? '', authors: book.authors };
}
