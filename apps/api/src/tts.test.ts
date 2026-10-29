import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AudioStatus, TtsView } from '@dozabaneh/shared';
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { bookDocument } from './export/document';
import { audioSeconds, planFullAudio, scriptForSpeech } from './tts/audio';
import { createSpeechEngine, joinWav, resolveProgram, SpeechError, splitForSpeech } from './tts/engines';

/**
 * Reading a book aloud (SPEC §13.9, ADR-041). The services are reached with an injected `fetch` and Piper with a
 * stand-in program, the same way the translation providers are tested — no key and no network here.
 */
const FAKE_PIPER = fileURLToPath(new URL('./testing/fake-piper.mjs', import.meta.url));

const wav = (samples: number): Buffer => {
  const data = Buffer.alloc(samples * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(22_050, 24);
  head.writeUInt32LE(44_100, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
};

describe('splitting text for a voice', () => {
  it('cuts at sentence ends and never exceeds the limit', () => {
    const text = `${'یک '.repeat(40)}. ${'دو '.repeat(40)}. ${'سه '.repeat(40)}.`;
    const parts = splitForSpeech(text, 150);
    expect(parts.length).toBeGreaterThan(1);
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThanOrEqual(150);
    expect(parts.join(' ').replace(/\s+/gu, ' ')).toBe(text.replace(/\s+/gu, ' ').trim());
  });

  it('keeps short text in one piece and drops empty text', () => {
    expect(splitForSpeech('سلام دنیا.', 4_000)).toEqual(['سلام دنیا.']);
    expect(splitForSpeech('   ', 100)).toEqual([]);
  });
});

describe('joining audio', () => {
  it('makes one WAV out of several, with one header and the summed length', () => {
    const joined = joinWav([wav(100), wav(50)]);
    expect(joined.length).toBe(44 + 300);
    expect(joined.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(joined.readUInt32LE(40)).toBe(300);
    expect(joined.readUInt32LE(4)).toBe(joined.length - 8);
  });

  it('reads a WAV length from its header, and does not guess an MP3', () => {
    expect(audioSeconds(wav(22_050), 'wav')).toBe(1);
    expect(audioSeconds(Buffer.from([0xff, 0xfb, 0x90]), 'mp3')).toBe(0);
  });
});

describe('the services', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (body: string | Uint8Array, init: ResponseInit = {}) =>
    (async (url: string | URL | Request, request?: RequestInit) => {
      calls.push({ url: String(url), init: request ?? {} });
      return new Response(body, { status: 200, ...init });
    }) as unknown as typeof fetch;

  it('asks Azure in SSML, with the voice and the book language', async () => {
    calls.length = 0;
    const engine = createSpeechEngine('azure', {
      apiKey: 'key-0123456789',
      region: 'westeurope',
      voice: 'fa-IR-DilaraNeural',
      lang: 'fa',
      fetch: fakeFetch(new Uint8Array([1, 2, 3])),
    });
    const out = await engine.speak('سلام.');
    expect(out.format).toBe('mp3');
    expect(out.audio.length).toBe(3);
    const call = calls[0] as { url: string; init: RequestInit };
    expect(call.url).toContain('westeurope.tts.speech.microsoft.com');
    expect(String(call.init.body)).toContain('fa-IR-DilaraNeural');
    expect(String(call.init.body)).toContain('xml:lang="fa"');
  });

  it('decodes what Google sends and joins the pieces of a long text', async () => {
    calls.length = 0;
    const engine = createSpeechEngine('google', {
      apiKey: 'key-0123456789',
      voice: 'fa-IR-Wavenet-A',
      lang: 'fa',
      fetch: fakeFetch(JSON.stringify({ audioContent: Buffer.from('ab').toString('base64') }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const out = await engine.speak(`${'کلمه '.repeat(600)}.`);
    expect(calls.length).toBeGreaterThan(1);
    expect(out.audio.length).toBe(calls.length * 2);
    expect(calls[0]?.url).toContain('texttospeech.googleapis.com');
  });

  it('sends the OpenAI key as a bearer token', async () => {
    calls.length = 0;
    const engine = createSpeechEngine('openai', {
      apiKey: 'key-0123456789',
      voice: 'nova',
      lang: 'fa',
      fetch: fakeFetch(new Uint8Array([9])),
    });
    await engine.speak('سلام.');
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer key-0123456789');
    expect(String(calls[0]?.init.body)).toContain('"voice":"nova"');
  });

  it('turns a rejected key into a blocking problem, not a retry', async () => {
    const engine = createSpeechEngine('azure', {
      apiKey: 'key-0123456789',
      region: 'westeurope',
      voice: 'v',
      lang: 'fa',
      fetch: (async () => new Response('no', { status: 401 })) as unknown as typeof fetch,
    });
    const err = (await engine.speak('سلام.').catch((e: unknown) => e)) as SpeechError;
    expect(err).toBeInstanceOf(SpeechError);
    expect(err.code).toBe('AUTH');
    expect(err.blocking).toBe(true);
  });

  it('says what is missing before it asks for anything', async () => {
    const noKey = createSpeechEngine('openai', { voice: 'nova', lang: 'fa' });
    await expect(noKey.speak('سلام.')).rejects.toThrow(/key/iu);
    const noRegion = createSpeechEngine('azure', { apiKey: 'key-0123456789', voice: 'v', lang: 'fa' });
    await expect(noRegion.speak('سلام.')).rejects.toThrow(/region/iu);
  });

  it('runs a script stand-in for Piper with this Node', () => {
    expect(resolveProgram('C:/fake/piper.mjs')).toEqual({ file: process.execPath, prefix: ['C:/fake/piper.mjs'] });
    expect(resolveProgram('piper')).toEqual({ file: 'piper', prefix: [] });
  });

  it('reads with Piper and gets one WAV back', async () => {
    const engine = createSpeechEngine('piper', { voice: '', binPath: FAKE_PIPER, voicePath: 'fa.onnx', lang: 'fa' });
    const out = await engine.speak('سلام دنیا.');
    expect(out.format).toBe('wav');
    expect(out.audio.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(out.audio.length).toBeGreaterThan(44);
  });
});

describe('what gets read', () => {
  it('makes one track per chapter, in reading order, with no markup', () => {
    const plan = planFullAudio(bookDocument(sampleBook, 'fa'));
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.map((t) => t.index)).toEqual(plan.map((_t, i) => i + 1));
    const text = plan.map((t) => t.text).join('\n');
    expect(text).toMatch(/[آ-ی]/u);
    // Markup tokens are for the page, not for a voice.
    expect(text).not.toMatch(/\[\^|\[\[fig:|\*\*/u);
  });
});

describe('the script a voice is given', () => {
  const doc = bookDocument(sampleBook, 'fa');

  it('prepares each line by rule when the model pass is off', async () => {
    const tts = { polish: () => false } as unknown as Parameters<typeof scriptForSpeech>[0]['tts'];
    const providers = { assistant: () => ({ engine: 'mock', ready: false }) } as unknown as Parameters<
      typeof scriptForSpeech
    >[0]['providers'];
    const script = await scriptForSpeech({ tts, providers }, doc, 'بی‌هوشی (Anesthesia) تا ۲۰٪ *کم* می‌شود[^3].');
    expect(script).not.toContain('Anesthesia');
    expect(script).not.toContain('[^3]');
    expect(script).not.toContain('*');
    expect(script).toContain('بیست درصد');
  });

  it('keeps the prepared text when the model pass has no engine to run on', async () => {
    const tts = { polish: () => true } as unknown as Parameters<typeof scriptForSpeech>[0]['tts'];
    const providers = { assistant: () => ({ engine: 'mock', ready: true }) } as unknown as Parameters<
      typeof scriptForSpeech
    >[0]['providers'];
    const script = await scriptForSpeech({ tts, providers }, doc, 'فشار ۱۲۰ mmHg بود.');
    expect(script).toContain('میلی‌متر جیوه');
    expect(script).toContain('صد و بیست');
  });
});

describe('the audio routes', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-audio-'));
  const appPromise = buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }), { startRunner: false });
  afterAll(async () => {
    await (await appPromise).close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const settings = async (): Promise<TtsView> =>
    (await (await appPromise).inject({ url: '/api/v1/settings/tts' })).json();

  it('starts with the browser voice, which writes no file', async () => {
    const app = await appPromise;
    expect(await settings()).toMatchObject({ source: 'browser', needsKey: false });
    const res = await app.inject({ method: 'POST', url: '/api/v1/books/bk_sample/audio', payload: { kind: 'full' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TTS_BROWSER_ONLY');
  });

  it('records the book once a source is set, one file per chapter', async () => {
    const app = await appPromise;
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/tts',
      payload: { source: 'piper', binPath: FAKE_PIPER, voicePath: 'fa.onnx' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ source: 'piper', ready: true, format: expect.stringMatching(/mp3|wav/u) });

    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/books/bk_sample/audio',
      payload: { kind: 'full', lang: 'fa' },
    });
    expect(started.statusCode).toBe(200);
    await app.ctx.runner.drain();

    const status = (await app.inject({ url: '/api/v1/books/bk_sample/audio?kind=full&lang=fa' })).json() as AudioStatus;
    expect(status.state).toBe('done');
    expect(status.tracks.length).toBeGreaterThan(0);
    expect(status.source).toBe('piper');
    const track = status.tracks[0] as AudioStatus['tracks'][number];
    expect(track.format).toBe('wav');
    expect(track.bytes).toBeGreaterThan(44);

    const file = await app.inject({ url: `/api/v1/books/bk_sample/audio/${track.id}?kind=full&lang=fa` });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('audio/wav');
    expect(file.headers['content-disposition']).toContain('.wav"');
    expect(file.rawPayload.subarray(0, 4).toString('latin1')).toBe('RIFF');

    expect((await app.inject({ url: '/api/v1/books/bk_sample/audio/999?kind=full&lang=fa' })).statusCode).toBe(404);
  });

  it('keeps the key out of every answer', async () => {
    const app = await appPromise;
    const secret = 'super-secret-tts-key-123456';
    await app.inject({ method: 'PUT', url: '/api/v1/settings/tts', payload: { source: 'openai', apiKey: secret } });
    const view = await settings();
    expect(view).toMatchObject({ source: 'openai', hasKey: true, needsKey: true });
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(view.keyHint).toBe(`…${secret.slice(-4)}`);
    const raw = app.ctx.db.$client.prepare("SELECT value FROM app_settings WHERE key = 'tts'").get() as {
      value: string;
    };
    expect(JSON.stringify(raw.value)).not.toContain(secret);
  });
});
