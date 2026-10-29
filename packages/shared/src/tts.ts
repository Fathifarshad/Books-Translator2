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

export type AudioFormat = 'mp3' | 'wav';

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
  format: AudioFormat;
  /** MP3 needs ffmpeg for Piper's WAV; false means the files come out as WAV. */
  canEncodeMp3: boolean;
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
});
export type AudioRequest = z.infer<typeof AudioRequestSchema>;

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
  state: 'idle' | 'running' | 'done' | 'failed';
  done: number;
  total: number;
  error: string | null;
  tracks: AudioTrack[];
}
