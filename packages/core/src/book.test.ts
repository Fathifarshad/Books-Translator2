import type { TranslationRecord } from '@dozabaneh/shared';
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { describe, expect, it } from 'vitest';
import { buildSection, buildToc, createBookIndex, firstReadable, nodeStatus, translationCounter } from './book';

const lang = 'fa';

describe('book index', () => {
  const index = createBookIndex(sampleBook);

  it('orders readable nodes in document order', () => {
    expect(index.readingOrder.map((n) => n.id)).toEqual([
      'nd_sample_preface',
      'nd_sample_ch1-intro',
      'nd_sample_ch1-recipes',
      'nd_sample_ch1-precision',
      'nd_sample_ch1-speed',
      'nd_sample_ch2-intro',
      'nd_sample_ch2-bits',
      'nd_sample_ch2-structures',
      'nd_sample_ch2-abstraction',
      'nd_sample_epilogue',
    ]);
  });

  it('opens chapters at their intro', () => {
    expect(firstReadable(index, 'nd_sample_ch1')?.id).toBe('nd_sample_ch1-intro');
  });

  it('builds a TOC with titles in both languages and statuses', () => {
    const toc = buildToc(index, lang);
    const ch1 = toc.find((e) => e.id === 'nd_sample_ch1');
    expect(ch1?.title).toEqual({ src: 'What Is an Algorithm?', tgt: 'الگوریتم چیست؟' });
    expect(ch1?.numberLabel).toBe('1');
    expect(ch1?.status).toBe('needs_review');
    expect(ch1?.children.map((c) => c.kind)).toEqual(['chapter_intro', 'section', 'section', 'section']);
    const epilogue = toc.find((e) => e.id === 'nd_sample_epilogue');
    expect(epilogue?.status).toBe('not_started');
    expect(epilogue?.title.tgt).toBeUndefined();
  });

  it('counts only final and user-edited segments', () => {
    const { done, total } = translationCounter(index, lang);
    const translatable = sampleBook.segments.filter((s) => s.translatable).length;
    expect(total).toBe(translatable);
    // One flagged segment and the untranslated epilogue (heading + 2 paragraphs).
    expect(done).toBe(total - 1 - 3);
  });

  it('builds a section payload with rows, pages and navigation', () => {
    const s = buildSection(index, 'nd_sample_ch1-speed', lang);
    expect(s?.title.src).toBe('How Fast Is Fast Enough?');
    expect(s?.chapter?.numberLabel).toBe('1');
    expect(s?.pageLabels).toEqual({ from: '9', to: '11' });
    expect(s?.prevId).toBe('nd_sample_ch1-precision');
    expect(s?.nextId).toBe('nd_sample_ch2-intro');
    expect(s?.endsChapter).toBe(true);
    expect(s?.rows[0]?.type).toBe('heading');
    expect(s?.rows[1]?.paragraphNumber).toBe(1);
    expect(s?.rows.find((r) => r.type === 'code')?.status).toBe('untranslatable');
  });

  it('hides pending translations and applies overrides', () => {
    const before = buildSection(index, 'nd_sample_epilogue', lang);
    expect(before?.rows.every((r) => r.tgt === undefined)).toBe(true);
    const overrides: TranslationRecord[] = (before?.rows ?? []).map((r) => ({
      segmentId: r.segmentId,
      lang,
      text: `ترجمه‌ی ${r.segmentId}`,
      status: 'final',
      engine: 'mock',
      flags: [],
      version: 2,
      updatedAt: '2025-01-02T00:00:00.000Z',
    }));
    const next = createBookIndex(sampleBook, overrides);
    expect(buildSection(next, 'nd_sample_epilogue', lang)?.rows.every((r) => r.tgt)).toBe(true);
    expect(nodeStatus(next, 'nd_sample_epilogue', lang)).toBe('final');
  });
});
