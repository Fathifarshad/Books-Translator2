import { z } from 'zod';

/**
 * Reading a book aloud (SPEC §13.9). Claude has no voice, so the sound always comes from somewhere else, and
 * which «somewhere» is the user's choice — it decides what it costs, how natural it sounds and whether a file
 * comes out at all:
 *
 * - `browser`  the voice Windows (or the phone) already has. Free, nothing to install, reads in the reader —
 *              but it speaks, it does not write a file, so there is nothing to put on a phone or send.
 * - `piper`    a small program on this computer with a Persian voice. Free, offline, writes a file.
 * - `azure` / `google` / `openai`  natural voices over the internet; a key, and paid per character.
 */
export const TTS_SOURCES = ['browser', 'piper', 'azure', 'google', 'openai'] as const;
export type TtsSource = (typeof TTS_SOURCES)[number];
export const TtsSourceSchema = z.enum(TTS_SOURCES);

/** Sources that produce an audio file on the server (everything except the browser's own voice). */
export const FILE_TTS_SOURCES = ['piper', 'azure', 'google', 'openai'] as const;
export type FileTtsSource = (typeof FILE_TTS_SOURCES)[number];
export const isFileTtsSource = (id: string): id is FileTtsSource =>
  (FILE_TTS_SOURCES as readonly string[]).includes(id);

/** What a recording can be saved as. A format other than the source's own needs ffmpeg to convert it. */
export const AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'm4a'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];
export const AudioFormatSchema = z.enum(AUDIO_FORMATS);

export interface TtsVoice {
  id: string;
  /** What to show in the list; the id when the source gives no better name. */
  label: string;
  /** Language tag the voice speaks, when the source reports one (never assumed). */
  lang?: string;
}

export interface TtsProblem {
  code: 'AUTH' | 'NOT_FOUND' | 'NETWORK' | 'QUOTA' | 'RATE_LIMIT' | 'OTHER';
  message: string;
  at: string;
  /** The source cannot work until its settings change (no key, program missing). */
  blocking: boolean;
}

/** What the settings page knows about the chosen voice source — never the key itself. */
export interface TtsView {
  source: TtsSource;
  needsKey: boolean;
  keyUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  /** Azure needs the region its key belongs to; the others ignore it. */
  region: string;
  voice: string;
  voices: TtsVoice[];
  /** Piper: where the program and the voice file are. */
  binPath: string;
  voicePath: string;
  /** What the chosen source writes by itself (Piper: WAV; the services: MP3). */
  format: AudioFormat;
  /** Every format a recording can be saved as right now: the source's own, plus the rest when ffmpeg is there. */
  formats: AudioFormat[];
  /** Piper: how slowly it speaks (1 = the voice's own pace) and the silence after each sentence, in seconds. */
  lengthScale: number;
  sentencePause: number;
  /** MP3 needs ffmpeg for Piper's WAV; false means the files come out as WAV. */
  canEncodeMp3: boolean;
  /**
   * Let the assistant engine prepare each line for the voice before it is read: the vowel marks a written word
   * needs to be said the right way, numbers and units in full, the bracketed original term left out (ADR-042).
   */
  polish: boolean;
  problem: TtsProblem | null;
  ready: boolean;
}

/** PUT /settings/tts — omitted fields stay as they are; `null` clears the key. */
export const TtsUpdateSchema = z.object({
  source: TtsSourceSchema.optional(),
  apiKey: z.string().trim().min(8).max(500).nullable().optional(),
  region: z.string().trim().max(60).optional(),
  voice: z.string().trim().max(200).optional(),
  binPath: z.string().trim().max(500).optional(),
  voicePath: z.string().trim().max(500).optional(),
  polish: z.boolean().optional(),
  lengthScale: z.number().min(0.7).max(1.6).optional(),
  sentencePause: z.number().min(0).max(2).optional(),
});
export type TtsUpdate = z.infer<typeof TtsUpdateSchema>;

export interface TtsTestResult {
  ok: boolean;
  /** A short spoken sample as a data URL, so the page can play it without saving anything. */
  sample?: string;
  format?: AudioFormat;
  ms?: number;
  voices?: TtsVoice[];
  error?: { code: string; message: string };
}

/** What a recording covers: the whole translation, or the shorter telling of it. */
export const AUDIO_KINDS = ['full', 'summary'] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];
export const AudioKindSchema = z.enum(AUDIO_KINDS);

export const AudioRequestSchema = z.object({
  lang: z.string().min(2).max(12).optional(),
  kind: AudioKindSchema.default('full'),
  /** Omitted: the source's own format, with no conversion. */
  format: AudioFormatSchema.optional(),
});
export type AudioRequest = z.infer<typeof AudioRequestSchema>;

/** Pauses a recording that is being made, or lets it go on. */
export const AudioControlSchema = z.object({
  action: z.enum(['pause', 'resume']),
  lang: z.string().min(2).max(12).optional(),
  kind: AudioKindSchema.default('full'),
});
export type AudioControl = z.infer<typeof AudioControlSchema>;

/** One finished recording: a chapter of the book, or the whole summary. */
export interface AudioTrack {
  id: string;
  /** Position in the book, so a player can keep them in reading order. */
  index: number;
  title: string;
  format: AudioFormat;
  bytes: number;
  seconds: number;
  createdAt: string;
}

export interface AudioStatus {
  kind: AudioKind;
  lang: string;
  source: TtsSource;
  voice: string;
  state: 'idle' | 'running' | 'paused' | 'done' | 'failed';
  done: number;
  total: number;
  /** 0–1 over the whole recording, finer than chapters: a long chapter takes minutes. */
  fraction: number;
  error: string | null;
  tracks: AudioTrack[];
}
