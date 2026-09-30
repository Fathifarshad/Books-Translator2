import type { ChatErrorCode, ChatEvent, TutorEngine, TutorEngineInput } from '@dozabaneh/shared';
import { renderPrompt } from './prompts';
import { type ChatMessage, type ProviderClient, ProviderError } from './providers';

/**
 * «بپرس از مدرس» on a free provider: the tutor prompt (prompts/tutor.md) as the system message, the passages the
 * reader's context produced as a clearly delimited data block, the recent history, then the question. The answer
 * streams back as ChatEvents; citations are resolved against the passage labels by the caller (SPEC §12).
 */
const HISTORY_TURNS = 8;
const TURN_CHARS = 2_000;

/** Book text must not be able to close the data block (book text is data, never instructions). */
const fence = (text: string) => text.replace(/<\/?book_context/giu, (m) => m.replace('book_context', 'book-context'));

export function tutorSystemPrompt(template: string, input: TutorEngineInput): string {
  const rendered = renderPrompt(template, { sourceLang: input.sourceLang, targetLang: input.targetLang })
    .replaceAll('{{bookTitle}}', input.book.title)
    .replaceAll('{{authors}}', input.book.authors.join(', ') || '—');
  return `${rendered}\n\n---\n\nYou are answering live in a chat: write Markdown for the reader, not JSON.`;
}

export function tutorMessages(template: string, input: TutorEngineInput): ChatMessage[] {
  const context = [
    '<book_context>',
    `Section: ${fence(input.sectionTitle)}`,
    '',
    ...input.passages.map((p) =>
      [
        `[${p.label}] (${fence(p.location)})`,
        `SRC: ${fence(p.src)}`,
        ...(p.tgt ? [`TGT: ${fence(p.tgt)}`] : []),
        '',
      ].join('\n'),
    ),
    ...(input.glossary.length
      ? [
          'Glossary:',
          ...input.glossary.map(
            (g) => `- ${fence(g.src)} → ${fence(g.tgt)}${g.definition ? `: ${fence(g.definition)}` : ''}`,
          ),
        ]
      : []),
    '</book_context>',
  ].join('\n');
  const request = [
    context,
    '',
    `Mode: ${input.mode}`,
    ...(input.selection ? [`Selected text (${input.selection.lang}): «${fence(input.selection.text)}»`] : []),
    `Question: ${input.question}`,
  ].join('\n');
  return [
    { role: 'system', content: tutorSystemPrompt(template, input) },
    ...input.history.slice(-HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content.slice(0, TURN_CHARS) })),
    { role: 'user', content: request },
  ];
}

export function chatErrorOf(err: unknown): Extract<ChatEvent, { type: 'error' }> {
  const map: Record<ProviderError['code'], ChatErrorCode> = {
    AUTH: 'NO_ENGINE',
    NOT_FOUND: 'NO_ENGINE',
    RATE_LIMIT: 'RATE_LIMIT',
    QUOTA: 'RATE_LIMIT',
    OVERLOADED: 'OVERLOADED',
    NETWORK: 'NETWORK',
    TIMEOUT: 'TIMEOUT',
    BAD_RESPONSE: 'UNKNOWN',
    UNKNOWN: 'UNKNOWN',
  };
  if (err instanceof ProviderError) {
    const code =
      err.status === 400 && /context|too long|token/iu.test(err.message) ? 'CONTEXT_TOO_LONG' : map[err.code];
    return { type: 'error', code, message: err.message, retryable: err.retryable || code === 'UNKNOWN' };
  }
  return { type: 'error', code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err), retryable: true };
}

export interface ProviderTutorOptions {
  client: ProviderClient;
  /** Raw prompts/tutor.md. */
  template: string;
  /** Rate limiting; throws a ProviderError when the provider must wait too long. */
  beforeRequest?: () => Promise<void>;
  onError?: (err: unknown) => void;
}

export function createProviderTutorEngine(opts: ProviderTutorOptions): TutorEngine {
  return {
    id: opts.client.provider,
    async *streamChat(input: TutorEngineInput, signal: AbortSignal): AsyncGenerator<ChatEvent> {
      try {
        await opts.beforeRequest?.();
        for await (const e of opts.client.stream(tutorMessages(opts.template, input), { signal, temperature: 0.4 })) {
          if (e.type === 'delta') yield { type: 'delta', text: e.text };
          else yield { type: 'usage', usage: e.usage };
        }
        yield { type: 'done' };
      } catch (err) {
        if (signal.aborted) return;
        opts.onError?.(err);
        yield chatErrorOf(err);
      }
    },
  };
}
