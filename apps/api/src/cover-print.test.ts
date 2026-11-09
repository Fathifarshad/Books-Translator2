import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoverBlurbResult, CoverPrintView } from '@dozabaneh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { blurbFromBrief, wrapFile, writeBlurb } from './export/book/cover-print';
import { findBrowser } from './export/book/print';

const dir = mkdtempSync(join(tmpdir(), 'dozabaneh-cover-wrap-'));
const appPromise = buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dir }), { startRunner: false, fontDirs: [] });
afterAll(async () => {
  await (await appPromise).close();
  rmSync(dir, { recursive: true, force: true });
});

const U = '/api/v1/books/bk_sample/cover-print';
const getView = async () => (await (await appPromise).inject({ url: `${U}?lang=fa` })).json() as CoverPrintView;
const put = async (print: object, back?: unknown) =>
  (
    await (await appPromise).inject({ method: 'PUT', url: U, payload: { lang: 'fa', print, back } })
  ).json() as CoverPrintView;

describe('cover print settings', () => {
  it('starts with تحریر 70 g, a 3 mm bleed and no spine until the pages are known', async () => {
    const view = await getView();
    expect(view.print).toMatchObject({ paper: 'tahrir70', bleedMm: 3, cropMarks: false, spineText: true });
    expect(view.leafMm).toBe(0.09);
    expect(view.isbn.state).toBe('empty');
    expect(view.backSaved).toBe(false);
    expect(view.back.layers.map((l) => l.id)).toContain('title');
    if (view.pages === null) {
      expect(view.spineMm).toBeNull();
      expect(view.sheet).toBeNull();
    }
  });

  it('sizes the spine and the sheet from the pages, the paper and the bleed', async () => {
    const app = await appPromise;
    const base = (await getView()).print;
    const a = await put({ ...base, pages: 300 });
    expect(a.spineMm).toBe(14.5);
    expect(a.sheet).toEqual({ width: 2 * 210 + 14.5 + 6, height: 303 });
    const b = await put({ ...base, pages: 300, paper: 'bulk80', bleedMm: 5, cropMarks: true });
    expect(b.spineMm).toBeGreaterThan(14.5);
    expect(b.sheet?.height).toBe(297 + 10 + 2 * 13);
    const c = await put({ ...base, pages: 300, leafMm: 0.2 });
    expect(c.spineMm).toBe(31);
    const bad = await app.inject({ method: 'PUT', url: U, payload: { lang: 'fa', print: { bleedMm: 40 } } });
    expect(bad.statusCode).toBe(400);
  });

  it('judges the ISBN and keeps the blurb in the settings and in the back layer', async () => {
    const base = (await getView()).print;
    const text = 'این کتاب درباره‌ی نمونه است.\n\nدوم.';
    const withBlurb = await put({ ...base, isbn: '978-964-6194-33-5', blurb: text });
    expect(withBlurb.isbn).toEqual({ state: 'valid', digits: '9789646194335' });
    expect(withBlurb.back.layers.find((l) => l.id === 'blurb')).toMatchObject({ text });
    expect((await put({ ...base, isbn: '9789646194331' })).isbn.state).toBe('bad-check');

    // The owner edits the blurb layer in the studio: the layer wins, and the setting follows.
    const edited = {
      ...withBlurb.back,
      layers: withBlurb.back.layers.map((l) =>
        l.id === 'blurb' && l.kind === 'text' ? { ...l, text: 'متن تازه' } : l,
      ),
    };
    const saved = await put(withBlurb.print, edited);
    expect(saved.backSaved).toBe(true);
    expect(saved.print.blurb).toBe('متن تازه');
    // Editing the setting later updates the saved layer.
    const again = await put({ ...saved.print, blurb: 'سوم' });
    expect(again.back.layers.find((l) => l.id === 'blurb')).toMatchObject({ text: 'سوم' });
    // null goes back to the design made from the front.
    expect((await put(again.print, null)).backSaved).toBe(false);
  });

  it('refuses the sheet while the pages are unknown', async () => {
    const app = await appPromise;
    await put({ ...(await getView()).print, pages: null });
    if ((await getView()).pages === null) {
      expect((await app.inject({ url: `${U}/preview?lang=fa` })).statusCode).toBe(409);
      expect((await app.inject({ url: `${U}/pdf?lang=fa` })).statusCode).toBe(409);
    }
    expect((await app.inject({ url: '/api/v1/books/nope/cover-print' })).statusCode).toBe(404);
  });

  it('previews the sheet with fonts and images from the server', async () => {
    const app = await appPromise;
    const base = (await getView()).print;
    await put({ ...base, pages: 240, isbn: '978-964-6194-33-5', price: '۹۰٬۰۰۰ تومان' });
    const res = await app.inject({ url: `${U}/preview?lang=fa` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('data-panel="spine"');
    expect(res.body).toContain('/api/v1/fonts/');
    expect(res.body).toContain('ISBN 978-964-6194-33-5');
    expect(res.body).toContain('۹۰٬۰۰۰ تومان');
  });
});

describe('the back cover blurb', () => {
  it('cuts a blurb from the brief at a sentence, never from a list of chapters', () => {
    const cut = blurbFromBrief('جمله‌ی نمونه است. '.repeat(60), 300);
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut.endsWith('.')).toBe(true);
    expect(blurbFromBrief('Chapters: یک · دو · سه', 300)).toBe('');
    expect(blurbFromBrief('کوتاه', 300)).toBe('کوتاه');
  });

  it('asks the engine, falls back to the brief, and says when there is nothing', async () => {
    const app = await appPromise;
    const deps = { db: app.ctx.db, config: { dataDir: dir } };
    let asked: { request: string; maxChars: number } | undefined;
    const ai = await writeBlurb(
      {
        ...deps,
        write: async (input) => {
          asked = { request: input.request, maxChars: input.maxChars };
          return { blurb: 'متنی که هوش مصنوعی نوشت.', tagline: 'چرا؟' };
        },
      },
      'bk_sample',
      'fa',
      'کوتاه',
    );
    expect(ai).toMatchObject({ source: 'ai', blurb: 'متنی که هوش مصنوعی نوشت.', tagline: 'چرا؟' });
    expect(asked).toEqual({ request: 'کوتاه', maxChars: 700 });

    const failed = await writeBlurb(
      {
        ...deps,
        write: async () => {
          throw new Error('boom');
        },
      },
      'bk_sample',
      'fa',
      '',
    );
    expect(['brief', 'none']).toContain(failed.source);
    expect(failed.message).toContain('AI_FAILED');

    const res = await app.inject({ method: 'POST', url: `${U}/blurb`, payload: { lang: 'fa' } });
    expect(res.statusCode).toBe(200);
    expect(['ai', 'brief', 'none']).toContain((res.json() as CoverBlurbResult).source);
  });
});

describe.skipIf(!findBrowser())('cover print: a real print', () => {
  it('prints one page of exactly the sheet size, with and without crop marks', async () => {
    const app = await appPromise;
    const base = (await getView()).print;
    const mediaBox = (b: Buffer) => {
      const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(b.toString('latin1'));
      return m ? [Number(m[1]) / 2.834645669, Number(m[2]) / 2.834645669] : [];
    };
    for (const cropMarks of [false, true]) {
      await put({ ...base, pages: 300, cropMarks, isbn: '978-964-6194-33-5', price: '۹۰٬۰۰۰ تومان' });
      const res = await app.inject({ url: `${U}/pdf?lang=fa` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      const body = res.rawPayload;
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(body.toString('latin1').match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
      const [w, h] = mediaBox(body);
      const sheet = (await getView()).sheet;
      expect(w).toBeCloseTo(sheet?.width ?? 0, 0);
      expect(h).toBeCloseTo(sheet?.height ?? 0, 0);
      expect(readFileSync(wrapFile({ dataDir: dir }, 'bk_sample', 'fa')).length).toBeGreaterThan(1000);
    }
  }, 120_000);
});

describe.skipIf(!findBrowser())('cover pictures: a real shot', () => {
  const size = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
  it('takes the front as PNG and JPG at the preset sizes', async () => {
    const app = await appPromise;
    const shop = await app.inject({ url: '/api/v1/books/bk_sample/cover-image?lang=fa&preset=shop&format=png' });
    expect(shop.statusCode).toBe(200);
    expect(shop.headers['content-type']).toBe('image/png');
    const [sw, sh] = String(shop.headers['x-image-size']).split('x').map(Number);
    expect(size(shop.rawPayload)).toEqual({ w: sw, h: sh });
    expect(sh).toBe(2400);
    const sq = await app.inject({ url: '/api/v1/books/bk_sample/cover-image?lang=fa&preset=square&format=jpg' });
    expect(sq.headers['content-type']).toBe('image/jpeg');
    expect(sq.rawPayload.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    const bad = await app.inject({ url: '/api/v1/books/bk_sample/cover-image?preset=huge' });
    expect(bad.statusCode).toBe(400);
  }, 120_000);
});
