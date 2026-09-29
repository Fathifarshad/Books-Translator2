import type { ChatErrorCode, ChatEvent, TutorEngine, TutorRequest } from '@dozabaneh/shared';
import type { BookIndex } from '../book';
import { buildTutorContext, type ContextOptions, resolveCitations, stripUnknownCitations } from './context';

export class ChatStreamError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ChatStreamError';
  }
}

export interface TimeoutOptions {
  /** Time allowed until the first delta (SPEC §12.6: 30 s). */
  firstTokenMs: number;
  /** Time allowed between events once streaming (45 s). */
  idleMs: number;
  signal?: AbortSignal;
}

/**
 * Guards any ChatEvent stream (SSE or in-process) with first-token and idle timeouts and an abort
 * signal. Timeouts surface as a typed `TIMEOUT` error event; aborts end the stream quietly.
 */
export async function* withTimeouts(
  source: AsyncIterable<ChatEvent>,
  { firstTokenMs, idleMs, signal }: TimeoutOptions,
): AsyncGenerator<ChatEvent> {
  const iterator = source[Symbol.asyncIterator]();
  let gotDelta = false;
  try {
    while (true) {
      if (signal?.aborted) return;
      const limit = gotDelta ? idleMs : firstTokenMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), limit);
      });
      const aborted = new Promise<'abort'>((resolve) => {
        onAbort = () => resolve('abort');
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      const next = await Promise.race([iterator.next(), timeout, aborted]);
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      if (next === 'abort') return;
      if (next === 'timeout') {
        yield { type: 'error', code: 'TIMEOUT', message: 'timeout', retryable: true };
        return;
      }
      if (next.done) return;
      if (next.value.type === 'delta') gotDelta = true;
      yield next.value;
      if (next.value.type === 'done' || next.value.type === 'error') return;
    }
  } catch (err) {
    if (signal?.aborted) return;
    const code = err instanceof ChatStreamError ? err.code : 'NETWORK';
    yield { type: 'error', code, message: err instanceof Error ? err.message : String(err), retryable: true };
  } finally {
    void iterator.return?.();
  }
}

/**
 * Runs one tutor answer: builds the context at send time, streams the engine's answer and emits
 * validated citations before `done`. The same orchestration runs server-side in API mode (Phase 4).
 */
export async function* streamTutorAnswer(
  index: BookIndex,
  request: TutorRequest,
  engine: TutorEngine,
  signal: AbortSignal,
  opts: ContextOptions = {},
): AsyncGenerator<ChatEvent> {
  const { input, labelMap } = buildTutorContext(index, request, opts);
  let text = '';
  for await (const event of engine.streamChat(input, signal)) {
    if (event.type === 'delta') {
      text += event.text;
      yield event;
    } else if (event.type === 'done') {
      yield { type: 'citations', citations: resolveCitations(text, labelMap) };
      yield event;
      return;
    } else {
      yield event;
      if (event.type === 'error') return;
    }
  }
}

export { stripUnknownCitations };
