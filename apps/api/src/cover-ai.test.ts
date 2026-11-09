import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASK_SPECS } from '@dozabaneh/ai';
import type { CoverAiStatus, CoverConcept, CoverDesignTaskInput, PainterView } from '@dozabaneh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { bookSubject, CoverAiService } from './cover-ai/designer';
import { comfyRecipe, comfyWorkflow, type FetchLike, imageMime, PainterService } from './cover-ai/painter';
import { openDb } from './db/client';
import { getBundle } from './db/repo';
import { listImages } from './export/book/cover-design';
import { FontRegistry } from './fonts/registry';
import { createSecretBox } from './settings/secrets';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a46494600010101004800480000', 'hex');
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'cf-token-abcdefghijklmnopqrstuvwxyz';

interface Call {
  url: string;
  init?: RequestInit | undefined;
}

/** A stand-in for Cloudflare and ComfyUI: answers by address, records every call. */
function fakeHttp(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new TypeError('fetch failed: ECONNREFUSED');
    return hit[1]({ url, init });
  };
  return { fetch, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function painterWith(fetch: FetchLike) {
  const dir = mkdtempSync(join(tmpdir(), 'dozabaneh-painter-'));
  const db = openDb(dir, ':memory:');
  const painter = new PainterService(db, createSecretBox(undefined, dir), fetch, async () => {});
  return { painter, dir };
}

const concept = (o: Partial<CoverConcept> = {}): CoverConcept => ({
  name: 'آبی آرام',
  rationale: 'آرام و دقیق.',
  layout: 'bottom-title',
  palette: { ground: '#16264a', ground2: '#0b1530', ink: '#f6f1e3', accent: '#c9a54a' },
  ground: 'image',
  pattern: 'none',
  frame: 'none',
  titleFont: 'estedad',
  bodyFont: 'vazirmatn',
  titleWeight: 800,
  titleScale: 1,
  imagePrompt: 'A calm watercolour of a sea at dawn',
  ...o,
});

describe('cover illustrator', () => {
  it('stores the Cloudflare token encrypted and shows only its end', () => {
    const { painter, dir } = painterWith(fakeHttp({}).fetch);
    try {
      expect(painter.view()).toMatchObject({
        engine: 'none',
        cloudflare: { hasToken: false, model: 'flux-2-klein-4b' },
      });
      const v: PainterView = painter.update({
        engine: 'cloudflare',
        cloudflareAccountId: ACCOUNT.toUpperCase(),
        cloudflareToken: TOKEN,
      });
      expect(v.cloudflare).toEqual({
        accountId: ACCOUNT,
        hasToken: true,
        tokenHint: '…wxyz',
        model: 'flux-2-klein-4b',
      });
      expect(JSON.stringify(v)).not.toContain(TOKEN);
      expect(painter.ready()).toEqual(['cloudflare']);
      expect(painter.update({ cloudflareToken: null }).cloudflare.hasToken).toBe(false);
      expect(painter.ready()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('draws a portrait with FLUX.2 klein from form fields, and a square with FLUX.1 schnell from JSON', async () => {
    const http = fakeHttp({ '/ai/run/': () => json({ success: true, result: { image: JPEG.toString('base64') } }) });
    const { painter, dir } = painterWith(http.fetch);
    try {
      painter.update({ engine: 'cloudflare', cloudflareAccountId: ACCOUNT, cloudflareToken: TOKEN });
      const art = await painter.paint('a quiet sea');
      expect(art).toMatchObject({ mime: 'image/jpeg', engine: 'cloudflare' });
      const klein = http.calls[0];
      expect(klein?.url).toBe(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`,
      );
      const headers = (klein?.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
      const form = klein?.init?.body as FormData;
      expect([form.get('prompt'), form.get('width'), form.get('height')]).toEqual(['a quiet sea', '768', '1088']);

      painter.update({ cloudflareModel: 'flux-1-schnell' });
      await painter.paint('a quiet sea');
      // schnell takes no seed and no size (its schema forbids extra fields).
      expect(JSON.parse(http.calls[1]?.init?.body as string)).toEqual({ prompt: 'a quiet sea', steps: 8 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names Cloudflare’s refusals: token, daily allowance, anything else', async () => {
    for (const [status, message, code] of [
      [401, 'Authentication error', 'AUTH'],
      [429, 'Too many requests', 'QUOTA'],
      [400, 'you have used up your daily free allocation of 10,000 neurons', 'QUOTA'],
      [500, 'Internal', 'BAD_RESPONSE'],
    ] as const) {
      const { painter, dir } = painterWith(
        fakeHttp({ '/ai/run/': () => json({ success: false, errors: [{ message }] }, status) }).fetch,
      );
      try {
        painter.update({ engine: 'cloudflare', cloudflareAccountId: ACCOUNT, cloudflareToken: TOKEN });
        await expect(painter.paint('x')).rejects.toMatchObject({ code });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('checks a token without drawing', async () => {
    const http = fakeHttp({
      '/user/tokens/verify': () => json({ success: false }, 401),
      [`/accounts/${ACCOUNT}/tokens/verify`]: () => json({ success: true, result: { status: 'active' } }),
    });
    const { painter, dir } = painterWith(http.fetch);
    try {
      expect(await painter.test('cloudflare')).toMatchObject({ ok: false, error: 'NOT_CONFIGURED' });
      painter.update({ cloudflareAccountId: ACCOUNT, cloudflareToken: TOKEN });
      expect(await painter.test('cloudflare')).toMatchObject({ ok: true, engine: 'cloudflare' });
      expect(http.calls.some((c) => c.url.includes('/ai/run/'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('draws on this computer through ComfyUI, and falls back to it when Cloudflare fails', async () => {
    let polls = 0;
    const http = fakeHttp({
      '/ai/run/': () => json({ errors: [{ message: 'daily free allocation' }] }, 429),
      '/object_info/CheckpointLoaderSimple': () =>
        json({
          CheckpointLoaderSimple: {
            input: { required: { ckpt_name: [['flux1-schnell-fp8.safetensors', 'sdxl.safetensors']] } },
          },
        }),
      '/prompt': () => json({ prompt_id: 'p1' }),
      '/history/p1': () =>
        json(
          ++polls < 2
            ? {}
            : { p1: { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } },
        ),
      '/view?': () => new Response(PNG),
    });
    const { painter, dir } = painterWith(http.fetch);
    try {
      painter.update({ comfyUrl: 'http://127.0.0.1:8188/' });
      const test = await painter.test('comfy');
      expect(test).toMatchObject({ ok: true, checkpoints: ['flux1-schnell-fp8.safetensors', 'sdxl.safetensors'] });
      painter.update({
        engine: 'cloudflare',
        cloudflareAccountId: ACCOUNT,
        cloudflareToken: TOKEN,
        comfyCheckpoint: 'flux1-schnell-fp8.safetensors',
      });
      expect(painter.ready()).toEqual(['cloudflare', 'comfy']);
      const art = await painter.paint('a quiet sea', 7);
      expect(art).toMatchObject({ engine: 'comfy', mime: 'image/png' });
      const queued = JSON.parse(http.calls.find((c) => c.url.endsWith('/prompt'))?.init?.body as string);
      expect(queued.prompt['4'].inputs.ckpt_name).toBe('flux1-schnell-fp8.safetensors');
      expect(queued.prompt['3'].inputs).toMatchObject({ seed: 7, steps: 4, cfg: 1 });
      expect(http.calls.at(-1)?.url).toBe('http://127.0.0.1:8188/view?filename=a.png&subfolder=&type=output');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses the right recipe for each kind of model', () => {
    expect(comfyRecipe('flux1-schnell.safetensors')).toMatchObject({ steps: 4, cfg: 1, width: 768, height: 1088 });
    expect(comfyRecipe('juggernautXL.safetensors')).toMatchObject({ steps: 28, cfg: 6, width: 832, height: 1216 });
    const graph = comfyWorkflow('sdxl.safetensors', 'p', 1) as Record<string, { inputs: Record<string, unknown> }>;
    expect(graph['7']?.inputs.text).toContain('letters');
    expect(imageMime(Buffer.from('not an image at all'))).toBeUndefined();
  });

  it('says plainly when nothing can draw', async () => {
    const { painter, dir } = painterWith(fakeHttp({}).fetch);
    try {
      await expect(painter.paint('x')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the art director’s answer', () => {
  const input: CoverDesignTaskInput = {
    title: 'گام‌به‌گام',
    original: 'Thinking in Steps',
    authors: '',
    subject: '',
    request: '',
    count: 3,
    layouts: [
      { id: 'classic', description: '' },
      { id: 'bottom-title', description: '' },
    ],
    fonts: [
      { id: 'estedad', family: 'Estedad', category: 'sans' },
      { id: 'vazirmatn', family: 'Vazirmatn', category: 'sans' },
    ],
    avoid: ['کهنه'],
    canPaint: true,
  };
  const check = (concepts: CoverConcept[]) =>
    TASK_SPECS.cover_design.check(input, { concepts }, { sourceLang: 'en', targetLang: 'fa' }).map((i) => i.rule);

  it('accepts a good answer', () => {
    expect(check([concept(), concept({ name: 'دوم', layout: 'classic' }), concept({ name: 'سوم' })])).toEqual([]);
  });

  it('refuses too few concepts, unknown faces and layouts, twins, and a picture described in Persian', () => {
    const rules = check([concept({ titleFont: 'comic-sans' }), concept({ layout: 'side', imagePrompt: 'دریای آرام' })]);
    expect(rules).toEqual(
      expect.arrayContaining(['concept_count', 'unknown_font', 'unknown_layout', 'duplicate_name', 'prompt_language']),
    );
    expect(
      check([
        concept({ name: 'کهنه' }),
        concept({ name: 'a' }),
        concept({ name: 'b', ground: 'image', imagePrompt: '' }),
      ]),
    ).toEqual(expect.arrayContaining(['repeated', 'target_script', 'missing_prompt', 'same_layout']));
  });
});

describe('a round of AI designs', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-coverai-'));
  let painted = 0;
  const http = fakeHttp({
    '/ai/run/': () => {
      painted++;
      return painted === 2
        ? json({ errors: [{ message: 'daily free allocation' }] }, 429)
        : json({ result: { image: JPEG.toString('base64') } });
    },
  });
  const appPromise = buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }), {
    startRunner: false,
    fontDirs: [],
    fetch: http.fetch,
  });
  afterAll(async () => {
    await (await appPromise).close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('designs on its own when no AI engine is connected, without pictures when nothing can draw', async () => {
    const app = await appPromise;
    const started = await app.inject({
      method: 'POST',
      url: '/api/v1/books/bk_sample/cover-ai',
      payload: { lang: 'fa' },
    });
    expect(started.statusCode).toBe(200);
    expect(['designing', 'done']).toContain(started.json().state);
    await expect
      .poll(
        async () =>
          ((await app.inject({ url: '/api/v1/books/bk_sample/cover-ai?lang=fa' })).json() as CoverAiStatus).state,
      )
      .toBe('done');
    const s = (await app.inject({ url: '/api/v1/books/bk_sample/cover-ai?lang=fa' })).json() as CoverAiStatus;
    expect(s).toMatchObject({ designer: 'basic', painter: 'none' });
    expect(s.options).toHaveLength(3);
    expect(new Set(s.options.map((o) => o.concept.layout)).size).toBe(3);
    expect(s.options.every((o) => o.image === 'none' && o.concept.name.trim())).toBe(true);
    // The book's own title is set in every design.
    const title = getBundle(app.ctx.db, 'bk_sample')?.book.titles.fa;
    expect(
      s.options.every((o) => o.design.layers.some((l) => l.kind === 'text' && l.role === 'title' && l.text === title)),
    ).toBe(true);
  });

  it('asks the art director, draws each picture, and keeps a design whose picture failed', async () => {
    const app = await appPromise;
    app.ctx.painter.update({ engine: 'cloudflare', cloudflareAccountId: ACCOUNT, cloudflareToken: TOKEN });
    const asked: CoverDesignTaskInput[] = [];
    const service = new CoverAiService({
      db: app.ctx.db,
      config: { dataDir },
      fonts: new FontRegistry(() => []),
      painter: app.ctx.painter,
      design: async (input) => {
        asked.push(input);
        return [
          concept(),
          concept({ name: 'دوم', layout: 'top-title' }),
          concept({ name: 'سوم', layout: 'classic', ground: 'gradient', imagePrompt: '' }),
        ];
      },
    });
    const { done } = service.start('bk_sample', 'fa', { request: 'آرام و آبی', count: 3 });
    expect(service.status('bk_sample', 'fa').state).toBe('designing');
    await done;
    const s = service.status('bk_sample', 'fa');
    expect(asked[0]).toMatchObject({ request: 'آرام و آبی', count: 3, canPaint: true });
    expect(asked[0]?.avoid.length).toBe(3); // the round before
    expect(asked[0]?.layouts.map((l) => l.id)).toContain('band');
    expect(s.state).toBe('done');
    expect(s.options.map((o) => o.image)).toEqual(['done', 'failed', 'none']);
    expect(s.options[1]?.imageError).toBe('QUOTA');
    expect(s.options[0]?.design.background).toMatchObject({ kind: 'image', dimMode: 'bottom' });
    expect(s.options[1]?.design.background.kind).toBe('gradient');
    const prompt = JSON.stringify(
      http.calls
        .filter((c) => c.url.includes('/ai/run/'))
        .map((c) => (c.init?.body instanceof FormData ? c.init.body.get('prompt') : null)),
    );
    expect(prompt).toContain('A calm watercolour of a sea at dawn');
    expect(prompt).toContain('no text');
    expect(listImages({ dataDir }, 'bk_sample').filter((i) => i.source === 'ai')).toHaveLength(1);

    // Draw the failed one again: this time the allowance holds.
    const again = service.repaint('bk_sample', 'fa', s.options[1]?.id ?? '');
    await again.done;
    expect(service.status('bk_sample', 'fa').options[1]).toMatchObject({
      image: 'done',
      design: { background: { kind: 'image' } },
    });
  });

  it('falls back to its own designs when the art director fails', async () => {
    const app = await appPromise;
    const service = new CoverAiService({
      db: app.ctx.db,
      config: { dataDir },
      fonts: new FontRegistry(() => []),
      painter: app.ctx.painter,
      design: async () => {
        throw new Error('the engine is busy');
      },
    });
    await service.start('bk_sample', 'fa', { request: '', count: 2 }).done;
    const s = service.status('bk_sample', 'fa');
    expect(s).toMatchObject({ state: 'done', designer: 'basic' });
    expect(s.message).toContain('AI_FAILED');
    expect(s.options).toHaveLength(2);
  });

  it('keeps the illustrator’s settings behind the API, never the token', async () => {
    const app = await appPromise;
    const v = (await app.inject({ url: '/api/v1/settings/painter' })).json() as PainterView;
    expect(v.cloudflare.hasToken).toBe(true);
    expect(JSON.stringify(v)).not.toContain(TOKEN);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/settings/painter',
          payload: { cloudflareAccountId: 'not-an-id' },
        })
      ).statusCode,
    ).toBe(400);
    const test = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/painter/test',
      payload: { engine: 'comfy' },
    });
    expect(test.json()).toMatchObject({ ok: false, engine: 'comfy', error: 'NETWORK' });
    expect((await app.inject({ url: '/api/v1/books/nope/cover-ai' })).statusCode).toBe(404);
  });

  it('tells the art director what the book is about', async () => {
    const app = await appPromise;
    const bundle = getBundle(app.ctx.db, 'bk_sample');
    if (!bundle) throw new Error('no sample');
    const subject = bookSubject(bundle, 'fa');
    expect(subject.length).toBeGreaterThan(10);
    expect(bookSubject({ ...bundle, book: { ...bundle.book, brief: { fa: 'کتابی درباره‌ی اندیشیدن.' } } }, 'fa')).toBe(
      'کتابی درباره‌ی اندیشیدن.',
    );
  });
});

describe('the cover task as JSON Schema', () => {
  it('can be sent to every engine', async () => {
    const { z } = await import('zod');
    const { TASK_RESULT_SCHEMAS, TASK_INPUT_SCHEMAS } = await import('@dozabaneh/shared');
    expect(() => z.toJSONSchema(TASK_RESULT_SCHEMAS.cover_design)).not.toThrow();
    expect(() => z.toJSONSchema(TASK_INPUT_SCHEMAS.cover_design)).not.toThrow();
  });
});
