import type { SearchResults, SearchSide, StructureOp } from '@dozabaneh/core';
import { API_PREFIX, type BookBundle, type BookRecord } from '@dozabaneh/shared';

/**
 * Typed API client. The base URL is configurable (VITE_API_URL) for the mobile app; in development the Vite
 * server proxies /api to the local API, so the default is same-origin.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const apiUrl = (path: string) => `${API_BASE}${API_PREFIX}${path}`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK');
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: { code: string; details?: Record<string, unknown> } };
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'UNKNOWN', body.error?.details ?? {});
  return body as T;
}

export interface BookSummary {
  book: BookRecord;
  counter: { done: number; total: number };
  readable: number;
  fileName?: string;
  error?: string;
}

export interface ExtractionReport {
  stats: {
    pages: number;
    pagesWithoutText: number;
    words: number;
    chapters: number;
    sections: number;
    segments: number;
    mergedContinuations: number;
    dehyphenated: number;
    removedHeaderFooterLines: number;
    paragraphs: number;
    suspectedBreaks: number;
    suspectedBreakRatio: number;
  };
  structureSource: 'outline' | 'contents' | 'headings';
  warnings: { code: string; message: string; pages?: number[] }[];
}

export interface BookDetail {
  book: BookRecord;
  fileName?: string | null;
  error?: string | null;
  ingest: { status: string; progress?: { done: number; total: number } | null; error?: string | null } | null;
}

export const api = {
  health: () => request<{ status: string; version: string }>('/health'),
  books: () => request<{ books: BookSummary[] }>('/books'),
  book: (id: string) => request<BookDetail>(`/books/${id}`),
  bundle: (id: string) => request<BookBundle>(`/books/${id}/bundle`),
  report: (id: string) =>
    request<{ report: ExtractionReport | null; status: string; error: string | null }>(`/books/${id}/report`),
  deleteBook: (id: string) => request<void>(`/books/${id}`, { method: 'DELETE' }),
  structure: (id: string, op: Omit<StructureOp, 'newNodeId'> | { op: 'confirm' }) =>
    request<{ bundle?: BookBundle; status?: string }>(`/books/${id}/structure`, {
      method: 'PATCH',
      body: JSON.stringify(op),
    }),
  search: (id: string, q: string, o: { sides: SearchSide[]; glossary: boolean; lang: string }) =>
    request<SearchResults>(
      `/books/${id}/search?${new URLSearchParams({ q, sides: o.sides.join(','), glossary: o.glossary ? '1' : '0', lang: o.lang })}`,
    ),
};

/** Upload with progress (XHR, since fetch has no upload progress events). */
export function uploadBook(file: File, onProgress: (ratio: number) => void): Promise<{ bookId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/books'));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK'));
    xhr.onload = () => {
      let body: { bookId?: string; error?: { code: string; details?: Record<string, unknown> } } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.bookId) resolve({ bookId: body.bookId });
      else reject(new ApiError(xhr.status, body.error?.code ?? 'UNKNOWN', body.error?.details ?? {}));
    };
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

export type BookEvent =
  | { type: 'progress'; stage: string; done: number; total: number }
  | { type: 'job'; jobId: string; stage: string; status: string; error?: string }
  | { type: 'book'; status: string };

/** Live updates for one book over SSE; reconnects automatically (EventSource). */
export function subscribeBookEvents(bookId: string, onEvent: (e: BookEvent) => void): () => void {
  const source = new EventSource(apiUrl(`/books/${bookId}/events`));
  const handler = (m: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(m.data) as BookEvent);
    } catch {
      // ignore malformed events
    }
  };
  for (const type of ['progress', 'job', 'book']) source.addEventListener(type, handler as EventListener);
  return () => source.close();
}
