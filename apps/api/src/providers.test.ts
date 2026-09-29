import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BookBundle, PipelineStatus, ProviderTestResult, ProviderView } from '@dozabaneh/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { chunkWordsFor } from './pipeline/jobs';
import { createSecretBox } from './settings/secrets';
import { FAKE_KEY, startFakeProvider } from './testing/fake-provider';

/**
 * Phase 4 integration: free providers against a fake OpenAI-compatible server — encrypted keys, settings routes,
 * the one-click OpenRouter connection (OAuth PKCE), and the pipeline running on a provider with rate limits,
 * rejected keys and a repair round.
 */
const FIXTURES = fileURLToPath(new URL('../../../fixtures/pdf/', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-providers-'));
const fake = await startFakeProvider();
const config = readConfig({
  LOG_LEVEL: 'silent',
  DATA_DIR: dataDir,
  AUTO_SEED: '0',
  GEMINI_BASE_URL: `${fake.url}/gemini`,
  OLLAMA_BASE_URL: `${fake.url}/ollama/v1`,
  OPENROUTER_BASE_URL: `${fake.url}/openrouter/api/v1`,
  OPENROUTER_AUTH_URL: `${fake.url}/openrouter/auth`,
});
const app = await buildApp(config, { startRunner: false });

afterAll(async () => {
  await app.close();
  await fake.close();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  fake.failures.length = 0;
  fake.contents.length = 0;
});

const views = async (): Promise<ProviderView[]> =>
  (await app.inject({ url: '/api/v1/settings/providers' })).json().providers;
const viewOf = async (id: string) => (await views()).find((p) => p.id === id) as ProviderView;
const put = (id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/v1/settings/providers/${id}`, payload });
const test = async (id: string): Promise<ProviderTestResult & { provider: ProviderView }> =>
  (await app.inject({ method: 'POST', url: `/api/v1/settings/providers/${id}/test` })).json();
const statusOf = async (id: string): Promise<PipelineStatus> =>
  (await app.inject({ url: `/api/v1/books/${id}/pipeline?lang=fa` })).json();
const bundleOf = async (id: string): Promise<BookBundle> =>
  (await app.inject({ url: `/api/v1/books/${id}/bundle` })).json();

async function ingestFixture(file: string): Promise<string> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const body = new FormData();
  body.append('file', new Blob([readFileSync(join(FIXTURES, file))], { type: 'application/pdf' }), file);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/books`, { method: 'POST', body });
  const bookId = ((await res.json()) as { bookId: string }).bookId;
  await app.ctx.runner.drain();
  await app.inject({ method: 'PATCH', url: `/api/v1/books/${bookId}/structure`, payload: { op: 'confirm' } });
  return bookId;
}

const start = (bookId: string, engine: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/books/${bookId}/pipeline/start`,
    payload: {
      lang: 'fa',
      settings: {
        engines: { brief: engine, glossary: engine, translate: engine, edit: engine },
        autoApproveGlossary: true,
      },
    },
  });

describe('secret box', () => {
  it('encrypts keys and refuses values sealed with another secret', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dozabaneh-secret-'));
    try {
      const box = createSecretBox(undefined, dir);
      const sealed = box.encrypt('my-secret-key');
      expect(sealed).not.toContain('my-secret-key');
      expect(sealed).not.toBe(box.encrypt('my-secret-key'));
      expect(box.decrypt(sealed)).toBe('my-secret-key');
      // The generated key file is reused; the example APP_SECRET counts as unset.
      expect(createSecretBox('change-me-to-a-long-random-string', dir).decrypt(sealed)).toBe('my-secret-key');
      expect(createSecretBox('another-long-app-secret-value', dir).decrypt(sealed)).toBeNull();
      expect(box.decrypt('garbage')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('provider settings', () => {
  it('lists the providers, none ready before setup (Ollama needs no key)', async () => {
    const list = await views();
    expect(list.map((p) => p.id)).toEqual(['gemini', 'ollama', 'openrouter']);
    const gemini = list[0] as ProviderView;
    expect(gemini).toMatchObject({ needsKey: true, hasKey: false, ready: false, oneClick: false });
    expect(gemini.keyUrl).toContain('aistudio.google.com');
    expect(list.find((p) => p.id === 'ollama')).toMatchObject({ needsKey: false, ready: false });
    expect(list.find((p) => p.id === 'openrouter')?.oneClick).toBe(true);
  });

  it('stores a pasted key encrypted and never returns it', async () => {
    const res = await put('gemini', { apiKey: FAKE_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(FAKE_KEY);
    expect(res.json()).toMatchObject({ hasKey: true, keyHint: `…${FAKE_KEY.slice(-4)}`, connectedVia: 'manual' });
    const raw = app.ctx.db.$client.prepare("SELECT value FROM app_settings WHERE key = 'provider:gemini'").get() as {
      value: string;
    };
    expect(raw.value).not.toContain(FAKE_KEY);
    expect((await app.inject({ url: '/api/v1/settings/providers' })).body).not.toContain(FAKE_KEY);
  });

  it('tests the connection, picking a default model', async () => {
    const result = await test('gemini');
    expect(result).toMatchObject({ ok: true, model: 'gemini-flash-lite-latest', sample: 'OK' });
    expect(result.models?.map((m) => m.id)).toContain('gemini-pro-latest');
    expect(result.provider.ready).toBe(true);
    expect(result.provider.usage.usedToday).toBe(1);
    const chat = fake.requests.filter((r) => r.path === '/gemini/chat/completions').at(-1);
    expect(chat?.auth).toBe(`Bearer ${FAKE_KEY}`);
  });

  it('reports a rejected key as a blocking problem until the settings change', async () => {
    await put('openrouter', { apiKey: 'wrong-key-value', model: 'vendor/good-model:free' });
    const result = await test('openrouter');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AUTH');
    expect(result.provider.problem).toMatchObject({ code: 'AUTH', blocking: true });
    expect(result.provider.ready).toBe(false);
    const cleared = (await put('openrouter', { apiKey: null })).json() as ProviderView;
    expect(cleared).toMatchObject({ hasKey: false, problem: null });
  });

  it('validates the input', async () => {
    expect((await put('gemini', { apiKey: 'short' })).statusCode).toBe(400);
    expect((await put('gemini', { limits: { rpm: 0, rpd: 5 } })).statusCode).toBe(400);
    expect((await put('nope', { model: 'x' })).statusCode).toBe(404);
  });

  it('detects Ollama and lists its models without a key', async () => {
    const models = (await app.inject({ url: '/api/v1/settings/providers/ollama/models' })).json().models;
    expect(models.map((m: { id: string }) => m.id)).toEqual(['aya-expanse:8b', 'nomic-embed-text:latest']);
    const result = await test('ollama');
    expect(result).toMatchObject({ ok: true, model: 'aya-expanse:8b' });
    const down = await put('ollama', { baseUrl: 'http://127.0.0.1:9/v1' });
    expect(down.statusCode).toBe(200);
    const res = await app.inject({ url: '/api/v1/settings/providers/ollama/models' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('PROVIDER_NETWORK');
    await put('ollama', { baseUrl: null });
  });
});

describe('one-click OpenRouter connection (OAuth PKCE)', () => {
  it('connects with one click and picks a free model', async () => {
    const connect = await app.inject({
      url: '/api/v1/settings/providers/openrouter/connect?return=http://localhost:5173/settings%3Ftab%3Dengines',
      headers: { host: 'localhost:5173' },
    });
    expect(connect.statusCode).toBe(302);
    const auth = new URL(connect.headers.location as string);
    expect(`${auth.origin}${auth.pathname}`).toBe(`${fake.url}/openrouter/auth`);
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = new URL(auth.searchParams.get('callback_url') as string);
    expect(callback.origin).toBe('http://localhost:5173');

    // The user clicks «Authorize» on OpenRouter's page.
    const page = await (await fetch(auth)).text();
    const authorized = new URL(/id="authorize" href="([^"]+)"/u.exec(page)?.[1]?.replace(/&amp;/gu, '&') ?? '');
    expect(authorized.searchParams.get('code')).toBeTruthy();
    const back = await app.inject({ url: `${authorized.pathname}${authorized.search}` });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe('http://localhost:5173/settings?tab=engines&connected=openrouter');

    const view = await viewOf('openrouter');
    expect(view).toMatchObject({
      hasKey: true,
      connectedVia: 'oauth',
      model: 'vendor/good-model:free',
      ready: true,
    });
    expect((await test('openrouter')).ok).toBe(true);

    // The code and the state are single use.
    const replay = await app.inject({ url: `${authorized.pathname}${authorized.search}` });
    expect(replay.headers.location).toContain('connect_error=EXPIRED');
  });

  it('returns with an error when the user denies, and never redirects to a foreign site', async () => {
    const connect = await app.inject({
      url: '/api/v1/settings/providers/openrouter/connect?return=https://evil.example/steal',
      headers: { host: 'localhost:5173' },
    });
    const callback = new URL(new URL(connect.headers.location as string).searchParams.get('callback_url') as string);
    const denied = await app.inject({ url: callback.pathname });
    expect(denied.headers.location).toBe('http://localhost:5173/settings?connect_error=DENIED');
  });
});

describe('pipeline on a free provider', () => {
  let bookId = '';

  it('refuses to start while the chosen provider is not connected', async () => {
    bookId = await ingestFixture('outline-book.pdf');
    await put('gemini', { apiKey: null });
    const res = await start(bookId, 'gemini');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'PROVIDER_NOT_READY', details: { providers: ['gemini'] } });
  });

  it('translates the book through the provider, waiting out a 429 without using up attempts', async () => {
    await put('gemini', { apiKey: FAKE_KEY, model: 'gemini-flash-lite-latest', limits: { rpm: 1000, rpd: 5000 } });
    fake.failures.push({
      status: 429,
      body: { error: { message: 'Resource exhausted' } },
      headers: { 'retry-after': '0' },
    });
    expect((await start(bookId, 'gemini')).statusCode).toBe(200);
    await app.ctx.runner.drain();

    let status = await statusOf(bookId);
    for (let i = 0; i < 5 && status.state !== 'done'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      await app.ctx.runner.drain();
      status = await statusOf(bookId);
    }
    expect(status.state).toBe('done');
    expect(status.errors).toEqual([]);
    expect(status.providers).toEqual([expect.objectContaining({ id: 'gemini', ready: true })]);
    expect(status.log.some((l) => l.message.includes('gemini: Rate limited (429)'))).toBe(true);

    const bundle = await bundleOf(bookId);
    const fa = bundle.translations.filter((t) => t.lang === 'fa');
    expect(fa.length).toBeGreaterThan(0);
    expect(new Set(fa.map((t) => t.engine))).toEqual(new Set(['gemini']));
    expect(bundle.book.status).toBe('ready');

    const jobs = app.ctx.db.$client
      .prepare("SELECT attempts, tokens_in AS tin FROM jobs WHERE book_id = ? AND engine = 'gemini'")
      .all(bookId) as { attempts: number; tin: number }[];
    expect(jobs.every((j) => j.attempts === 1)).toBe(true);
    expect(jobs.every((j) => j.tin > 0)).toBe(true);
    // The system prompt comes from prompts/ and the answer format from the task's JSON schema.
    const first = fake.requests.find(
      (r) => r.path === '/gemini/chat/completions' && JSON.stringify(r.body).includes('Task'),
    );
    expect(JSON.stringify(first?.body)).toContain('JSON Schema');
  });

  it('pauses the provider on a rejected key and resumes after the key is fixed', async () => {
    const other = await ingestFixture('no-outline.pdf');
    await put('ollama', { model: 'aya-expanse:8b' });
    fake.failures.push({ status: 401, body: { error: { message: 'unauthorized' } } });
    expect((await start(other, 'ollama')).statusCode).toBe(200);
    await app.ctx.runner.drain();
    let status = await statusOf(other);
    expect(status.providers[0]).toMatchObject({ id: 'ollama', ready: false, problem: { code: 'AUTH' } });
    expect(status.errors).toEqual([]);
    const waiting = app.ctx.db.$client
      .prepare("SELECT status, attempts FROM jobs WHERE book_id = ? AND stage = 'brief'")
      .get(other) as { status: string; attempts: number };
    expect(waiting).toEqual({ status: 'queued', attempts: 0 });

    await put('ollama', { model: 'aya-expanse:8b' });
    await app.ctx.runner.drain();
    status = await statusOf(other);
    expect(status.state).toBe('done');
    expect(status.providers[0]?.problem).toBeNull();
  });

  it('sends the validation errors back once and accepts the repaired answer', async () => {
    const again = await ingestFixture('two-column.pdf');
    fake.contents.push('Sorry, here is some prose instead of JSON.');
    expect((await start(again, 'gemini')).statusCode).toBe(200);
    await app.ctx.runner.drain();
    const status = await statusOf(again);
    expect(status.state).toBe('done');
    expect(status.errors).toEqual([]);
    const repair = fake.requests.find((r) => JSON.stringify(r.body).includes('was not valid JSON'));
    expect(repair).toBeTruthy();
  });

  it('uses smaller chunks for slow local models', () => {
    expect(chunkWordsFor('ollama', 'translate')).toBeLessThan(chunkWordsFor('gemini', 'translate'));
    expect(chunkWordsFor('mock', 'edit')).toBe(chunkWordsFor('gemini', 'edit'));
  });
});
