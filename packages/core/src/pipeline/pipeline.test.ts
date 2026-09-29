import { sampleBook } from '@dozabaneh/shared/sample-book';
import { describe, expect, it } from 'vitest';
import { createBookIndex } from '../book';
import { extractCandidates } from './candidates';
import { chunkSegments, introducedIn, itemKeys, locationPath, memoryKey, needsTranslation, taskPriority } from './plan';

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');

describe('needsTranslation', () => {
  it.each([
    ['paragraph', true, true],
    ['heading', true, true],
    ['list_item', true, true],
    ['quote', true, true],
    ['caption', true, true],
    ['footnote', true, true],
    ['code', true, false],
    ['figure', true, false],
    ['table', true, false],
    ['equation', true, false],
    ['separator', true, false],
    ['paragraph', false, false],
  ] as const)('%s (translatable=%s) → %s', (type, translatable, expected) => {
    expect(needsTranslation({ type, translatable })).toBe(expected);
  });
});

describe('chunkSegments', () => {
  it('keeps small sections in one chunk', () => {
    const segs = [{ src: words(100) }, { src: words(200) }];
    expect(chunkSegments(segs, { lang: 'en', maxWords: 2500 })).toEqual([segs]);
  });

  it('starts a new chunk before exceeding the limit and never splits a segment', () => {
    const segs = [{ src: words(1200) }, { src: words(1200) }, { src: words(1200) }, { src: words(50) }];
    const chunks = chunkSegments(segs, { lang: 'en', maxWords: 2500 });
    expect(chunks.map((c) => c.length)).toEqual([2, 2]);
  });

  it('puts one huge paragraph in its own chunk', () => {
    const segs = [{ src: words(10) }, { src: words(4000) }, { src: words(10) }];
    expect(chunkSegments(segs, { lang: 'en', maxWords: 2500 }).map((c) => c.length)).toEqual([1, 1, 1]);
  });

  it('counts words of the text, not markup', () => {
    const segs = [{ src: `*${words(10)}* \`code\` [^1]` }];
    expect(chunkSegments(segs, { lang: 'en', maxWords: 11 })).toHaveLength(1);
  });
});

describe('planning helpers', () => {
  it('builds zero-padded short keys', () => {
    expect(itemKeys(3)).toEqual(['01', '02', '03']);
    expect(itemKeys(120).slice(-1)).toEqual(['120']);
    expect(itemKeys(120)[0]).toBe('001');
  });

  it('orders tasks by priority and boosts prioritized translate/edit work', () => {
    expect(taskPriority('brief')).toBeGreaterThan(taskPriority('glossary'));
    expect(taskPriority('glossary')).toBeGreaterThan(taskPriority('translate'));
    expect(taskPriority('translate', true)).toBeGreaterThan(taskPriority('translate'));
    expect(taskPriority('brief', true)).toBe(taskPriority('brief'));
  });

  it('normalizes whitespace for translation memory', () => {
    expect(memoryKey('  Chapter\n summary ')).toBe(memoryKey('Chapter summary'));
  });

  it('computes the chapter location path in the target language', () => {
    const index = createBookIndex(sampleBook);
    const section = index.readingOrder.find((n) => n.kind === 'section');
    expect(section).toBeDefined();
    const path = locationPath(index, section?.id ?? '', 'fa');
    expect(path.length).toBe(2);
    expect(path.every((p) => /\p{Script=Arabic}/u.test(p))).toBe(true);
  });

  it('finds terms already introduced earlier in the chapter', () => {
    const entries = [
      { id: 'a', src: 'Abstraction', tgt: 'انتزاع', policy: 'first_in_chapter' as const },
      { id: 'b', src: 'Lever', tgt: 'اهرم', policy: 'first_in_chapter' as const },
      { id: 'c', src: 'CPU', tgt: 'پردازنده', policy: 'never' as const },
    ];
    const texts = [
      { key: '01', text: 'انتزاع', type: 'h' },
      { key: '02', text: 'انتزاع (Abstraction) و پردازنده در کار است.' },
    ];
    expect(introducedIn(texts, entries, 'fa')).toEqual(['Abstraction']);
  });
});

describe('extractCandidates', () => {
  const texts = [
    'A *fulcrum* is the point on which a lever turns. The simple machine idea is old.',
    'Every lever needs a fulcrum. A simple machine changes force. Ada Byron wrote about the Analytical Engine.',
    'The simple machine family includes the lever. The CPU of a computer is not a simple machine.',
    'Engineers at the Royal Society compared each simple machine. Ada Byron and the Royal Society met.',
    'A lever and a fulcrum again: the lever wins. The CPU waits. Use `lever_tool()` in code.',
  ];

  it('finds n-grams, names, acronyms and emphasized terms with examples', () => {
    const list = extractCandidates(texts, 'en');
    const srcs = list.map((c) => c.src);
    expect(srcs).toContain('simple machine');
    expect(srcs).toContain('lever');
    expect(srcs).toContain('fulcrum');
    expect(srcs).toContain('Ada Byron');
    expect(srcs).toContain('Royal Society');
    expect(srcs).toContain('CPU');
    const sm = list.find((c) => c.src === 'simple machine');
    expect(sm?.freq).toBe(5);
    expect(sm?.examples).toHaveLength(2);
    expect(sm?.examples[0]).toContain('simple machine');
  });

  it('drops stop words, short words and code', () => {
    const srcs = extractCandidates(texts, 'en').map((c) => c.src.toLowerCase());
    expect(srcs).not.toContain('the');
    expect(srcs).not.toContain('is');
    expect(srcs.some((s) => s.includes('lever_tool'))).toBe(false);
  });

  it('drops a word that almost always appears inside a longer candidate', () => {
    const srcs = extractCandidates(texts, 'en').map((c) => c.src);
    expect(srcs).not.toContain('machine');
  });

  it('respects exclusions and the maximum', () => {
    const list = extractCandidates(texts, 'en', { exclude: new Set(['lever']), max: 3 });
    expect(list).toHaveLength(3);
    expect(list.map((c) => c.src)).not.toContain('lever');
  });

  it('only uses names and emphasized terms for languages without a stop-word list', () => {
    const srcs = extractCandidates(texts, 'xx').map((c) => c.src);
    expect(srcs).toContain('Ada Byron');
    expect(srcs).toContain('fulcrum');
    expect(srcs).not.toContain('simple machine');
  });
});
