import { describe, expect, it } from 'vitest';
import { findNormalized, normalizeForSearch } from './search';

describe('search normalization', () => {
  it.each([
    ['کتاب‌ها', 'کتابها'],
    ['کتاب ها', 'کتابها'],
    ['کتابها', 'کتابها'],
    ['می‌شود', 'میشود'],
    ['می شود', 'میشود'],
    ['بزرگ‌تر', 'بزرگتر'],
    ['جست‌وجو', 'جست وجو'],
    ['كتاب يك', 'کتاب یک'],
    ['۱۲۳', '123'],
    ['Café', 'cafe'],
    ['کتـــاب', 'کتاب'],
    ['  many   spaces ', 'many spaces'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeForSearch(input)).toBe(expected);
  });

  it('keeps unrelated words apart', () => {
    // «آ» folds to «ا» (NFD + maddah stripped); the words must stay separate.
    expect(normalizeForSearch('آقای هادی')).toBe('اقای هادی');
  });

  it('maps matches back to original offsets', () => {
    const text = 'این کتاب‌ها و آن کتاب ها';
    const ranges = findNormalized(text, 'کتابها');
    expect(ranges.map((r) => text.slice(r.start, r.end))).toEqual(['کتاب‌ها', 'کتاب ها']);
  });

  it('finds English case-insensitively', () => {
    const text = 'An Algorithm and another algorithm.';
    expect(findNormalized(text, 'ALGORITHM').length).toBe(2);
  });
});
