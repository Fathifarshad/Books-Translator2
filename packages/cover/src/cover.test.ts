import { CoverDesignSchema, type CoverTextLayer } from '@dozabaneh/shared';
import { describe, expect, it } from 'vitest';
import { contrastRatio, mix, parseHex, readableInk, rgba, safeHex, toHex } from './color';
import {
  defaultDesign,
  newLayerId,
  newShapeLayer,
  newTextLayer,
  preparerText,
  THEMES,
  titleSize,
  withTexts,
} from './defaults';
import { gridPosition, nudge, outsideSafe, SAFE_MARGIN, safeMarginY, snapBox } from './geometry';
import { backDesign, coverMarkup, type RenderEnv } from './render';

const env: RenderEnv = {
  imageUrl: (id) => `/img/${id}`,
  fontFamily: (id) => `"cv-${id}", sans-serif`,
};
const A4 = 210 / 297;

const texts = {
  title: 'مدیریت خون بیمار',
  original: 'Patient Blood Management',
  authors: 'نوشته‌ی جین دو',
  preparer: preparerText(
    { role: '', name: 'دکتر فرشاد فتحی', title: 'متخصص طب اورژانس، فلوشیپ انفورماتیک بالینی' },
    'ترجمه و تدوین',
  ),
};

const textLayer = (d: ReturnType<typeof defaultDesign>, role: string) =>
  d.layers.find((l): l is CoverTextLayer => l.kind === 'text' && l.role === role);

describe('colour', () => {
  it('parses, prints and mixes #rrggbb', () => {
    expect(parseHex('#16264a')).toEqual({ r: 0x16, g: 0x26, b: 0x4a });
    expect(toHex(parseHex('#C9A54A'))).toBe('#c9a54a');
    expect(toHex(mix(parseHex('#ffffff'), parseHex('#000000'), 0.5))).toBe('#808080');
    expect(rgba('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });

  it('rejects anything that is not a colour', () => {
    expect(safeHex('red;background:url(x)')).toBe('#000000');
    expect(safeHex('#ABCDEF')).toBe('#abcdef');
  });

  it('measures WCAG contrast', () => {
    expect(contrastRatio(parseHex('#000000'), parseHex('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex('#777777'), parseHex('#777777'))).toBe(1);
    // Cream type on the navy cover reads well; gold on ivory is weak.
    expect(contrastRatio(parseHex('#f6f1e3'), parseHex('#16264a'))).toBeGreaterThan(10);
    expect(readableInk(parseHex('#16264a'))).toBe('#ffffff');
    expect(readableInk(parseHex('#f3ecdc'))).toBe('#111111');
  });
});

describe('default design', () => {
  it('is the classic cover as editable layers', () => {
    const d = defaultDesign(texts, THEMES.navy);
    expect(CoverDesignSchema.safeParse(d).success).toBe(true);
    expect(d.background).toMatchObject({ kind: 'gradient', pattern: 'stars', frame: 'double', color: '#16264a' });
    expect(d.layers.map((l) => l.id)).toEqual(['medallion', 'rule-top', 'title', 'original', 'authors', 'preparer']);
    expect(textLayer(d, 'title')).toMatchObject({ text: texts.title, size: titleSize(texts.title), weight: 800 });
    expect(textLayer(d, 'preparer')).toMatchObject({ lineStyle: 'credit', accent: '#c9a54a' });
    expect(textLayer(d, 'preparer')?.text.split('\n')).toEqual([
      'ترجمه و تدوین',
      'دکتر فرشاد فتحی',
      'متخصص طب اورژانس، فلوشیپ انفورماتیک بالینی',
    ]);
  });

  it('hides empty texts instead of dropping them', () => {
    const d = defaultDesign({ title: 'عنوان' }, THEMES.ivory);
    expect(textLayer(d, 'original')).toMatchObject({ visible: false, text: '' });
    expect(textLayer(d, 'title')?.visible).toBe(true);
  });

  it('steps the title size down as the title grows', () => {
    expect(titleSize('کوتاه')).toBeGreaterThan(titleSize('ع'.repeat(40)));
    expect(titleSize('ع'.repeat(40))).toBeGreaterThan(titleSize('ع'.repeat(100)));
  });

  it('puts a book’s texts into a template by role and keeps free text', () => {
    const d = defaultDesign(texts, THEMES.navy);
    const extra = newTextLayer(d, 'text', 'چاپ دوم');
    const next = withTexts({ ...d, layers: [...d.layers, extra] }, { title: 'کتاب دیگر', original: 'Another Book' });
    expect(textLayer(next, 'title')?.text).toBe('کتاب دیگر');
    expect(textLayer(next, 'original')?.text).toBe('Another Book');
    expect(textLayer(next, 'authors')?.text).toBe(texts.authors);
    expect(next.layers.at(-1)).toMatchObject({ role: 'text', text: 'چاپ دوم' });
  });

  it('gives new layers unused ids', () => {
    const d = defaultDesign(texts, THEMES.navy);
    expect(newLayerId(d, 'title')).toBe('title-2');
    expect(newLayerId(d, 'badge')).toBe('badge');
    expect(newShapeLayer(d, 'rule', '#ffffff').id).toBe('rule');
    expect(newShapeLayer(d, 'medallion', '#ffffff').id).toBe('medallion-2');
  });

  it('writes no empty preparer', () => {
    expect(preparerText({ role: '', name: '  ', title: 'x' }, 'ترجمه')).toBe('');
    expect(preparerText({ role: 'ترجمه', name: 'الف', title: '' }, 'x')).toBe('ترجمه\nالف');
  });
});

describe('render', () => {
  it('draws background, ornaments and texts in order', () => {
    const html = coverMarkup(defaultDesign(texts, THEMES.navy), env);
    expect(html).toContain('radial-gradient(ellipse at 50% 35%, #16264a 0%, #16264a 45%, #0b1530 100%)');
    expect(html).toContain('<pattern id="cv-pat-front"');
    expect(html.indexOf('data-layer="medallion"')).toBeLessThan(html.indexOf('data-layer="title"'));
    expect(html).toContain('font-family:&quot;cv-vazirmatn&quot;, sans-serif');
    expect(html).toContain(`font-size:${titleSize(texts.title)}cqw`);
    expect(html).toContain('left:50%;top:52%;width:66%');
    // The credit: small accent role, the name, then the titles.
    expect(html).toContain(
      '<div style="font-size:0.6em;font-weight:500;color:#c9a54a">ترجمه و تدوین</div><div>دکتر فرشاد فتحی</div>',
    );
  });

  it('keeps every style attribute whole, whatever the font names hold', async () => {
    const { coverFontFamily } = await import('./render');
    const html = coverMarkup(defaultDesign(texts, THEMES.navy), {
      ...env,
      fontFamily: (id) => `"cv-${id}", sans-serif`,
    });
    // A double quote inside style="…" would end the attribute and drop the colour and size after it.
    for (const m of html.matchAll(/<div class="cv-l cv-text"[^>]*>/g)) {
      expect(m[0]).toMatch(/style="[^"]*color:#[0-9a-f]{6}[^"]*"/);
      expect(m[0]).toContain('&quot;cv-vazirmatn&quot;');
    }
    expect(coverFontFamily('b-titr')).toBe("'cv-b-titr', 'cv-vazirmatn', 'Vazirmatn Offline', sans-serif");
    expect(coverFontFamily('"x')).toContain("'cv-vazirmatn'");
  });

  it('escapes text and refuses unsafe ids', () => {
    const d = defaultDesign({ title: '<script>alert(1)</script>' }, THEMES.navy);
    const evil = {
      ...d,
      background: { ...d.background, kind: 'image' as const, image: '../../etc/passwd' },
      layers: d.layers.map((l) => (l.kind === 'text' ? { ...l, font: '"x;}', color: 'red;x' } : l)),
    };
    const html = coverMarkup(evil, env);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('passwd');
    expect(html).toContain('&quot;cv-vazirmatn&quot;');
    expect(html).not.toContain('red;x');
  });

  it('places an image with its focus, zoom, blur and dim', () => {
    const d = defaultDesign(texts, THEMES.navy);
    const html = coverMarkup(
      {
        ...d,
        background: {
          ...d.background,
          kind: 'image',
          image: 'img-1',
          focusX: 30,
          focusY: 70,
          zoom: 1.5,
          blur: 0.5,
          dim: 0.4,
          dimMode: 'bottom',
        },
      },
      env,
    );
    expect(html).toContain('src="/img/img-1"');
    expect(html).toContain('object-position:30% 70%');
    expect(html).toContain('filter:blur(0.5cqw)');
    expect(html).toContain('linear-gradient(to top, rgba(0,0,0,0.4) 0%');
  });

  it('leaves hidden layers and empty texts out', () => {
    const d = defaultDesign(texts, THEMES.navy);
    const html = coverMarkup(
      { ...d, layers: d.layers.map((l) => (l.id === 'title' ? { ...l, visible: false } : l)) },
      env,
    );
    expect(html).not.toContain('data-layer="title"');
    const empty = coverMarkup(defaultDesign({ title: 'تنها' }, THEMES.navy), env);
    expect(empty).not.toContain('data-layer="original"');
  });

  it('sets stroke, shadow and band in em of the type', () => {
    const d = defaultDesign(texts, THEMES.navy);
    const layers = d.layers.map((l) =>
      l.id === 'title' && l.kind === 'text'
        ? {
            ...l,
            stroke: { color: '#000000', width: 0.03 },
            shadow: { color: '#000000', blur: 0.4, offset: 0.05, opacity: 0.6 },
            band: { color: '#000000', opacity: 0.5, padding: 0.6, radius: 0.2 },
          }
        : l,
    );
    const html = coverMarkup({ ...d, layers }, env);
    expect(html).toContain('-webkit-text-stroke:0.03em #000000');
    expect(html).toContain('text-shadow:0 0.05em 0.4em rgba(0,0,0,0.6)');
    expect(html).toContain('background:rgba(0,0,0,0.5);padding:0.33em 0.6em;border-radius:0.2em');
  });

  it('makes a back cover from the front', () => {
    const back = backDesign(defaultDesign(texts, THEMES.navy));
    expect(back.layers.map((l) => l.id)).toEqual(['medallion', 'title', 'original', 'preparer']);
    expect(back.layers.every((l) => l.x === 50)).toBe(true);
    expect(coverMarkup(back, env, { uid: 'back' })).toContain('id="cv-pat-back"');
  });
});

describe('geometry', () => {
  it('keeps the same safe margin in millimetres on both axes', () => {
    expect(safeMarginY(A4)).toBeCloseTo(SAFE_MARGIN * A4, 6);
  });

  it('places a box on the nine-position grid inside the safe area', () => {
    const box = { w: 40, h: 10 };
    expect(gridPosition(box, 'center', 'middle', A4)).toEqual({ x: 50, y: 50 });
    expect(gridPosition(box, 'left', 'top', A4).x).toBe(SAFE_MARGIN + 20);
    expect(gridPosition(box, 'right', 'bottom', A4).x).toBe(100 - SAFE_MARGIN - 20);
    const top = gridPosition(box, 'center', 'top', A4);
    expect(outsideSafe({ ...box, ...top }, A4)).toBeNull();
  });

  it('tells which edge leaves the safe area', () => {
    expect(outsideSafe({ x: 50, y: 50, w: 60, h: 10 }, A4)).toBeNull();
    expect(outsideSafe({ x: 4, y: 50, w: 6, h: 10 }, A4)).toMatchObject({ left: true, right: false });
    expect(outsideSafe({ x: 50, y: 99, w: 10, h: 4 }, A4)).toMatchObject({ bottom: true });
  });

  it('snaps to the centre, the thirds, the safe edges and other layers', () => {
    expect(snapBox({ x: 50.8, y: 40, w: 20, h: 5 }, [], A4)).toMatchObject({ x: 50, guides: [{ axis: 'x', at: 50 }] });
    expect(snapBox({ x: 30, y: 33.9, w: 20, h: 5 }, [], A4).y).toBeCloseTo(33.33, 2);
    // Left edge 0.6 % from the safe line → the box's edge lands on it.
    const s = snapBox({ x: SAFE_MARGIN + 10.6, y: 45, w: 20, h: 5 }, [], A4);
    expect(s.x).toBe(SAFE_MARGIN + 10);
    expect(s.guides[0]).toMatchObject({ axis: 'x', kind: 'safe', at: SAFE_MARGIN });
    expect(snapBox({ x: 70.5, y: 45, w: 10, h: 5 }, [{ x: 71, y: 80, w: 10, h: 5 }], A4).x).toBe(71);
    expect(snapBox({ x: 40, y: 45, w: 10, h: 5 }, [], A4).guides).toEqual([]);
  });

  it('moves with the arrow keys', () => {
    expect(nudge({ x: 50, y: 50 }, 'ArrowLeft', false)).toEqual({ x: 49.5, y: 50 });
    expect(nudge({ x: 50, y: 50 }, 'ArrowDown', true)).toEqual({ x: 50, y: 52 });
    expect(nudge({ x: 50, y: 50 }, 'Enter', false)).toBeNull();
    expect(nudge({ x: 119.8, y: 0 }, 'ArrowRight', true)).toEqual({ x: 120, y: 0 });
  });
});

describe('contrast on a picture', () => {
  // 4×2 pixels: left half white, right half black.
  const px = {
    width: 4,
    height: 2,
    data: [
      255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0,
      0, 255, 0, 0, 0, 255,
    ],
  };

  it('averages each cell of a region', async () => {
    const { regionColors } = await import('./color');
    const cells = regionColors(px, { x: 50, y: 50, w: 100, h: 100 }, 2, 1);
    expect(cells).toEqual([
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
    ]);
    expect(regionColors(px, { x: 50, y: 50, w: 100, h: 100 }, 1, 1)[0]?.r).toBeCloseTo(127.5);
    expect(regionColors(px, { x: 200, y: 50, w: 10, h: 10 })).toEqual([]);
  });

  it('judges type by its worst cell, helped by a band or an outline', async () => {
    const { regionColors, textContrast } = await import('./color');
    const cells = regionColors(px, { x: 50, y: 50, w: 100, h: 100 }, 2, 1);
    expect(textContrast('#ffffff', cells)).toBe(1);
    expect(textContrast('#ffffff', cells, { band: { color: '#000000', opacity: 1 } })).toBeCloseTo(21);
    expect(textContrast('#ffffff', cells, { stroke: { color: '#000000', width: 0.04 } })).toBeCloseTo(21);
    expect(textContrast('#ffffff', cells, { stroke: { color: '#000000', width: 0.01 } })).toBe(1);
    expect(textContrast('#ffffff', [])).toBe(21);
  });
});

describe('palette', () => {
  it('recolours ground, ornaments and type at once, badges aside', async () => {
    const { applyTheme } = await import('./defaults');
    const d = defaultDesign(texts, THEMES.navy);
    const badge = newTextLayer(d, 'badge', 'ویرایش دوم');
    const next = applyTheme({ ...d, layers: [...d.layers, badge] }, THEMES.burgundy);
    expect(next.background).toMatchObject({
      color: '#5a1628',
      color2: '#310a15',
      patternColor: '#d4a95a',
      frameColor: '#d4a95a',
    });
    expect(next.layers.find((l) => l.id === 'medallion')).toMatchObject({ color: '#d4a95a' });
    expect(textLayer(next, 'title')?.color).toBe('#f7efe4');
    expect(textLayer(next, 'original')?.color).toBe('#d4a95a');
    expect(textLayer(next, 'preparer')?.accent).toBe('#d4a95a');
    expect(next.layers.at(-1)).toEqual(badge);
  });
});
