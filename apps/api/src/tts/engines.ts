import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { AudioFormat, FileTtsSource, TtsVoice } from '@dozabaneh/shared';
import { toSsml } from '@dozabaneh/text';

/**
 * Voices that write a file (SPEC §13.9). Claude has no voice, so every one of these is somewhere else: a small
 * program on this computer (Piper — free, offline) or a service over the internet (Azure, Google, OpenAI — a key,
 * paid per character). The browser's own voice reads in the reader and writes nothing, so it is not here.
 *
 * Each service has its own limit on how much text one request may carry, so long text is split at sentence
 * boundaries and the pieces are joined back together — MP3 frames end to end, WAV with one header over the sum.
 */
export class SpeechError extends Error {
  constructor(
    readonly code: 'AUTH' | 'NOT_FOUND' | 'NETWORK' | 'QUOTA' | 'RATE_LIMIT' | 'OTHER',
    message: string,
    readonly blocking = false,
  ) {
    super(message);
  }
}

export interface SpeechResult {
  audio: Buffer;
  format: AudioFormat;
}

export interface SpeechEngine {
  readonly id: FileTtsSource;
  readonly format: AudioFormat;
  speak(text: string, signal?: AbortSignal): Promise<SpeechResult>;
  voices(): Promise<TtsVoice[]>;
}

export interface SpeechConfig {
  apiKey?: string;
  /** Azure: the region its key belongs to (e.g. `westeurope`). */
  region?: string;
  voice: string;
  /** Piper: the program and the `.onnx` voice file. */
  binPath?: string;
  voicePath?: string;
  /** The language the book is being read in; sent to the services that want a tag. */
  lang: string;
  /**
   * Send SSML rather than plain text, where the service takes it: a pause between lines, and a run in the other
   * script marked so the voice switches language instead of spelling it out (ADR-042).
   */
  ssml?: boolean;
  /** Locale of the source language, for those marked runs (e.g. `en-US`). */
  foreignLang?: string;
  /** Piper: phoneme length (above 1 is slower) and the silence after each sentence, in seconds. */
  lengthScale?: number;
  sentencePause?: number;
  /** Silence between lines, in milliseconds. */
  pauseMs?: number;
  fetch?: typeof fetch;
  spawn?: typeof spawn;
}

/** Characters one request may carry. Google counts bytes (5,000) and OpenAI characters (4,096). */
const CHUNK_CHARS: Record<FileTtsSource, number> = { piper: 20_000, azure: 4_000, google: 1_600, openai: 3_500 };
const REQUEST_TIMEOUT_MS = 120_000;

/** Splits text at sentence ends, then at spaces, so no piece is longer than `max`. */
export function splitForSpeech(text: string, max: number): string[] {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (!clean) return [];
  const out: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut =
      Math.max(window.lastIndexOf('. '), window.lastIndexOf('؟ '), window.lastIndexOf('! '), window.lastIndexOf('۔ ')) +
      1;
    const at = cut > max * 0.4 ? cut : window.lastIndexOf(' ');
    const take = at > 0 ? at : max;
    out.push(rest.slice(0, take).trim());
    rest = rest.slice(take).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** One WAV out of several: the first header, every `data` chunk after it, and the summed length. */
export function joinWav(parts: Buffer[]): Buffer {
  const usable = parts.filter((p) => p.length > 44 && p.subarray(0, 4).toString('latin1') === 'RIFF');
  if (usable.length <= 1) return usable[0] ?? Buffer.alloc(0);
  const head = (usable[0] as Buffer).subarray(0, 44);
  const bodies = usable.map((p) => p.subarray(44));
  const data = Buffer.concat(bodies);
  const out = Buffer.concat([Buffer.from(head), data]);
  out.writeUInt32LE(out.length - 8, 4); // RIFF size
  out.writeUInt32LE(data.length, 40); // data size
  return out;
}

export const join_ = (parts: Buffer[], format: AudioFormat) =>
  format === 'wav' ? joinWav(parts) : Buffer.concat(parts);

/** `fetch` with a timeout, and the service's own error turned into a typed one. */
async function post(
  url: string,
  init: RequestInit,
  doFetch: typeof fetch,
  signal: AbortSignal | undefined,
  what: string,
): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err) {
    if (timeout.aborted) throw new SpeechError('NETWORK', `${what} gave no answer in time.`);
    throw new SpeechError('NETWORK', `Cannot reach ${what}: ${(err as Error).message}`);
  }
  if (res.ok) return res;
  const detail = (await res.text().catch(() => '')).slice(0, 200).replace(/\s+/gu, ' ');
  if (res.status === 401 || res.status === 403) {
    throw new SpeechError('AUTH', `${what} rejected the key (${res.status}): ${detail}`, true);
  }
  if (res.status === 404) throw new SpeechError('NOT_FOUND', `${what}: voice or address not found: ${detail}`, true);
  if (res.status === 429) throw new SpeechError('RATE_LIMIT', `${what} is rate limiting: ${detail}`);
  throw new SpeechError('OTHER', `${what} answered ${res.status}: ${detail}`);
}

/** Microsoft Azure Speech: SSML in, MP3 out. The key belongs to one region, which is part of the address. */
function azureEngine(config: SpeechConfig): SpeechEngine {
  const doFetch = config.fetch ?? fetch;
  const region = config.region?.trim();
  const host = () => {
    if (!config.apiKey) throw new SpeechError('AUTH', 'No Azure Speech key.', true);
    if (!region) throw new SpeechError('NOT_FOUND', 'Azure Speech needs the region of its key.', true);
    return `https://${region}.tts.speech.microsoft.com/cognitiveservices`;
  };
  const headers = () => ({ 'Ocp-Apim-Subscription-Key': config.apiKey as string });
  const forXml = (t: string) =>
    t.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
  return {
    id: 'azure',
    format: 'mp3',
    async speak(text, signal) {
      const parts: Buffer[] = [];
      for (const piece of splitForSpeech(text, CHUNK_CHARS.azure)) {
        const body = config.ssml
          ? toSsml(piece, config.lang, {
              ...(config.foreignLang ? { foreignLang: config.foreignLang } : {}),
              ...(config.pauseMs ? { pauseMs: config.pauseMs } : {}),
            })
          : forXml(piece);
        const ssml =
          `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${config.lang}">` +
          `<voice name="${forXml(config.voice)}">${body}</voice></speak>`;
        const res = await post(
          `${host()}/v1`,
          {
            method: 'POST',
            headers: {
              ...headers(),
              'Content-Type': 'application/ssml+xml',
              'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
              'User-Agent': 'Dozabaneh',
            },
            body: ssml,
          },
          doFetch,
          signal,
          'Azure Speech',
        );
        parts.push(Buffer.from(await res.arrayBuffer()));
      }
      return { audio: join_(parts, 'mp3'), format: 'mp3' };
    },
    async voices() {
      const res = await post(
        `${host()}/voices/list`,
        { method: 'GET', headers: headers() },
        doFetch,
        undefined,
        'Azure Speech',
      );
      const list = (await res.json()) as { ShortName?: string; LocalName?: string; Locale?: string }[];
      return list
        .filter((v) => typeof v.ShortName === 'string')
        .map((v) => ({
          id: v.ShortName as string,
          label: v.LocalName ? `${v.LocalName} (${v.ShortName})` : (v.ShortName as string),
          ...(v.Locale ? { lang: v.Locale } : {}),
        }));
    },
  };
}

/** Google Cloud Text-to-Speech: JSON in, base64 MP3 out, the key in the query string. */
function googleEngine(config: SpeechConfig): SpeechEngine {
  const doFetch = config.fetch ?? fetch;
  const base = 'https://texttospeech.googleapis.com/v1';
  const key = () => {
    if (!config.apiKey) throw new SpeechError('AUTH', 'No Google Cloud key.', true);
    return encodeURIComponent(config.apiKey);
  };
  return {
    id: 'google',
    format: 'mp3',
    async speak(text, signal) {
      const parts: Buffer[] = [];
      for (const piece of splitForSpeech(text, CHUNK_CHARS.google)) {
        const res = await post(
          `${base}/text:synthesize?key=${key()}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input: config.ssml
                ? {
                    ssml: `<speak>${toSsml(piece, config.lang, {
                      ...(config.foreignLang ? { foreignLang: config.foreignLang } : {}),
                      ...(config.pauseMs ? { pauseMs: config.pauseMs } : {}),
                    })}</speak>`,
                  }
                : { text: piece },
              voice: { languageCode: config.lang, name: config.voice },
              audioConfig: { audioEncoding: 'MP3' },
            }),
          },
          doFetch,
          signal,
          'Google Cloud Text-to-Speech',
        );
        const data = (await res.json()) as { audioContent?: string };
        if (!data.audioContent) throw new SpeechError('OTHER', 'Google Cloud sent no audio.');
        parts.push(Buffer.from(data.audioContent, 'base64'));
      }
      return { audio: join_(parts, 'mp3'), format: 'mp3' };
    },
    async voices() {
      const res = await post(`${base}/voices?key=${key()}`, { method: 'GET' }, doFetch, undefined, 'Google Cloud');
      const data = (await res.json()) as { voices?: { name?: string; languageCodes?: string[] }[] };
      return (data.voices ?? [])
        .filter((v) => typeof v.name === 'string')
        .map((v) => ({
          id: v.name as string,
          label: v.name as string,
          ...(v.languageCodes?.[0] ? { lang: v.languageCodes[0] } : {}),
        }));
    },
  };
}

/** OpenAI speech. Its voice list is fixed, and every voice speaks every language the model knows. */
const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
const OPENAI_MODEL = 'gpt-4o-mini-tts';

function openaiEngine(config: SpeechConfig): SpeechEngine {
  const doFetch = config.fetch ?? fetch;
  return {
    id: 'openai',
    format: 'mp3',
    async speak(text, signal) {
      if (!config.apiKey) throw new SpeechError('AUTH', 'No OpenAI key.', true);
      const parts: Buffer[] = [];
      for (const piece of splitForSpeech(text, CHUNK_CHARS.openai)) {
        const res = await post(
          'https://api.openai.com/v1/audio/speech',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              voice: config.voice || 'alloy',
              input: piece,
              response_format: 'mp3',
            }),
          },
          doFetch,
          signal,
          'OpenAI speech',
        );
        parts.push(Buffer.from(await res.arrayBuffer()));
      }
      return { audio: join_(parts, 'mp3'), format: 'mp3' };
    },
    async voices() {
      return OPENAI_VOICES.map((id) => ({ id, label: id }));
    },
  };
}

/**
 * What to spawn for a configured program. A path ending in `.js`/`.mjs`/`.cjs` is run with this Node — which is
 * how the tests put a stand-in in place of Piper, and how anyone can wrap it in a script of their own.
 */
export function resolveProgram(file: string): { file: string; prefix: string[] } {
  return /\.[cm]?js$/u.test(file) ? { file: process.execPath, prefix: [file] } : { file, prefix: [] };
}

/** A program on PATH, or null; used to find `piper` and `ffmpeg` without a shell. */
export function onPath(name: string): string | null {
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const file of names) {
      const candidate = join(dir, file);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Runs a program with text on stdin and collects what it writes — to stdout, or to `outFile` when the program is
 * told to write a file.
 */
function run(
  file: string,
  args: string[],
  input: string,
  spawnFn: typeof spawn,
  signal?: AbortSignal,
  outFile?: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Piper is a Python program: on Windows, Python reads stdin in the ANSI code page unless told otherwise, so
    // Persian arrived garbled — read as noise, or a crash on letters like «ژ». UTF-8 mode fixes both.
    const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
    const child = spawnFn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
    const out: Buffer[] = [];
    let err = '';
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(
        e.code === 'ENOENT'
          ? new SpeechError('NOT_FOUND', `${file} was not found on this computer.`, true)
          : new SpeechError('OTHER', `${file} could not be started: ${e.message}`),
      ),
    );
    signal?.addEventListener('abort', () => child.kill(), { once: true });
    child.stdout?.on('data', (c: Buffer) => out.push(c));
    child.stderr?.setEncoding('utf8').on('data', (c: string) => {
      err += c;
    });
    child.stdin?.on('error', () => {
      // The program may exit before the text is fully written; the exit code tells the real story.
    });
    child.stdin?.end(input, 'utf8');
    child.on('close', async (code) => {
      const audio = outFile && code === 0 ? await readFile(outFile).catch(() => Buffer.alloc(0)) : Buffer.concat(out);
      if (code === 0 && audio.length > 0) resolve(audio);
      else reject(new SpeechError('OTHER', `${file} wrote no audio${err ? `: ${err.slice(0, 200)}` : ''}.`));
    });
  });
}

/** Piper: free, offline, on this computer. It writes WAV; ffmpeg turns that into MP3 when it is installed. */
function piperEngine(config: SpeechConfig): SpeechEngine {
  const spawnFn = config.spawn ?? spawn;
  const program = () => {
    const file = config.binPath?.trim() || onPath('piper');
    if (!file) {
      throw new SpeechError('NOT_FOUND', 'Piper was not found; install it or give the path to the program.', true);
    }
    return file;
  };
  const model = () => {
    const file = config.voicePath?.trim() || config.voice.trim();
    if (!file) throw new SpeechError('NOT_FOUND', 'Piper needs the path of a voice file (.onnx).', true);
    return file;
  };
  return {
    id: 'piper',
    format: 'wav',
    async speak(text, signal) {
      const parts: Buffer[] = [];
      const { file, prefix } = resolveProgram(program());
      // A real file, not stdout: Piper 1.x on Windows cannot write a WAV to stdout (it reopens a temp file that
      // Windows keeps locked), and without an output file it plays the sound instead.
      const dir = await mkdtemp(join(tmpdir(), 'dozabaneh-piper-'));
      try {
        for (const [i, piece] of splitForSpeech(text, CHUNK_CHARS.piper).entries()) {
          const out = join(dir, `${i}.wav`);
          const style = [
            ...(config.lengthScale ? ['--length_scale', String(config.lengthScale)] : []),
            ...(config.sentencePause !== undefined ? ['--sentence_silence', String(config.sentencePause)] : []),
          ];
          parts.push(
            await run(
              file,
              [...prefix, '--model', model(), '--output_file', out, ...style],
              // A zero-width joiner makes Piper's phonemizer read a plural like «kitab-ha» as two words and stress the
              // first syllable; written joined, the word keeps its natural stress.
              piece.replace(/\u200c/gu, ''),
              spawnFn,
              signal,
              out,
            ),
          );
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      return { audio: joinWav(parts), format: 'wav' };
    },
    async voices() {
      const file = config.voicePath?.trim() || config.voice.trim();
      return file ? [{ id: file, label: file.split(/[\\/]/u).pop() ?? file }] : [];
    },
  };
}

export function createSpeechEngine(source: FileTtsSource, config: SpeechConfig): SpeechEngine {
  switch (source) {
    case 'azure':
      return azureEngine(config);
    case 'google':
      return googleEngine(config);
    case 'openai':
      return openaiEngine(config);
    default:
      return piperEngine(config);
  }
}
