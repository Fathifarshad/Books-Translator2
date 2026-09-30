import { sampleBook } from '@dozabaneh/shared/sample-book';
import { describe, expect, it } from 'vitest';
import { createBookIndex } from './book';
import { searchBook } from './search';

const index = createBookIndex(sampleBook);

describe('searchBook', () => {
  it('finds Persian text regardless of ZWNJ/space variants', () => {
    const r = searchBook(index, 'جست وجوی دودویی', { targetLang: 'fa', sides: ['target'] });
    expect(r.total).toBeGreaterThan(0);
    expect(r.groups[0]?.nodeId).toBe('nd_sample_ch1-speed');
  });

  it('finds English text case-insensitively and groups by section', () => {
    const r = searchBook(index, 'BINARY SEARCH', { targetLang: 'fa', sides: ['source'] });
    expect(r.groups.map((g) => g.nodeId)).toContain('nd_sample_ch1-speed');
    const hit = r.groups[0]?.hits[0];
    expect(hit?.text.slice(hit.ranges[0]?.start, hit.ranges[0]?.end).toLowerCase()).toBe('binary search');
  });

  it('includes glossary hits', () => {
    const r = searchBook(index, 'انتزاع', { targetLang: 'fa' });
    expect(r.glossary.map((g) => g.src)).toContain('abstraction');
  });

  it('ignores one-character queries', () => {
    expect(searchBook(index, 'a', { targetLang: 'fa' }).total).toBe(0);
  });
});
