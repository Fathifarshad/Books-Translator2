import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AudioFormat } from '@dozabaneh/shared';
import { onPath, SpeechError } from './engines';

/** How ffmpeg writes each format. Opus in an Ogg file is small and plays on every phone; AAC goes in an M4A. */
const ENCODE: Record<AudioFormat, string[]> = {
  mp3: ['-codec:a', 'libmp3lame', '-q:a', '4'],
  wav: ['-codec:a', 'pcm_s16le'],
  ogg: ['-codec:a', 'libopus', '-b:a', '48k'],
  m4a: ['-codec:a', 'aac', '-b:a', '64k'],
};

/**
 * Joins files of one format into one without re-encoding (ffmpeg's concat list), so a book recorded in parts can
 * be had as a single file whose length a player reports correctly. Names are relative to `dir`, which keeps odd
 * characters in a data folder's path out of the list file.
 */
export async function concatAudio(dir: string, names: string[], to: string): Promise<void> {
  const ffmpeg = onPath('ffmpeg');
  if (!ffmpeg) throw new SpeechError('NOT_FOUND', 'Joining the files needs ffmpeg.', true);
  const list = `${to}.list.txt`;
  await writeFile(join(dir, list), names.map((n) => `file '${n}'`).join('\n'), 'utf8');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-i', list, '-c', 'copy', to], {
        cwd: dir,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let err = '';
      child.stderr?.setEncoding('utf8').on('data', (c: string) => {
        err += c;
      });
      child.on('error', (e) => reject(new SpeechError('OTHER', `ffmpeg could not be started: ${e.message}`)));
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new SpeechError('OTHER', `ffmpeg failed: ${err.slice(0, 200)}`)),
      );
    });
  } finally {
    await rm(join(dir, list), { force: true });
  }
}

/**
 * Turns a finished recording into another format with ffmpeg. Files, not pipes: M4A cannot be written to a pipe,
 * and a temp folder keeps one code path for all four.
 */
export async function convertAudio(
  audio: Buffer,
  from: AudioFormat,
  to: AudioFormat,
  opts: { spawn?: typeof spawn; signal?: AbortSignal } = {},
): Promise<Buffer> {
  if (from === to) return audio;
  const ffmpeg = onPath('ffmpeg');
  if (!ffmpeg) {
    throw new SpeechError(
      'NOT_FOUND',
      `Saving as ${to.toUpperCase()} needs ffmpeg; install it or pick another format.`,
      true,
    );
  }
  const dir = await mkdtemp(join(tmpdir(), 'dozabaneh-ffmpeg-'));
  try {
    const input = join(dir, `in.${from}`);
    const output = join(dir, `out.${to}`);
    await writeFile(input, audio);
    await new Promise<void>((resolve, reject) => {
      const child = (opts.spawn ?? spawn)(ffmpeg, ['-y', '-loglevel', 'error', '-i', input, ...ENCODE[to], output], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let err = '';
      child.stderr?.setEncoding('utf8').on('data', (c: string) => {
        err += c;
      });
      opts.signal?.addEventListener('abort', () => child.kill(), { once: true });
      child.on('error', (e) => reject(new SpeechError('OTHER', `ffmpeg could not be started: ${e.message}`)));
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new SpeechError('OTHER', `ffmpeg failed: ${err.slice(0, 200)}`)),
      );
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
