import type { SearchResults, SearchSide, StructureOp } from '@dozabaneh/core';
import {
  API_PREFIX,
  type AssistantEngine,
  type BookBundle,
  type BookRecord,
  type ChatEvent,
  ChatEventSchema,
  type GlossaryKind,
  type ParentheticalPolicy,
  type PipelineEstimate,
  type PipelineStatus,
  type ProviderId,
  type ProviderModelInfo,
  type ProviderSettingsResponse,
  type ProviderTestResult,
  type ProviderUpdate,
  type ProviderView,
  type QaFlag,
  type QuizRequest,
  type QuizResult,
  type SummaryRequest,
  type TranslationSettings,
  type TranslationStatus,
  type TutorEngineInput,
} from '@dozabaneh/shared';

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
  /** Agent batches waiting for Claude Code (pending + leased). */
  agentPending?: number;
  fileName?: string;
  error?: string;
}

export interface GlossaryTermRow {
  id: string;
  bookId: string | null;
  srcLang: string;
  tgtLang: string;
  src: string;
  tgt: string;
  alternatives: string[];
  definition: string | null;
  kind: GlossaryKind;
  parenthetical: ParentheticalPolicy;
  status: 'proposed' | 'approved' | 'locked';
  occurrences: number;
  notes: string | null;
  confidence: number | null;
}

export type GlossaryTermInput = Partial<
  Pick<GlossaryTermRow, 'src' | 'tgt' | 'alternatives' | 'definition' | 'kind' | 'parenthetical' | 'status' | 'notes'>
>;

export interface RevisionRow {
  id: string;
  segmentId: string;
  lang: string;
  before: string | null;
  after: string;
  actor: 'engine' | 'user';
  reason: string | null;
  createdAt: string;
}

export interface TranslationView {
  segmentId: string;
  lang: string;
  text: string;
  status: TranslationStatus;
  version: number;
  suggestion: string | null;
}

export interface ReviewItem {
  segmentId: string;
  nodeId: string;
  location: string[];
  type: string;
  src: string;
  draft: string | null;
  final: string | null;
  status: TranslationStatus;
  flags: QaFlag[];
  confidence: number | null;
  note: string | null;
  suggestion: string | null;
  lastChange: { before: string | null; after: string; reason: string | null } | null;
}

export type ReviewAction = 'approve' | 'reject' | 'rerun' | 'accept_suggestion' | 'dismiss_suggestion';

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
  patchBook: (id: string, body: { titles?: Record<string, string>; brief?: Record<string, string> }) =>
    request<{ book: BookRecord }>(`/books/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Pipeline (SPEC §13.3)
  pipeline: (id: string, lang: string) =>
    request<PipelineStatus>(`/books/${id}/pipeline?lang=${encodeURIComponent(lang)}`),
  estimate: (id: string, lang: string, settings: Partial<TranslationSettings>) =>
    request<PipelineEstimate>(`/books/${id}/pipeline/estimate`, {
      method: 'POST',
      body: JSON.stringify({ lang, settings }),
    }),
  startPipeline: (id: string, lang: string, settings: Partial<TranslationSettings>) =>
    request<PipelineStatus>(`/books/${id}/pipeline/start`, {
      method: 'POST',
      body: JSON.stringify({ lang, settings }),
    }),
  pipelineAction: (id: string, action: 'pause' | 'resume' | 'cancel', lang: string) =>
    request<PipelineStatus>(`/books/${id}/pipeline/${action}`, { method: 'POST', body: JSON.stringify({ lang }) }),
  prioritize: (id: string, nodeId: string, lang: string) =>
    request<{ moved: number }>(`/books/${id}/priority`, { method: 'POST', body: JSON.stringify({ nodeId, lang }) }),
  retryJob: (id: string, jobId: string) =>
    request<{ ok: boolean }>(`/books/${id}/jobs/${jobId}/retry`, { method: 'POST' }),

  // Glossary (SPEC §13.4)
  glossary: (id: string, lang: string) =>
    request<{ terms: GlossaryTermRow[] }>(`/books/${id}/glossary?lang=${encodeURIComponent(lang)}`),
  createTerm: (id: string, lang: string, term: GlossaryTermInput & { src: string; tgt: string }) =>
    request<{ term: GlossaryTermRow }>(`/books/${id}/glossary`, {
      method: 'POST',
      body: JSON.stringify({ lang, ...term }),
    }),
  updateTerm: (id: string, termId: string, patch: GlossaryTermInput) =>
    request<{ term: GlossaryTermRow; changedEquivalent: boolean }>(`/books/${id}/glossary/${termId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTerm: (id: string, termId: string) => request<void>(`/books/${id}/glossary/${termId}`, { method: 'DELETE' }),
  approveGlossary: (id: string, lang: string, ids?: string[]) =>
    request<{ approved: number }>(`/books/${id}/glossary/approve`, {
      method: 'POST',
      body: JSON.stringify(ids ? { lang, ids } : { lang }),
    }),
  applyTerm: (id: string, termId: string) =>
    request<{ segments: number }>(`/books/${id}/glossary/${termId}/apply`, { method: 'POST' }),

  // Edits, history and review (SPEC §9.8, §13.5)
  /** `reason`: "undo", "edit" or the user's own short note (stored with the revision). */
  editTranslation: (segmentId: string, lang: string, text: string, reason = 'edit') =>
    request<{ translation: TranslationView }>(`/segments/${segmentId}/translation`, {
      method: 'PATCH',
      body: JSON.stringify({ lang, text, reason }),
    }),
  revisions: (segmentId: string, lang: string) =>
    request<{ revisions: RevisionRow[] }>(`/segments/${segmentId}/revisions?lang=${encodeURIComponent(lang)}`),
  reviewAction: (segmentId: string, lang: string, action: ReviewAction) =>
    request<{ translation: TranslationView }>(`/segments/${segmentId}/review`, {
      method: 'POST',
      body: JSON.stringify({ lang, action }),
    }),
  review: (id: string, lang: string, filter: 'flagged' | 'all' = 'flagged') =>
    request<{ lang: string; items: ReviewItem[] }>(
      `/books/${id}/review?lang=${encodeURIComponent(lang)}&filter=${filter}`,
    ),

  // AI engines (Phase 4): free providers, keys are write-only
  providers: () => request<ProviderSettingsResponse>('/settings/providers'),
  updateProvider: (id: ProviderId, patch: ProviderUpdate) =>
    request<ProviderView>(`/settings/providers/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  testProvider: (id: ProviderId) =>
    request<ProviderTestResult & { provider: ProviderView }>(`/settings/providers/${id}/test`, { method: 'POST' }),
  providerModels: (id: ProviderId) => request<{ models: ProviderModelInfo[] }>(`/settings/providers/${id}/models`),
  setAssistant: (engine: AssistantEngine) =>
    request<ProviderSettingsResponse['assistant']>('/settings/assistant', {
      method: 'PUT',
      body: JSON.stringify({ engine }),
    }),
  summary: (body: SummaryRequest) =>
    request<{ markdown: string; engine: ProviderId; model: string }>('/assist/summary', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  quiz: (body: QuizRequest) =>
    request<QuizResult & { engine: ProviderId; model: string }>('/assist/quiz', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

/** Full-page navigation target of «اتصال با یک کلیک» (OpenRouter's authorization page, then back here). */
export function openRouterConnectUrl(returnTo: string): string {
  return apiUrl(`/settings/providers/openrouter/connect?return=${encodeURIComponent(returnTo)}`);
}

/** Streams a tutor answer from the API (SSE over a POST); yields validated ChatEvents. */
export async function* streamTutor(input: TutorEngineInput, signal: AbortSignal): AsyncGenerator<ChatEvent> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/assist/tutor'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    if (signal.aborted) return;
    yield { type: 'error', code: 'NETWORK', message: 'network', retryable: true };
    return;
  }
  if (!res.ok || !res.body) {
    const code = res.status === 400 ? 'CONTEXT_TOO_LONG' : 'UNKNOWN';
    yield { type: 'error', code, message: String(res.status), retryable: code === 'UNKNOWN' };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!data) continue;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const parsed = ChatEventSchema.safeParse(json);
      if (parsed.success) yield parsed.data;
    }
  }
}

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
  | { type: 'book'; status: string }
  | { type: 'segment'; lang: string; ids: string[] }
  | { type: 'pipeline'; lang: string }
  | { type: 'agent'; pending: number; leased: number }
  | { type: 'glossary'; lang: string };

const EVENT_TYPES: BookEvent['type'][] = ['progress', 'job', 'book', 'segment', 'pipeline', 'agent', 'glossary'];

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
  for (const type of EVENT_TYPES) source.addEventListener(type, handler as EventListener);
  return () => source.close();
}
