import { z } from 'zod';
import type { ProviderId } from './providers';

/** Typed tutor errors (SPEC §12.6); each maps to a Persian i18n message in the web app. */
export const CHAT_ERROR_CODES = [
  'NETWORK',
  'TIMEOUT',
  'NO_ENGINE',
  'RATE_LIMIT',
  'OVERLOADED',
  'CONTEXT_TOO_LONG',
  'UNKNOWN',
] as const;
export const ChatErrorCodeSchema = z.enum(CHAT_ERROR_CODES);
export type ChatErrorCode = z.infer<typeof ChatErrorCodeSchema>;

export const TUTOR_MODES = ['default', 'simpler', 'deeper', 'example', 'quiz'] as const;
export const TutorModeSchema = z.enum(TUTOR_MODES);
export type TutorMode = z.infer<typeof TutorModeSchema>;

export const SelectionContextSchema = z.object({
  text: z.string().min(1),
  lang: z.string(),
  segmentIds: z.array(z.string()),
});
export type SelectionContext = z.infer<typeof SelectionContextSchema>;

/** Captured at send time, stored on the message and shown on it (fixes prototype bug §4.2-2). */
export const MessageContextSchema = z.object({
  bookId: z.string(),
  nodeId: z.string(),
  nodeLabel: z.string(),
  selection: SelectionContextSchema.optional(),
  mode: TutorModeSchema,
});
export type MessageContext = z.infer<typeof MessageContextSchema>;

export const CitationSchema = z.object({
  label: z.string(),
  segmentId: z.string(),
  nodeId: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const UsageSchema = z.object({ tokensIn: z.number(), tokensOut: z.number() });
export type Usage = z.infer<typeof UsageSchema>;

export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('citations'), citations: z.array(CitationSchema) }),
  z.object({ type: z.literal('followups'), items: z.array(z.string()) }),
  z.object({ type: z.literal('usage'), usage: UsageSchema }),
  z.object({ type: z.literal('done') }),
  z.object({
    type: z.literal('error'),
    code: ChatErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface TutorRequest {
  question: string;
  context: MessageContext;
  history: ChatTurn[];
  targetLang: string;
  /** 1 for the first try, incremented by «تلاش دوباره». */
  attempt: number;
}

/** A passage handed to an engine, labelled [P1]…[Pn]; the server keeps label → segment mapping. */
export interface ContextPassage {
  label: string;
  segmentId: string;
  nodeId: string;
  /** Human-readable location in the target language, e.g. "فصل ۱ · دقت". */
  location: string;
  src: string;
  tgt?: string;
}

export interface ContextGlossaryEntry {
  src: string;
  tgt: string;
  definition?: string;
}

const text = (max: number) => z.string().max(max);

/** Validation of a tutor request sent to the API (bounded sizes: it goes to a provider). */
export const TutorEngineInputSchema = z.object({
  question: text(4_000).min(1),
  mode: TutorModeSchema,
  selection: z.object({ text: text(6_000).min(1), lang: z.string().max(12) }).optional(),
  passages: z
    .array(
      z.object({
        label: text(10),
        segmentId: text(80),
        nodeId: text(80),
        location: text(300),
        src: text(8_000),
        tgt: text(12_000).optional(),
      }),
    )
    .max(40),
  glossary: z.array(z.object({ src: text(200), tgt: text(200), definition: text(1_000).optional() })).max(60),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: text(20_000) })).max(40),
  sourceLang: z.string().min(2).max(12),
  targetLang: z.string().min(2).max(12),
  book: z.object({ title: text(500), authors: z.array(text(200)).max(20) }),
  sectionTitle: text(500),
  attempt: z.number().int().min(1).max(100),
});

/** Everything an engine needs to answer one tutor question (TutorAnswerInputV1 + book info). */
export interface TutorEngineInput {
  question: string;
  mode: TutorMode;
  selection?: { text: string; lang: string };
  passages: ContextPassage[];
  glossary: ContextGlossaryEntry[];
  history: ChatTurn[];
  sourceLang: string;
  targetLang: string;
  book: { title: string; authors: string[] };
  /** Title of the section the reader was in when sending (target language when available). */
  sectionTitle: string;
  attempt: number;
}

export interface TutorEngine {
  id: 'mock' | 'local' | 'agent' | 'anthropic' | 'openai' | ProviderId;
  streamChat(input: TutorEngineInput, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
