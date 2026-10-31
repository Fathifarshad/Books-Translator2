import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AudioFormat, AudioKind, AudioStatus, AudioTrack, TtsSource } from '@dozabaneh/shared';
import { getLanguage, speechText, stripMarkup } from '@dozabaneh/text';
import { runAssistTask } from '../assist/task';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { getBookRow, getBundle } from '../db/repo';
import { type BookDocument, bookDocument } from '../export/document';
import type { ProviderService } from '../settings/providers';
import { audioControl, audioKey } from './control';
import { concatAudio, convertAudio } from './convert';
import { join_, onPath, SpeechError, splitForSpeech } from './engines';
import type { TtsService } from './service';

/**
 * Recording a book (SPEC §13.9). One file per chapter, in reading order, so a phone's player shows the book as a
 * playlist and remembers where it stopped — one file for a 300-page book would be unusable.
 *
 * Two kinds: `full` reads the translation itself, `summary` reads a telling of each chapter that the assistant
 * engine writes first. They live side by side, because they are for different moments.
 */
export interface AudioTrackPlan {
  index: number;
  title: string;
  /** What is read aloud: already plain text, no markup. */
  text: string;
}

interface Manifest {
  kind: AudioKind;
  lang: string;
  source: TtsSource;
  voice: string;
  tracks: AudioTrack[];
  updatedAt: string;
}

const MANIFEST = 'manifest.json';
/** The error a recording that was given up ends with; the status page shows it as «not started», not as a failure. */
export const CANCELLED = 'cancelled';
/** Rows of a chapter offered to the assistant engine when it writes the summary. */
const SUMMARY_PASSAGES = 120;
/** Characters spoken per request while recording, so progress moves and a pause takes effect within seconds. */
const SEGMENT_CHARS = 2_500;
/** Lines sent to the speech pass at a time: enough context to judge a word, small enough to come back whole. */
const SPEECH_BATCH_LINES = 40;

export function audioDir(config: Config, bookId: string, lang: string, kind: AudioKind): string {
  return join(config.dataDir, 'audio', bookId, lang, kind);
}

/** Reading-order tracks of the translation: one per chapter, or per section in a book without chapters. */
export function planFullAudio(doc: BookDocument): AudioTrackPlan[] {
  const byChapter = new Map<string, AudioTrackPlan>();
  const plan: AudioTrackPlan[] = [];
  for (const section of doc.sections) {
    const key = section.chapter ?? section.id;
    const title = section.chapter ?? section.title;
    let track = byChapter.get(key);
    if (!track) {
      track = { index: plan.length + 1, title: stripMarkup(title), text: '' };
      byChapter.set(key, track);
      plan.push(track);
    }
    const lines: string[] = [];
    if (section.title && section.chapter) lines.push(stripMarkup(section.title));
    for (const row of section.rows) {
      if (row.type === 'figure' || row.type === 'code') continue;
      const text = stripMarkup(row.tgt || '').trim();
      if (text) lines.push(text);
    }
    track.text = `${track.text}\n${lines.join('\n')}`.trim();
  }
  return splitLongTracks(plan.filter((t) => t.text.length > 0));
}

/** A track longer than this is cut into parts: a book that is one chapter must not be one file of many hours. */
export const MAX_TRACK_CHARS = 30_000;

/** Cuts long tracks at line ends into numbered parts, and renumbers all tracks in reading order. */
export function splitLongTracks(plan: AudioTrackPlan[], max = MAX_TRACK_CHARS): AudioTrackPlan[] {
  const out: AudioTrackPlan[] = [];
  for (const track of plan) {
    if (track.text.length <= max) {
      out.push({ ...track, index: out.length + 1 });
      continue;
    }
    const parts: string[] = [];
    let current = '';
    for (const line of track.text.split('\n')) {
      if (current && current.length + line.length + 1 > max) {
        parts.push(current);
        current = line;
      } else {
        current = current ? `${current}\n${line}` : line;
      }
    }
    if (current) parts.push(current);
    for (const [n, text] of parts.entries()) {
      out.push({ index: out.length + 1, title: `${track.title} (${n + 1}/${parts.length})`, text });
    }
  }
  return out;
}

/** Chapter summaries, written by the assistant engine, as the script of the short recording. */
export async function planSummaryAudio(
  doc: BookDocument,
  providers: ProviderService,
  engine: Parameters<typeof runAssistTask>[1],
): Promise<AudioTrackPlan[]> {
  const chapters = new Map<string, { title: string; passages: { label: string; src: string; tgt: string }[] }>();
  for (const section of doc.sections) {
    const key = section.chapter ?? section.id;
    const entry = chapters.get(key) ?? { title: stripMarkup(section.chapter ?? section.title), passages: [] };
    for (const row of section.rows) {
      if (entry.passages.length >= SUMMARY_PASSAGES) break;
      const tgt = stripMarkup(row.tgt || '').trim();
      if (!tgt) continue;
      entry.passages.push({ label: String(entry.passages.length + 1), src: stripMarkup(row.src).slice(0, 8_000), tgt });
    }
    chapters.set(key, entry);
  }

  const plan: AudioTrackPlan[] = [];
  for (const [, chapter] of chapters) {
    if (chapter.passages.length === 0) continue;
    const result = (await runAssistTask(
      providers,
      engine,
      'summary',
      {
        sourceLang: doc.lang.src,
        targetLang: doc.lang.tgt,
        book: { title: doc.title, authors: doc.authors },
      },
      { kind: 'chapter', passages: chapter.passages, glossary: [] },
      60_000,
    )) as { summary?: string; bullets?: string[] } & Record<string, unknown>;
    const body = [result.summary ?? '', ...(result.bullets ?? [])].filter(Boolean).join('\n');
    if (body.trim()) plan.push({ index: plan.length + 1, title: chapter.title, text: `${chapter.title}\n${body}` });
  }
  return plan;
}

/**
 * The script of one track, written the way it should be said (ADR-042). Everything a rule can settle is done
 * first — markup, numbers, units, the bracketed original term — and what needs judgement (which reading a
 * written-without-vowels word takes) goes to the model, line by line, in reading order. A pass that fails leaves
 * the prepared text as it is: a recording that sounds mechanical is better than no recording.
 */
export async function scriptForSpeech(
  deps: Pick<AudioDeps, 'providers' | 'tts'>,
  doc: BookDocument,
  text: string,
  /** Told how far the model pass has got (0–1), so a long chapter does not look stuck. */
  onBatch?: (fraction: number) => void,
): Promise<string> {
  const lang = doc.lang.tgt;
  const prepared = text
    .split('\n')
    .map((line) => speechText(line, lang))
    .filter(Boolean);
  if (prepared.length === 0) return '';
  if (!deps.tts.polish()) return prepared.join('\n');

  const assistant = deps.providers.assistant();
  if (!assistant.ready || assistant.engine === 'mock') return prepared.join('\n');

  const out = [...prepared];
  for (let start = 0; start < prepared.length; start += SPEECH_BATCH_LINES) {
    const slice = prepared.slice(start, start + SPEECH_BATCH_LINES);
    const items = slice.map((src, i) => ({ key: String(start + i + 1).padStart(3, '0'), type: 'p', src }));
    try {
      const result = (await runAssistTask(
        deps.providers,
        assistant.engine as Parameters<typeof runAssistTask>[1],
        'speech',
        { sourceLang: doc.lang.src, targetLang: lang, book: { title: doc.title, authors: doc.authors } },
        { items },
        60_000,
      )) as { items?: { key: string; tgt: string }[] };
      const byKey = new Map((result.items ?? []).map((i) => [i.key, i.tgt]));
      items.forEach((item, i) => {
        const said = byKey.get(item.key)?.trim();
        if (said) out[start + i] = said;
      });
    } catch {
      // The prepared text is already much better than the written one; keep it and read on.
    }
    onBatch?.(Math.min(1, (start + SPEECH_BATCH_LINES) / prepared.length));
  }
  return out.join('\n');
}

/** Seconds of a WAV, read from its header; 0 for MP3, whose length a player reports better than a guess. */
export function audioSeconds(audio: Buffer, format: string): number {
  if (format !== 'wav' || audio.length < 44) return 0;
  const channels = audio.readUInt16LE(22) || 1;
  const rate = audio.readUInt32LE(24) || 22_050;
  const bits = audio.readUInt16LE(34) || 16;
  const bytesPerSecond = (rate * channels * bits) / 8;
  return bytesPerSecond > 0 ? Math.round((audio.length - 44) / bytesPerSecond) : 0;
}

export interface AudioDeps {
  db: Db;
  config: Config;
  tts: TtsService;
  providers: ProviderService;
}

export interface BuildAudioOptions {
  bookId: string;
  lang: string;
  kind: AudioKind;
  /** Chapters done of all, and how far through the whole recording (0–1). */
  onProgress?: (done: number, total: number, fraction: number) => void;
  /** Saved as this; omitted, the source's own format with no conversion. */
  format?: AudioFormat;
  signal?: AbortSignal;
}

/** Records a book and writes the tracks plus a manifest; an earlier recording of the same kind is replaced. */
export async function buildAudio(deps: AudioDeps, opts: BuildAudioOptions): Promise<Manifest> {
  const { db, config, tts, providers } = deps;
  const bundle = getBundle(db, opts.bookId);
  if (!bundle) throw new SpeechError('NOT_FOUND', `book ${opts.bookId} not found`, true);
  const doc = bookDocument(bundle, opts.lang);
  const source = tts.source();
  // The source language's locale, so a run still written in it is spoken in it rather than spelled out.
  const engine = tts.engine(opts.lang, source, getLanguage(doc.lang.src).locale);

  let plan: AudioTrackPlan[];
  if (opts.kind === 'summary') {
    const assistant = providers.assistant();
    if (!assistant.ready || assistant.engine === 'mock') {
      throw new SpeechError('NOT_FOUND', 'A summary needs a connected assistant engine.', true);
    }
    plan = await planSummaryAudio(doc, providers, assistant.engine as Parameters<typeof runAssistTask>[1]);
  } else {
    plan = planFullAudio(doc);
  }
  if (plan.length === 0) throw new SpeechError('NOT_FOUND', 'This book has nothing to read aloud yet.', true);

  const dir = audioDir(config, opts.bookId, opts.lang, opts.kind);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const key = audioKey(opts.bookId, opts.lang, opts.kind);
  audioControl.uncancel(key);
  const checkCancelled = () => {
    if (audioControl.isCancelled(key)) throw new SpeechError('OTHER', CANCELLED);
  };
  const weights = plan.map((p) => Math.max(1, p.text.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let doneWeight = 0;
  const report = (i: number, within: number) =>
    opts.onProgress?.(i, plan.length, Math.min(1, (doneWeight + (weights[i] ?? 0) * within) / totalWeight));
  const beat = () => report(Math.min(tracks.length, plan.length - 1), 0);

  const tracks: AudioTrack[] = [];
  try {
    for (const [i, item] of plan.entries()) {
      report(i, 0);
      await audioControl.whilePaused(key, beat, opts.signal);
      checkCancelled();
      const polishShare = tts.polish() ? 0.3 : 0;
      const script = await scriptForSpeech({ providers, tts }, doc, item.text, (f) => report(i, f * polishShare));
      const segments = splitForSpeech(script, SEGMENT_CHARS);
      const parts: Buffer[] = [];
      let native: AudioFormat = engine.format;
      for (const [n, segment] of segments.entries()) {
        await audioControl.whilePaused(key, beat, opts.signal);
        checkCancelled();
        const spoken = await engine.speak(segment, opts.signal);
        parts.push(spoken.audio);
        native = spoken.format;
        report(i, polishShare + (1 - polishShare) * ((n + 1) / segments.length));
      }
      if (parts.length === 0) throw new SpeechError('OTHER', 'Nothing was spoken for this chapter.');
      let audio = join_(parts, native);
      let format: AudioFormat = native;
      if (opts.format && opts.format !== native) {
        audio = await convertAudio(audio, native, opts.format, opts.signal ? { signal: opts.signal } : {});
        format = opts.format;
      }
      doneWeight += weights[i] ?? 0;
      const id = String(item.index).padStart(3, '0');
      writeFileSync(join(dir, `${id}.${format}`), audio);
      tracks.push({
        id,
        index: item.index,
        title: item.title,
        format,
        bytes: audio.length,
        seconds: audioSeconds(audio, format),
        createdAt: new Date().toISOString(),
      });
    }
  } finally {
    audioControl.clear(key);
  }
  opts.onProgress?.(plan.length, plan.length, 1);

  const manifest: Manifest = {
    kind: opts.kind,
    lang: opts.lang,
    source,
    voice: tts.view().voice,
    tracks,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function readManifest(config: Config, bookId: string, lang: string, kind: AudioKind): Manifest | null {
  const file = join(audioDir(config, bookId, lang, kind), MANIFEST);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** What the library shows for a recording: what exists, and what the job is doing right now. */
export function audioStatus(deps: AudioDeps, bookId: string, lang: string, kind: AudioKind): AudioStatus {
  const { db, config, tts } = deps;
  const manifest = readManifest(config, bookId, lang, kind);
  const row = db.$client
    .prepare(
      `SELECT status, error, progress FROM jobs
        WHERE book_id = ? AND stage = 'audio' AND target_lang = ? AND json_extract(scope, '$.kind') = ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(bookId, lang, kind) as { status?: string; error?: string; progress?: string } | undefined;
  const progress = row?.progress
    ? (JSON.parse(row.progress) as { done: number; total: number; fraction?: number })
    : undefined;
  const running = row?.status === 'queued' || row?.status === 'running';
  return {
    kind,
    lang,
    source: manifest?.source ?? tts.source(),
    voice: manifest?.voice ?? tts.view().voice,
    state: running
      ? audioControl.isPaused(audioKey(bookId, lang, kind))
        ? 'paused'
        : 'running'
      : row?.status === 'failed' && row.error !== CANCELLED
        ? 'failed'
        : manifest
          ? 'done'
          : 'idle',
    done: progress?.done ?? manifest?.tracks.length ?? 0,
    total: progress?.total ?? manifest?.tracks.length ?? 0,
    fraction: running ? (progress?.fraction ?? 0) : manifest ? 1 : 0,
    error: row?.status === 'failed' && row.error !== CANCELLED ? (row.error ?? null) : null,
    tracks: manifest?.tracks ?? [],
  };
}

/** The file of one track, or null when it is not there (a stale link, or a recording that was replaced). */
export function trackFile(
  config: Config,
  bookId: string,
  lang: string,
  kind: AudioKind,
  trackId: string,
): { path: string; track: AudioTrack } | null {
  if (!/^\d{1,4}$/u.test(trackId)) return null;
  const manifest = readManifest(config, bookId, lang, kind);
  const track = manifest?.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const path = join(audioDir(config, bookId, lang, kind), `${track.id}.${track.format}`);
  return existsSync(path) ? { path, track } : null;
}

/**
 * The whole recording as one file: every track in reading order. Kept next to the tracks and made again only when
 * the recording is newer than it, so a second download does not wait.
 */
export async function mergedFile(
  config: Config,
  bookId: string,
  lang: string,
  kind: AudioKind,
): Promise<{ path: string; format: AudioFormat; bytes: number } | null> {
  const manifest = readManifest(config, bookId, lang, kind);
  const tracks = [...(manifest?.tracks ?? [])].sort((a, b) => a.index - b.index);
  const first = tracks[0];
  if (!manifest || !first) return null;
  const format = first.format;
  const dir = audioDir(config, bookId, lang, kind);
  const name = `all.${format}`;
  const target = join(dir, name);
  const stale = !existsSync(target) || statSync(target).mtimeMs < statSync(join(dir, MANIFEST)).mtimeMs;
  if (stale) {
    const names = tracks.map((t) => `${t.id}.${t.format}`);
    if (names.some((n) => !existsSync(join(dir, n)))) return null;
    if (names.length === 1) copyFileSync(join(dir, names[0] as string), target);
    else if (onPath('ffmpeg')) await concatAudio(dir, names, name);
    else if (format === 'wav' || format === 'mp3') {
      writeFileSync(
        target,
        join_(
          names.map((n) => readFileSync(join(dir, n))),
          format,
        ),
      );
    } else {
      throw new SpeechError('NOT_FOUND', `Joining ${format.toUpperCase()} files needs ffmpeg.`, true);
    }
  }
  return { path: target, format, bytes: statSync(target).size };
}

/** Title for the downloaded file, from the book itself. */
export function bookTitleFor(db: Db, bookId: string): string {
  const row = getBookRow(db, bookId);
  return row ? (row.titles[row.sourceLang] ?? bookId).replace(/\.pdf$/iu, '') : bookId;
}
