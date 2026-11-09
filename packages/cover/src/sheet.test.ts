import { describe, expect, it } from 'vitest';
import { defaultDesign, THEMES } from './defaults';
import { ensureExtras, extrasRenderer, isbnStatus } from './extras';
import { backDesign, layersMarkup, type RenderEnv } from './render';
import { spineTextMarkup, wrapSheet } from './sheet';

const env: RenderEnv = { imageUrl: (id) => `/img/${id}`, fontFamily: (id) => `'cv-${id}'` };
const front = defaultDesign({ title: 'کتاب نمونه', original: 'Sample', preparer: 'ترجمه\nعلی' }, THEMES.navy);
const input = {
  front,
  back: backDesign(front),
  page: { width: 210, height: 297 },
  spineMm: 14.5,
  bleedMm: 3,
  cropMarks: false,
  rtl: true,
  spine: {
    title: 'کتاب نمونه',
    author: 'نویسنده',
    font: 'vazirmatn',
    weight: 800,
    color: '#ffffff',
    accent: '#c9a54a',
  },
  env,
  css: '',
  title: 'کتاب نمونه',
  lang: 'fa',
};

const panel = (html: string, name: string) =>
  new RegExp(`data-panel="${name}" style="left:([\\d.]+)mm;top:[\\d.]+mm;width:([\\d.]+)mm`).exec(html)?.slice(1);

describe('wrap sheet', () => {
  it('is back + spine + front wide, with the bleed on every outer side', () => {
    const sheet = wrapSheet(input);
    expect(sheet.widthMm).toBeCloseTo(2 * 210 + 14.5 + 6, 5);
    expect(sheet.heightMm).toBe(303);
    expect(sheet.html).toContain('@page{size:440.5mm 303mm;margin:0}');
    // Right-to-left: the front is the right panel and runs past the right edge; the back runs past the left one.
    expect(panel(sheet.html, 'back')).toEqual(['0', '213']);
    expect(panel(sheet.html, 'spine')).toEqual(['213', '14.5']);
    expect(panel(sheet.html, 'front')).toEqual(['227.5', '213']);
    expect(sheet.html).toContain('--bl:');
    expect(sheet.html).not.toContain('class="marks"');
  });

  it('puts the front on the left for a left-to-right book', () => {
    const sheet = wrapSheet({ ...input, rtl: false });
    expect(panel(sheet.html, 'front')).toEqual(['0', '213']);
    expect(panel(sheet.html, 'back')).toEqual(['227.5', '213']);
  });

  it('adds a margin for crop marks and fold marks outside the bleed', () => {
    const plain = wrapSheet(input);
    const marked = wrapSheet({ ...input, cropMarks: true });
    const margin = 3 + 1.5 + 5 + 1.5;
    expect(marked.widthMm).toBeCloseTo(plain.widthMm + 2 * margin, 5);
    expect(marked.html).toContain('class="marks"');
    // 4 corners × 2 marks + 2 folds × 2 marks = 12 sub-paths.
    const marks = /<svg class="marks".*?<\/svg>/s.exec(marked.html)?.[0] ?? '';
    expect(marks.match(/M[\d.]+ [\d.]+[hv]/g)).toHaveLength(12);
  });

  it('zero bleed leaves the ground inside the trim', () => {
    const sheet = wrapSheet({ ...input, bleedMm: 0 });
    expect(sheet.widthMm).toBeCloseTo(2 * 210 + 14.5, 5);
    expect(sheet.heightMm).toBe(297);
  });

  it('letters the spine only when it is wide enough, the author only on a thick one', () => {
    const t = input.spine;
    expect(spineTextMarkup(t, 5.9, 297, env)).toBe('');
    const thin = spineTextMarkup(t, 7, 297, env);
    expect(thin).toContain('writing-mode:vertical-rl');
    expect(thin).toContain('کتاب نمونه');
    expect(thin).not.toContain('نویسنده');
    expect(spineTextMarkup(t, 14.5, 297, env)).toContain('نویسنده');
    expect(spineTextMarkup({ ...t, title: '<b>x</b>' }, 14.5, 297, env)).toContain('&lt;b&gt;');
    expect(wrapSheet({ ...input, spine: null }).html).not.toContain('class="spine-text"');
  });

  const extras = (print: object, design = ensureExtras(backDesign(front), 210), placeholders?: never) =>
    layersMarkup(
      { ...design, layers: design.layers.filter((l) => l.kind === 'extra') },
      env,
      extrasRenderer(
        {
          print: { barcode: true, isbn: '', price: '', logo: null, ...print },
          pageWidthMm: 210,
          ink: '#ffffff',
          font: "'cv-vazirmatn'",
          placeholders,
        },
        env,
      ),
    );

  it('shows the barcode only for a valid ISBN, with price and logo', () => {
    const print = { barcode: true, isbn: '978-964-6194-33-5', price: '۱۲۰٬۰۰۰ تومان', logo: 'img-abc' };
    const full = extras(print);
    expect(full).toContain('ISBN 978-964-6194-33-5');
    expect(full).toContain('<svg');
    expect(full).toContain('۱۲۰٬۰۰۰ تومان');
    expect(full).toContain('src="/img/img-abc"');
    expect(extras({ ...print, isbn: '978-964-6194-33-1' })).not.toContain('<svg');
    expect(extras({ ...print, barcode: false })).not.toContain('<svg');
    expect(extras({ ...print, logo: '../x' })).not.toContain('<img');
  });

  it('puts the extras where their layers are, and the sheet draws them on the back only', () => {
    const base = ensureExtras(backDesign(front), 210);
    expect(base.layers.filter((l) => l.kind === 'extra').map((l) => l.id)).toEqual(['barcode', 'price', 'logo']);
    expect(ensureExtras(base, 210)).toBe(base);
    const moved = {
      ...base,
      layers: base.layers.map((l) => (l.kind === 'extra' && l.extra === 'price' ? { ...l, x: 61.5, y: 12 } : l)),
    };
    expect(extras({ price: '۵۰' }, moved)).toContain('left:61.5%;top:12%');
    const hidden = {
      ...base,
      layers: base.layers.map((l) => (l.kind === 'extra' && l.extra === 'price' ? { ...l, visible: false } : l)),
    };
    expect(extras({ price: '۵۰' }, hidden)).not.toContain('۵۰');
    // An empty extra says nothing on paper but is a dashed box to drag in the editor.
    expect(extras({})).toBe('');
    const hint = extras({}, base, { barcode: 'بارکد', price: 'قیمت', logo: 'لوگو' } as never);
    expect(hint).toContain('بارکد');
    expect(hint).toContain('dashed');
    const sheet = wrapSheet({
      ...input,
      back: moved,
      extra: extrasRenderer(
        { print: { barcode: true, isbn: '', price: '۵۰', logo: null }, pageWidthMm: 210, ink: '#fff', font: 'x' },
        env,
      ),
    });
    expect(sheet.html.match(/۵۰/g)).toHaveLength(1);
  });

  it('judges an ISBN', () => {
    expect(isbnStatus('')).toEqual({ state: 'empty', digits: null });
    expect(isbnStatus('978-964-6194-33-5').state).toBe('valid');
    expect(isbnStatus('9789646194331').state).toBe('bad-check');
    expect(isbnStatus('12345').state).toBe('bad-format');
    expect(isbnStatus('abc').state).toBe('bad-format');
  });

  it('makes the back cover with its blurb above the foot kept for the barcode', () => {
    const back = backDesign(front, { blurb: 'متن\n\nمعرفی', tagline: 'چرا؟', publisher: 'نشر', rtl: true });
    expect(back.layers.map((l) => l.id)).toEqual(expect.arrayContaining(['title', 'tagline', 'blurb', 'publisher']));
    expect(back.layers.find((l) => l.id === 'blurb')).toMatchObject({
      kind: 'text',
      align: 'right',
      text: 'متن\n\nمعرفی',
    });
    expect(back.layers.every((l) => l.y <= 95)).toBe(true);
    const ltr = backDesign(front, { blurb: 'x'.repeat(30), rtl: false });
    expect(ltr.layers.find((l) => l.id === 'blurb')).toMatchObject({ align: 'left' });
  });
});
