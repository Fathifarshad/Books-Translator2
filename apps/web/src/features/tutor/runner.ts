import { createMockTutorEngine } from '@dozabaneh/ai';
import { chapterOf, nodeTitle, streamTutorAnswer, stripUnknownCitations, withTimeouts } from '@dozabaneh/core';
import type {
  AssistantEngine,
  ChatTurn,
  MessageContext,
  TutorEngine,
  TutorMode,
  TutorRequest,
} from '@dozabaneh/shared';
import i18next from 'i18next';
import { currentBookIndex, targetLangOf } from '../../data/books';
import { streamTutor } from '../../lib/api';
import { uiDigits } from '../../lib/format';
import { type ChatMessage, newId, useTutor } from './store';

/**
 * The tutor engine: the in-browser mock, or a free provider through the API (SSE; the key stays on the server).
 * The context (passages, glossary) is built here from the book the reader already has, and citations are
 * resolved against it — the same orchestration for every engine.
 */
const mockEngine = createMockTutorEngine();
let engine: TutorEngine = mockEngine;

export function setTutorEngine(next: TutorEngine) {
  engine = next;
}

/** Follows Settings → assistant engine. */
export function selectTutorEngine(id: AssistantEngine) {
  if (id === engine.id) return;
  engine = id === 'mock' ? mockEngine : { id, streamChat: (input, signal) => streamTutor(input, signal) };
}

export function tutorEngineId(): TutorEngine['id'] {
  return engine.id;
}

export const STREAM_TIMEOUTS = { firstTokenMs: 30_000, idleMs: 45_000 };
/** A local model on a CPU reads the context slowly before its first word. */
const LOCAL_TIMEOUTS = { firstTokenMs: 180_000, idleMs: 90_000 };

const controllers = new Map<string, AbortController>();

export function isStreaming(messageId: string): boolean {
  return controllers.has(messageId);
}

export function stopStreaming(messageId: string) {
  controllers.get(messageId)?.abort();
}

function formatLocation(chapterNumber: string | undefined, sectionTitle: string): string {
  return chapterNumber
    ? i18next.t('reader.location', {
        chapter: i18next.t('reader.chapter', { n: uiDigits(chapterNumber) }),
        section: sectionTitle,
      })
    : sectionTitle;
}

/** Streams an assistant answer into an existing assistant message (used by send and retry). */
async function run(conversationId: string, assistant: ChatMessage, userMessage: ChatMessage, history: ChatTurn[]) {
  const store = useTutor.getState();
  const context = userMessage.context;
  const index = context ? currentBookIndex(context.bookId) : undefined;
  if (!context || !index) {
    store.patchMessage(conversationId, assistant.id, { status: 'error', errorCode: 'UNKNOWN' });
    return;
  }
  const controller = new AbortController();
  controllers.set(assistant.id, controller);

  const request: TutorRequest = {
    question: userMessage.content,
    context,
    history,
    targetLang: targetLangOf(index),
    attempt: assistant.attempt,
  };

  let text = '';
  let pending = '';
  let frame: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    frame = undefined;
    if (!pending) return;
    const chunk = pending;
    pending = '';
    useTutor.getState().patchMessage(conversationId, assistant.id, (m) => ({ content: m.content + chunk }));
  };

  try {
    const events = withTimeouts(streamTutorAnswer(index, request, engine, controller.signal, { formatLocation }), {
      ...(engine.id === 'ollama' ? LOCAL_TIMEOUTS : STREAM_TIMEOUTS),
      signal: controller.signal,
    });
    for await (const event of events) {
      switch (event.type) {
        case 'delta':
          text += event.text;
          pending += event.text;
          // Batch store updates (~30 fps) instead of re-rendering per token.
          frame ??= setTimeout(flush, 32);
          break;
        case 'citations': {
          flush();
          const known = event.citations.map((c) => c.label);
          useTutor.getState().patchMessage(conversationId, assistant.id, {
            citations: event.citations,
            content: stripUnknownCitations(text, known),
          });
          break;
        }
        case 'followups':
          useTutor.getState().patchMessage(conversationId, assistant.id, { followups: event.items });
          break;
        case 'done':
          flush();
          useTutor.getState().patchMessage(conversationId, assistant.id, { status: 'complete' });
          break;
        case 'error':
          flush();
          // Keep the partial answer; «تلاش دوباره» regenerates this same message.
          useTutor.getState().patchMessage(conversationId, assistant.id, { status: 'error', errorCode: event.code });
          break;
        case 'usage':
          break;
      }
    }
    if (controller.signal.aborted) {
      flush();
      useTutor.getState().patchMessage(conversationId, assistant.id, { status: 'stopped' });
    }
  } finally {
    if (frame) clearTimeout(frame);
    controllers.delete(assistant.id);
  }
}

function historyBefore(messages: ChatMessage[], index: number): ChatTurn[] {
  return messages
    .slice(0, index)
    .filter((m) => m.status === 'complete' && m.content)
    .map((m) => ({ role: m.role, content: m.content }));
}

export interface SendOptions {
  bookId: string;
  question: string;
  context: MessageContext;
}

/** Creates the user message (with its send-time context) and streams a new assistant answer. */
export function sendQuestion({ bookId, question, context }: SendOptions): Promise<void> {
  const store = useTutor.getState();
  const conversationId = store.ensureConversation(bookId);
  const createdAt = new Date().toISOString();
  const user: ChatMessage = {
    id: newId('msg'),
    role: 'user',
    content: question,
    context,
    citations: [],
    followups: [],
    status: 'complete',
    engine: engine.id,
    attempt: 1,
    createdAt,
  };
  const assistant: ChatMessage = {
    id: newId('msg'),
    role: 'assistant',
    content: '',
    citations: [],
    followups: [],
    status: 'streaming',
    engine: engine.id,
    attempt: 1,
    createdAt,
  };
  const before = store.conversations[conversationId]?.messages ?? [];
  store.appendMessages(conversationId, [user, assistant]);
  return run(conversationId, assistant, user, historyBefore(before, before.length));
}

/** Regenerates the same assistant message — never duplicates the user message (bug §4.2-3). */
export function retryAnswer(conversationId: string, assistantId: string): Promise<void> {
  const store = useTutor.getState();
  const conv = store.conversations[conversationId];
  if (!conv || isStreaming(assistantId)) return Promise.resolve();
  const idx = conv.messages.findIndex((m) => m.id === assistantId);
  const assistant = conv.messages[idx];
  const user = [...conv.messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
  if (!assistant || !user) return Promise.resolve();
  const next: ChatMessage = {
    ...assistant,
    content: '',
    citations: [],
    followups: [],
    status: 'streaming',
    attempt: assistant.attempt + 1,
    engine: engine.id,
  };
  delete next.errorCode;
  store.patchMessage(conversationId, assistantId, { ...next, errorCode: undefined });
  const userIdx = conv.messages.indexOf(user);
  return run(conversationId, next, user, historyBefore(conv.messages, userIdx));
}

export type { TutorMode };

/** «فصل ۱ · <section>» label of a node, computed at send time and stored on the message. */
export function nodeLabelFor(bookId: string, nodeId: string): string {
  const index = currentBookIndex(bookId);
  if (!index) return '';
  const node = index.nodeById.get(nodeId);
  if (!node) return '';
  const t = nodeTitle(index, node, targetLangOf(index));
  const title = node.kind === 'chapter_intro' ? i18next.t('reader.chapterIntro') : (t.tgt ?? t.src);
  const chapter = chapterOf(index, nodeId);
  return formatLocation(chapter?.numberLabel, title);
}
