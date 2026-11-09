import { describe, expect, it } from 'vitest';
import { defaultDesign, THEMES } from './defaults';
import { coverImagePage, imageSize } from './image';
import { mockupPage } from './mockup';

const env = { imageUrl: () => '', fontFamily: () => 'Vazirmatn' };
const A5 = { width: 145, height: 210 };

describe('cover pictures', () => {
  it('sizes each preset from the page', () => {
    expect(imageSize('shop', A5)).toEqual({ width: 1657, height: 2400 });
    expect(imageSize('square', A5)).toEqual({ width: 1080, height: 1080 });
    expect(imageSize('print', A5)).toEqual({ width: 1713, height: 2480 });
  });

  it('puts the cover alone on the shop page and on a ground in the square', () => {
    const front = defaultDesign({ title: 'نمونه' }, THEMES.navy);
    const shop = coverImagePage({ front, preset: 'shop', page: A5, env, css: '', title: 'x<y', lang: 'fa' });
    expect(shop.html).toContain('class="flat"');
    expect(shop.html).toContain('<title>x&lt;y</title>');
    expect(shop.html).not.toContain('class="book"');
    const sq = coverImagePage({ front, preset: 'square', page: A5, env, css: '', title: 'x', lang: 'fa' });
    expect(sq.html).toContain('class="ground"');
    expect(sq.html).toContain('class="book"');
  });

  it('builds the 3D book with the spine on the side the language reads from', () => {
    const front = defaultDesign({ title: 'نمونه' }, THEMES.navy);
    const base = { front, spine: null, page: A5, spineMm: 15, env, css: '', title: 'x', lang: 'fa' };
    const rtl = mockupPage({ ...base, rtl: true });
    const ltr = mockupPage({ ...base, rtl: false });
    expect(rtl.size).toEqual({ width: 1600, height: 1200 });
    expect(rtl.html).toContain('rotateY(-32deg)');
    expect(ltr.html).toContain('rotateY(32deg)');
    expect(rtl.html).toContain('class="face spine"');
    // A hairline spine still gets some depth.
    expect(mockupPage({ ...base, rtl: true, spineMm: 1 }).html).toContain('translateZ(3mm)');
  });
});
