import type { ChatErrorCode, Citation, MessageContext, TutorEngine } from '@dozabaneh/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage, STORAGE_PREFIX } from '../../lib/storage';

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'stopped';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Captured at send time and shown on the message (bug §4.2-2). */
  context?: MessageContext;
  citations: Citation[];
  followups: string[];
  status: MessageStatus;
  errorCode?: ChatErrorCode;
  engine: TutorEngine['id'];
  attempt: number;
  createdAt: string;
}

export interface Conversation {
  id: string;
  bookId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface TutorState {
  conversations: Record<string, Conversation>;
  /** bookId → active conversation id */
  active: Record<string, string | undefined>;
  newConversation: (bookId: string) => string;
  ensureConversation: (bookId: string) => string;
  setActive: (bookId: string, id: string) => void;
  deleteConversation: (id: string) => void;
  appendMessages: (conversationId: string, messages: ChatMessage[]) => void;
  patchMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>),
  ) => void;
}

let seq = 0;
export const newId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();

export const useTutor = create<TutorState>()(
  persist(
    (set, get) => ({
      conversations: {},
      active: {},

      newConversation: (bookId) => {
        const id = newId('cv');
        const conv: Conversation = { id, bookId, title: '', createdAt: now(), updatedAt: now(), messages: [] };
        set((s) => ({ conversations: { ...s.conversations, [id]: conv }, active: { ...s.active, [bookId]: id } }));
        return id;
      },

      ensureConversation: (bookId) => {
        const id = get().active[bookId];
        if (id && get().conversations[id]) return id;
        return get().newConversation(bookId);
      },

      setActive: (bookId, id) => set((s) => ({ active: { ...s.active, [bookId]: id } })),

      deleteConversation: (id) =>
        set((s) => {
          const conv = s.conversations[id];
          const conversations = { ...s.conversations };
          delete conversations[id];
          const active = { ...s.active };
          if (conv && active[conv.bookId] === id) active[conv.bookId] = undefined;
          return { conversations, active };
        }),

      appendMessages: (conversationId, messages) =>
        set((s) => {
          const conv = s.conversations[conversationId];
          if (!conv) return s;
          const firstUser = messages.find((m) => m.role === 'user');
          return {
            conversations: {
              ...s.conversations,
              [conversationId]: {
                ...conv,
                title: conv.title || (firstUser?.content.slice(0, 60) ?? ''),
                updatedAt: now(),
                messages: [...conv.messages, ...messages],
              },
            },
          };
        }),

      patchMessage: (conversationId, messageId, patch) =>
        set((s) => {
          const conv = s.conversations[conversationId];
          if (!conv) return s;
          return {
            conversations: {
              ...s.conversations,
              [conversationId]: {
                ...conv,
                updatedAt: now(),
                messages: conv.messages.map((m) =>
                  m.id === messageId ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m,
                ),
              },
            },
          };
        }),
    }),
    {
      name: `${STORAGE_PREFIX}tutor`,
      storage: persistStorage,
      version: 1,
      // An answer that was streaming when the page closed is kept as a stopped (retryable) answer.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const conv of Object.values(state.conversations)) {
          conv.messages = conv.messages.map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' } : m));
        }
      },
    },
  ),
);

export function conversationsForBook(conversations: Record<string, Conversation>, bookId: string): Conversation[] {
  return Object.values(conversations)
    .filter((c) => c.bookId === bookId && c.messages.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
