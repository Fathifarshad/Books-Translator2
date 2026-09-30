import { describe, expect, it } from 'vitest';
import { createGlossaryMatcher } from './glossary-match';

const en = createGlossaryMatcher(
  [
    { id: 'alg', text: 'algorithm' },
    { id: 'bs', text: 'binary search' },
    { id: 'bin', text: 'binary' },
    { id: 'ds', text: 'data structure' },
    { id: 'rep', text: 'memory' },
  ],
  'en',
);

const slice = (text: string, m: { start: number; end: number }) => text.slice(m.start, m.end);

describe('glossary matcher — English', () => {
  it('matches case-insensitively with plurals and possessives', () => {
    const text = 'Algorithms are everywhere; an algorithm’s steps and the memories it uses.';
    const matches = en.find(text);
    expect(matches.map((m) => slice(text, m))).toEqual(['Algorithms', 'algorithm’s', 'memories']);
  });

  it('prefers the longest match and never overlaps', () => {
    const text = 'Binary search needs binary data structures.';
    const matches = en.find(text);
    expect(matches.map((m) => [slice(text, m), m.termId])).toEqual([
      ['Binary search', 'bs'],
      ['binary', 'bin'],
      ['data structures', 'ds'],
    ]);
  });

  it('respects word boundaries', () => {
    expect(en.find('algorithmic thinking')).toEqual([]);
  });
});

describe('glossary matcher — Persian', () => {
  const fa = createGlossaryMatcher(
    [
      { id: 'alg', text: 'الگوریتم' },
      { id: 'ds', text: 'ساختار داده' },
      { id: 'bs', text: 'جست‌وجوی دودویی' },
    ],
    'fa',
  );

  it('matches with plural and ezafe suffixes', () => {
    const text = 'الگوریتم‌ها و الگوریتمی ساده';
    expect(fa.find(text).map((m) => slice(text, m))).toEqual(['الگوریتم‌ها', 'الگوریتمی']);
  });

  it('tolerates ZWNJ/space variation and Arabic letters', () => {
    const text = 'جست وجوی دودویی روي ساختار داده‌ها';
    expect(fa.find(text).map((m) => m.termId)).toEqual(['bs', 'ds']);
  });

  it('does not match inside a longer word', () => {
    expect(fa.find('ناالگوریتم')).toEqual([]);
  });
});
