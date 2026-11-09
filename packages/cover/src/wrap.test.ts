import { describe, expect, it } from 'vitest';
import {
  ean13CheckDigit,
  ean13Modules,
  ean13Svg,
  isbnDigits,
  isValidEan13,
  PAPERS,
  spineWidthMm,
  wrapLayout,
} from './wrap';

describe('printer wrap', () => {
  it('sizes the spine from pages and paper', () => {
    expect(spineWidthMm(300, PAPERS.tahrir70.leaf)).toBe(14.5);
    expect(spineWidthMm(300, PAPERS.bulk80.leaf)).toBeGreaterThan(spineWidthMm(300, PAPERS.tahrir70.leaf));
    // An odd page count still takes a whole leaf.
    expect(spineWidthMm(301, 0.1)).toBe(spineWidthMm(302, 0.1));
    expect(spineWidthMm(0, 0.09)).toBe(0);
  });

  it('puts the front on the right for a right-to-left book', () => {
    const page = { width: 210, height: 297 };
    const rtl = wrapLayout(page, 15, 3, true);
    expect([rtl.width, rtl.height]).toEqual([2 * 210 + 15 + 6, 303]);
    expect(rtl.back.x).toBe(3);
    expect(rtl.spine).toEqual({ x: 213, width: 15 });
    expect(rtl.front.x).toBe(228);
    const ltr = wrapLayout(page, 15, 3, false);
    expect(ltr.front.x).toBe(3);
    expect(ltr.back.x).toBe(228);
  });

  it('checks and draws EAN-13 (ISBN-13)', () => {
    // 978-0-306-40615-7 is the textbook example.
    expect(ean13CheckDigit('978030640615')).toBe(7);
    expect(isValidEan13('9780306406157')).toBe(true);
    expect(isValidEan13('9780306406158')).toBe(false);
    expect(isbnDigits('978-0-306-40615-7')).toBe('9780306406157');
    expect(isbnDigits('12345')).toBeNull();
    const m = ean13Modules('9780306406157');
    expect(m).toHaveLength(95);
    expect(m.startsWith('101')).toBe(true);
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.endsWith('101')).toBe(true);
    expect(() => ean13Modules('9780306406158')).toThrow('INVALID_EAN13');
    const svg = ean13Svg('9780306406157', { ink: 'red;x' });
    expect(svg).toContain('aria-label="9780306406157"');
    expect(svg).toContain('fill="#000000"');
  });
});
