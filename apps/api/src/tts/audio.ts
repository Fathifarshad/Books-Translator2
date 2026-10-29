import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AudioKind, AudioStatus, AudioTrack, TtsSource } from '@dozabaneh/shared';
import { stripMarkup } from '@dozabaneh/text';
import { runAssistTask } from '../assist/task';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { getBookRow, getBundle } from '../db/repo';
import { type BookDocument, bookDocument } from '../export/document';
import type { ProviderService } from '../settings/providers';
import { SpeechError } from './engines';
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
/** Rows of a chapter offered to the assistant engine when it writes the summary. */
const SUMMARY_PASSAGES = 120;

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
  return plan.filter((t) => t.text.length > 0);
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
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Records a book and writes the tracks plus a manifest; an earlier recording of the same kind is replaced. */
export async function buildAudio(deps: AudioDeps, opts: BuildAudioOptions): Promise<Manifest> {
  const { db, config, tts, providers } = deps;
  const bundle = getBundle(db, opts.bookId);
  if (!bundle) throw new SpeechError('NOT_FOUND', `book ${opts.bookId} not found`, true);
  const doc = bookDocument(bundle, opts.lang);
  const source = tts.source();
  const engine = tts.engine(opts.lang);

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

  const tracks: AudioTrack[] = [];
  for (const [i, item] of plan.entries()) {
    opts.onProgress?.(i, plan.length);
    const { audio, format } = await engine.speak(item.text, opts.signal);
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
  opts.onProgress?.(plan.length, plan.length);

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
  const progress = row?.progress ? (JSON.parse(row.progress) as { done: number; total: number }) : undefined;
  const running = row?.status === 'queued' || row?.status === 'running';
  return {
    kind,
    lang,
    source: manifest?.source ?? tts.source(),
    voice: manifest?.voice ?? tts.view().voice,
    state: running ? 'running' : row?.status === 'failed' ? 'failed' : manifest ? 'done' : 'idle',
    done: progress?.done ?? manifest?.tracks.length ?? 0,
    total: progress?.total ?? manifest?.tracks.length ?? 0,
    error: row?.status === 'failed' ? (row.error ?? null) : null,
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

/** Title for the downloaded file, from the book itself. */
export function bookTitleFor(db: Db, bookId: string): string {
  const row = getBookRow(db, bookId);
  return row ? (row.titles[row.sourceLang] ?? bookId) : bookId;
}
