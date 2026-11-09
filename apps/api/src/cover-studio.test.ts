import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { THEMES } from '@dozabaneh/cover';
import { BookPdfOptionsSchema, type CoverDesign, type CoverDesignView, type CoverFont } from '@dozabaneh/shared';
import * as fontkit from 'fontkit';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { buildBookPdf } from './export/book/build';
import { designFonts, printedCover } from './export/book/cover-design';
import { buildBookHtml } from './export/book/html';
import { layoutBook } from './export/book/layout';
import { findBrowser } from './export/book/print';
import { bookDocument } from './export/document';
import { bookStrings } from './export/strings';
import { BUNDLED, FontRegistry, scanSystemFonts, setsPersian, slug } from './fonts/registry';
import { imageType } from './routes/cover-studio';

const require = createRequire(import.meta.url);
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

function form(name: string, type: string, data: Buffer) {
  const boundary = '----dozabaneh';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body };
}

/** A Persian face whose family the app does not ship, to stand for an installed font. */
function installedFontDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dozabaneh-fonts-'));
  const pkg = dirname(require.resolve('@fontsource-variable/noto-sans-arabic/package.json'));
  mkdirSync(join(dir, 'nested'));
  copyFileSync(
    join(pkg, 'files', 'noto-sans-arabic-arabic-wght-normal.woff2'),
    join(dir, 'nested', 'NotoSansArabic.ttf'),
  );
  // Shipped with the app already: left out of «this computer's» list.
  const estedad = dirname(require.resolve('@fontsource-variable/estedad/package.json'));
  copyFileSync(join(estedad, 'files', 'estedad-arabic-wght-normal.woff2'), join(dir, 'Estedad.ttf'));
  // No Persian letters.
  const latin = dirname(require.resolve('@fontsource-variable/vazirmatn/package.json'));
  copyFileSync(join(latin, 'files', 'vazirmatn-latin-wght-normal.woff2'), join(dir, 'LatinOnly.ttf'));
  return dir;
}

describe('cover fonts', () => {
  const registry = new FontRegistry(() => []);

  it('ships free Persian faces, each with its Arabic-script and Latin files', () => {
    const fonts = registry.all();
    expect(fonts.map((f) => f.id)).toEqual(BUNDLED.map((b) => b.id));
    for (const font of fonts) {
      expect(font.source).toBe('bundled');
      const arabic = font.faces.filter((f) => f.name.includes('-arabic-'));
      expect(arabic.length, font.id).toBeGreaterThan(0);
      expect(
        font.faces.some((f) => f.name.includes('-latin-')),
        font.id,
      ).toBe(true);
      for (const face of font.faces) {
        expect(existsSync(face.file)).toBe(true);
        expect(face.unicodeRange).toBeTruthy();
      }
      // Every shipped face sets پ چ ژ گ and Persian digits.
      const opened = fontkit.openSync(arabic[0]?.file ?? '') as fontkit.Font;
      expect(setsPersian(opened), font.id).toBe(true);
      expect(opened.hasGlyphForCodePoint(0x6f4), font.id).toBe(true);
    }
  });

  it('finds Persian fonts installed on the computer, skipping shipped families and non-Persian faces', () => {
    const dir = installedFontDir();
    try {
      const found = scanSystemFonts([dir]);
      expect(found.map((f) => [f.id, f.family, f.source])).toEqual([
        ['sys-noto-sans-arabic', 'Noto Sans Arabic', 'system'],
      ]);
      expect(found[0]?.faces[0]?.name).toMatch(/^0-\d00\.ttf$/);
      const reg = new FontRegistry(() => [dir]);
      expect(reg.list().at(-1)).toMatchObject({ id: 'sys-noto-sans-arabic', source: 'system' });
      expect(reg.face('sys-noto-sans-arabic', found[0]?.faces[0]?.name ?? '')).toBeDefined();
      expect(reg.face('sys-noto-sans-arabic', '../../secret.ttf')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('makes URL-safe ids', () => {
    expect(slug('B Titr')).toBe('b-titr');
    expect(slug('Far.Nazanin')).toBe('far-nazanin');
    expect(slug('***')).toBe('font');
  });
});

describe('cover studio API', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-cover-'));
  const appPromise = buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }), {
    startRunner: false,
    fontDirs: [],
  });
  afterAll(async () => {
    await (await appPromise).close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists fonts, serves their rules and files, and nothing else', async () => {
    const app = await appPromise;
    const fonts = (await app.inject({ url: '/api/v1/fonts' })).json() as CoverFont[];
    expect(fonts.find((f) => f.id === 'nastaliq')).toMatchObject({
      family: 'Noto Nastaliq Urdu',
      category: 'nastaliq',
    });
    const css = await app.inject({ url: '/api/v1/fonts.css' });
    expect(css.headers['content-type']).toContain('text/css');
    expect(css.body).toContain('font-family:"cv-lalezar"');
    const url = /url\("([^"]*lalezar-arabic[^"]*)"\)/.exec(css.body)?.[1] ?? '';
    const file = await app.inject({ url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('font/woff2');
    expect((await app.inject({ url: '/api/v1/fonts/lalezar/..%2F..%2Fpackage.json' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/fonts/nope/x.woff2' })).statusCode).toBe(404);
  });

  it('starts from the classic cover with the book’s texts and the last preparer, and saves edits', async () => {
    const app = await appPromise;
    const first = (await app.inject({ url: '/api/v1/books/bk_sample/cover-design?lang=fa' })).json() as CoverDesignView;
    expect(first.saved).toBe(false);
    expect(first.texts.title).toBeTruthy();
    const title = first.design.layers.find((l) => l.id === 'title');
    expect(title).toMatchObject({ kind: 'text', text: first.texts.title });

    const edited: CoverDesign = {
      ...first.design,
      layers: first.design.layers.map((l) =>
        l.id === 'title' && l.kind === 'text' ? { ...l, text: 'عنوان تازه', font: 'nastaliq', x: 40, y: 30 } : l,
      ),
    };
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/books/bk_sample/cover-design',
      payload: { lang: 'fa', design: edited },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().saved).toBe(true);
    const again = (await app.inject({ url: '/api/v1/books/bk_sample/cover-design?lang=fa' })).json() as CoverDesignView;
    expect(again.design.layers.find((l) => l.id === 'title')).toMatchObject({
      text: 'عنوان تازه',
      font: 'nastaliq',
      x: 40,
    });
    // The next «کتاب PDF» uses the designed cover.
    expect((await app.inject({ url: '/api/v1/books/bk_sample/book-pdf?lang=fa' })).json().options.cover).toBe(
      'designed',
    );
    const preview = await app.inject({ url: '/api/v1/books/bk_sample/book-pdf/cover-preview?cover=designed&lang=fa' });
    expect(preview.body).toContain('عنوان تازه');
    expect(preview.body).toMatch(/font-family:&#39;cv-nastaliq&#39;[^"]*color:#/);

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/v1/books/bk_sample/cover-design',
      payload: { lang: 'fa', design: { ...edited, layers: [{ kind: 'text', id: '../x', text: 'x' }] } },
    });
    expect(bad.statusCode).toBe(400);

    const reset = (await app.inject({ method: 'DELETE', url: '/api/v1/books/bk_sample/cover-design?lang=fa' })).json();
    expect(reset.saved).toBe(false);
  });

  it('keeps the book’s cover images and will not drop one the cover shows', async () => {
    const app = await appPromise;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/books/bk_sample/cover-images',
          ...form('x.png', 'image/png', Buffer.from('not an image at all')),
        })
      ).statusCode,
    ).toBe(415);
    // Declared JPEG, really PNG.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/books/bk_sample/cover-images',
          ...form('x.jpg', 'image/jpeg', PNG),
        })
      ).statusCode,
    ).toBe(415);
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/books/bk_sample/cover-images',
      ...form('c.png', 'image/png', PNG),
    });
    expect(up.statusCode).toBe(200);
    const image = up.json() as { id: string; source: string };
    expect(image).toMatchObject({ source: 'upload' });
    const file = await app.inject({ url: `/api/v1/books/bk_sample/cover-images/${image.id}` });
    expect(file.headers['content-type']).toBe('image/png');

    const view = (await app.inject({ url: '/api/v1/books/bk_sample/cover-design?lang=fa' })).json() as CoverDesignView;
    expect(view.images.map((i) => i.id)).toContain(image.id);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/books/bk_sample/cover-design',
      payload: {
        lang: 'fa',
        design: { ...view.design, background: { ...view.design.background, kind: 'image', image: image.id } },
      },
    });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/books/bk_sample/cover-images/${image.id}` })).statusCode,
    ).toBe(409);
    await app.inject({ method: 'DELETE', url: '/api/v1/books/bk_sample/cover-design?lang=fa' });
    const gone = await app.inject({ method: 'DELETE', url: `/api/v1/books/bk_sample/cover-images/${image.id}` });
    expect(gone.statusCode).toBe(200);
    expect(gone.json()).toEqual([]);
    expect((await app.inject({ url: `/api/v1/books/bk_sample/cover-images/${image.id}` })).statusCode).toBe(404);
  });

  it('keeps templates without the book’s picture', async () => {
    const app = await appPromise;
    const view = (await app.inject({ url: '/api/v1/books/bk_sample/cover-design?lang=fa' })).json() as CoverDesignView;
    const design = { ...view.design, background: { ...view.design.background, kind: 'image', image: 'img-x' } };
    const list = (
      await app.inject({ method: 'POST', url: '/api/v1/cover-templates', payload: { name: 'سرمه‌ای', design } })
    ).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'سرمه‌ای', design: { background: { kind: 'gradient', image: null } } });
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/cover-templates', payload: { name: '', design } })).statusCode,
    ).toBe(400);
    const left = await app.inject({ method: 'DELETE', url: `/api/v1/cover-templates/${list[0].id}` });
    expect(left.json()).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/cover-templates/tpl-nope' })).statusCode).toBe(404);
  });

  it('prints the designed cover with only the fonts it uses', async () => {
    const app = await appPromise;
    const deps = { db: app.ctx.db, config: { dataDir } };
    const view = (await app.inject({ url: '/api/v1/books/bk_sample/cover-design?lang=fa' })).json() as CoverDesignView;
    const design = {
      ...view.design,
      layers: view.design.layers.map((l) => (l.id === 'title' && l.kind === 'text' ? { ...l, font: 'lalezar' } : l)),
    };
    await app.inject({ method: 'PUT', url: '/api/v1/books/bk_sample/cover-design', payload: { lang: 'fa', design } });
    expect(designFonts(design).sort()).toEqual(['lalezar', 'vazirmatn']);
    const printed = printedCover(deps, app.ctx.fonts, 'bk_sample', 'fa', (f) => f);
    expect(printed.css).toContain('"cv-lalezar"');
    expect(printed.css).toContain('data:font/woff2;base64,');
    expect(printed.css).not.toContain('"cv-nastaliq"');
    expect(printed.front).toContain('data-layer="title"');
    expect(printed.back).toContain('id="cv-pat-back"');

    const doc = bookDocument((await import('@dozabaneh/shared/sample-book')).sampleBook, 'fa');
    const page = buildBookHtml({
      doc,
      book: {},
      layout: layoutBook(doc, [], { mode: 'target', titles: new Map() }),
      options: BookPdfOptionsSchema.parse({ cover: 'designed', theme: 'navy' }),
      strings: bookStrings(),
      figureSrc: () => '',
      designedCover: printed,
      editOnly: false,
    });
    expect(page).toContain('<section class="cover designed"><div class="cv-cover">');
    expect(page.match(/class="cover designed"/g)).toHaveLength(2);
    expect(page).toContain('.cv-cover {');
    expect(page).not.toContain('class="cover generated"');
    expect(THEMES.navy.bg).toBe('#16264a');
  });
});

describe('image bytes', () => {
  it('tells JPEG, PNG and WebP by their first bytes', () => {
    expect(imageType(PNG)).toBe('image/png');
    expect(imageType(Buffer.from('ffd8ffe000104a4649460001', 'hex'))).toBe('image/jpeg');
    expect(imageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe(
      'image/webp',
    );
    expect(imageType(Buffer.from('%PDF-1.7 hello'))).toBeUndefined();
  });
});

describe.skipIf(!findBrowser())('cover studio: a real print', () => {
  it('prints a book whose cover was designed in the studio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dozabaneh-cover-print-'));
    const app = await buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dir }), {
      startRunner: false,
      fontDirs: [],
    });
    try {
      const view = (
        await app.inject({ url: '/api/v1/books/bk_sample/cover-design?lang=fa' })
      ).json() as CoverDesignView;
      await app.inject({
        method: 'PUT',
        url: '/api/v1/books/bk_sample/cover-design',
        payload: { lang: 'fa', design: view.design },
      });
      const file = await buildBookPdf(
        {
          db: app.ctx.db,
          config: { dataDir: dir },
          fonts: app.ctx.fonts,
          translate: async (items) => new Map(items.map((i) => [i.key, i.src])),
        },
        { bookId: 'bk_sample', lang: 'fa', options: BookPdfOptionsSchema.parse({ cover: 'designed', figures: false }) },
      );
      expect(file.pages).toBeGreaterThan(5);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
