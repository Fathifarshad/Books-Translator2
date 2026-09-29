import type { TutorRequest } from '@dozabaneh/shared';
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { describe, expect, it } from 'vitest';
import { createBookIndex } from '../book';
import { buildTutorContext, resolveCitations, stripUnknownCitations } from './context';

const index = createBookIndex(sampleBook);

function request(nodeId: string, segmentIds: string[] = [], question = 'این تکه را برایم توضیح بده.'): TutorRequest {
  return {
    question,
    context: {
      bookId: 'bk_sample',
      nodeId,
      nodeLabel: 'label',
      mode: 'default',
      ...(segmentIds.length ? { selection: { text: 'Binary search', lang: 'en', segmentIds } } : {}),
    },
    history: [],
    targetLang: 'fa',
    attempt: 1,
  };
}

describe('tutor context (bug §4.2-2)', () => {
  it('puts the selection first and uses the node stored on the message', () => {
    const ctx = buildTutorContext(index, request('nd_sample_ch1-speed', ['sg_sample_ch1-speed_03']));
    expect(ctx.input.passages[0]).toMatchObject({ label: 'P1', segmentId: 'sg_sample_ch1-speed_03' });
    expect(ctx.input.sectionTitle).toBe('چه سرعتی کافی است؟');
    const nodes = new Set(ctx.input.passages.slice(0, 5).map((p) => p.nodeId));
    expect(nodes).toEqual(new Set(['nd_sample_ch1-speed']));
    expect(ctx.input.glossary.map((g) => g.src)).toContain('binary search');
  });

  it('respects the character budget', () => {
    const ctx = buildTutorContext(index, request('nd_sample_ch2-structures'), { maxChars: 900 });
    const size = ctx.input.passages.reduce((a, p) => a + p.src.length + (p.tgt?.length ?? 0), 0);
    expect(size).toBeLessThanOrEqual(900 + 600);
    expect(ctx.input.passages.length).toBeGreaterThan(0);
  });

  it('retrieves related passages from other sections', () => {
    const ctx = buildTutorContext(index, request('nd_sample_ch2-structures', [], 'linear search چیست؟'), {
      maxChars: 50_000,
    });
    expect(ctx.input.passages.some((p) => p.nodeId === 'nd_sample_ch1-speed')).toBe(true);
  });

  it('labels every passage and maps labels back to segments', () => {
    const ctx = buildTutorContext(index, request('nd_sample_ch1-intro'));
    for (const p of ctx.input.passages) expect(ctx.labelMap.get(p.label)?.segmentId).toBe(p.segmentId);
  });
});

describe('citations (SPEC §12.5)', () => {
  const labelMap = new Map([
    ['P1', { segmentId: 'sg_a', nodeId: 'nd_a' }],
    ['P2', { segmentId: 'sg_b', nodeId: 'nd_b' }],
  ]);

  it('keeps only labels from the context that was sent, once each, in order', () => {
    expect(resolveCitations('الف [P2] ب [P1] ج [P9] د [P2]', labelMap)).toEqual([
      { label: 'P2', segmentId: 'sg_b', nodeId: 'nd_b' },
      { label: 'P1', segmentId: 'sg_a', nodeId: 'nd_a' },
    ]);
  });

  it('strips unknown labels from the displayed text', () => {
    expect(stripUnknownCitations('الف [P1] ب [P7] ج', labelMap.keys())).toBe('الف [P1] ب ج');
  });
});
