import { describe, expect, it } from 'vitest';
import { defaultDesign, THEMES } from './defaults';
import { coverImagePage, imageSize } from './image';

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
});
