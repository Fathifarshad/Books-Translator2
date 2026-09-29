import { compareMarkup, digitSequences, endsWithTerminalPunctuation, stripMarkup } from '@dozabaneh/text';
import { describe, expect, it } from 'vitest';
import { sampleBook } from './index';

const { book, nodes, segments, translations, glossary } = sampleBook;
const target = book.targetLangs[0] as string;

describe('sample book seed', () => {
  it('has unique, prefixed, stable ids', () => {
    const ids = [...nodes.map((n) => n.id), ...segments.map((s) => s.id), ...glossary.map((g) => g.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(nodes.every((n) => n.id.startsWith('nd_'))).toBe(true);
    expect(segments.every((s) => s.id.startsWith('sg_'))).toBe(true);
    expect(segments.find((s) => s.nodeId === 'nd_sample_ch1-speed' && s.ord === 0)?.id).toBe('sg_sample_ch1-speed_00');
  });

  it('matches the Phase 1 content requirements', () => {
    const chapters = nodes.filter((n) => n.kind === 'chapter');
    expect(chapters).toHaveLength(2);
    for (const ch of chapters) {
      const children = nodes.filter((n) => n.parentId === ch.id);
      expect(children.filter((n) => n.kind === 'section')).toHaveLength(3);
      expect(children[0]?.kind).toBe('chapter_intro');
      expect(ch.headingSegmentId).toBeDefined();
    }
    const types = new Set(segments.map((s) => s.type));
    for (const t of ['list_item', 'quote', 'code', 'footnote', 'caption', 'figure'] as const) {
      expect(types.has(t)).toBe(true);
    }
    expect(glossary.length).toBeGreaterThanOrEqual(20);
    expect(glossary.every((g) => g.definition && g.tgt)).toBe(true);
  });

  it('gives every translatable segment exactly one translation per target language', () => {
    for (const s of segments.filter((x) => x.translatable)) {
      expect(translations.filter((t) => t.segmentId === s.id && t.lang === target)).toHaveLength(1);
    }
    for (const s of segments.filter((x) => !x.translatable)) {
      expect(translations.some((t) => t.segmentId === s.id)).toBe(false);
    }
  });

  it('keeps markup tokens and numbers identical between source and translation', () => {
    for (const t of translations) {
      const seg = segments.find((s) => s.id === t.segmentId);
      expect(seg).toBeDefined();
      if (!seg) continue;
      expect(compareMarkup(seg.src, t.text), seg.id).toEqual({ missing: [], extra: [] });
      expect(digitSequences(t.text).sort(), seg.id).toEqual(digitSequences(seg.src).sort());
    }
  });

  it('uses Persian letters and punctuation in Persian text', () => {
    for (const t of translations) {
      expect(t.text, t.segmentId).not.toMatch(/[يك]/);
      // Latin , ; ? must not appear in Persian runs (use «،» «؛» «؟»).
      expect(stripMarkup(t.text), t.segmentId).not.toMatch(/[,;?]/);
    }
  });

  it('has no paragraphs broken mid-sentence (bug §4.2-6)', () => {
    for (const s of segments.filter((x) => x.type === 'paragraph')) {
      expect(endsWithTerminalPunctuation(s.src, book.sourceLang), s.id).toBe(true);
    }
  });
});
