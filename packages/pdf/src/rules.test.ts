import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dehyphenate } from './blocks';
import { headerPattern, inferPageLabels, removeHeadersFooters, toRoman } from './cleanup';
import { orderPage } from './layout';
import { buildLines, type RawItem } from './lines';
import { mergeContinuations } from './merge';
import { fontStyle } from './normalize';
import { normTitle, stripNumbering, titleSimilarity } from './similarity';
import type { Block, Line, PageData } from './types';
import { ingestInWorker } from './worker-client';

const item = (text: string, x: number, y: number, o: Partial<RawItem> = {}): RawItem => ({
  text,
  x,
  y,
  width: text.length * 5,
  size: 10,
  font: 'Times-Roman',
  bold: false,
  italic: false,
  mono: false,
  ...o,
});

const line = (text: string, y: number, x0 = 50, o: Partial<Line> = {}): Line => ({
  page: 0,
  y,
  x0,
  x1: x0 + text.length * 5,
  size: 10,
  runs: [],
  text,
  bold: false,
  italic: false,
  mono: false,
  ...o,
});

const page = (index: number, lines: Line[]): PageData => ({ index, width: 400, height: 600, lines, images: [] });

describe('lines', () => {
  it('groups items by baseline, orders by x and inserts spaces at gaps', () => {
    const lines = buildLines([item('world', 90, 100), item('Hello', 50, 100.5), item('Next', 50, 114)], 0);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Next']);
  });

  it('attaches raised small digits as superscripts', () => {
    const lines = buildLines([item('lift.', 50, 100), item('1', 76, 96.5, { size: 6.5, width: 3 })], 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.runs.at(-1)).toMatchObject({ text: '1', sup: true });
  });

  it('splits one baseline into two lines at a column gutter', () => {
    const lines = buildLines([item('left column text', 50, 100), item('right column', 260, 100)], 0);
    expect(lines.map((l) => l.text)).toEqual(['left column text', 'right column']);
  });
});

describe('page cleanup (SPEC §8.3)', () => {
  it('normalizes header patterns', () => {
    expect(headerPattern('12  Chapter One')).toBe('# chapter one');
    expect(headerPattern('xiv Preface')).toBe('# preface');
  });

  it('removes repeating running heads and lone page numbers, keeps body text', () => {
    const pages = [0, 1, 2, 3].map((i) =>
      page(i, [line('Small Machines', 30), line('Body text that stays on the page.', 120), line(String(i + 1), 570)]),
    );
    const { pages: out, removed, printed } = removeHeadersFooters(pages, []);
    expect(out.every((p) => p.lines.map((l) => l.text).join() === 'Body text that stays on the page.')).toBe(true);
    expect(removed).toBe(8);
    expect(printed.get(2)).toBe('3');
  });

  it('removes a running head that repeats a chapter title even when it appears once', () => {
    const body = 'Body text in the regular size, long enough to set the body font size.';
    const pages = [
      page(0, [line('Levers and Pulleys', 110, 50, { size: 20 }), line(body, 150)]),
      page(1, [line('Levers and Pulleys', 30, 50, { size: 8 }), line(body, 120)]),
    ];
    const { pages: out } = removeHeadersFooters(pages, []);
    expect(out[1]?.lines.map((l) => l.text)).toEqual([body]);
    expect(out[0]?.lines).toHaveLength(2);
  });

  it('infers page labels from printed numbers when the PDF has none', () => {
    const printed = new Map([
      [3, '2'],
      [4, '3'],
      [6, '5'],
    ]);
    expect(inferPageLabels(7, null, printed)).toEqual(['i', 'ii', '1', '2', '3', '4', '5']);
    expect(inferPageLabels(2, ['a', 'b'], printed)).toEqual(['a', 'b']);
    expect(toRoman(14)).toBe('xiv');
  });
});

describe('reading order', () => {
  it('reads column 1 then column 2 and keeps spanning lines in place', () => {
    const lines = [
      line('A title that spans the whole page width across both columns', 60, 50),
      ...[0, 1, 2, 3].map((i) => line(`left ${i}`, 100 + i * 14, 50, { x1: 190 })),
      ...[0, 1, 2, 3].map((i) => line(`right ${i}`, 100 + i * 14, 220, { x1: 360 })),
    ];
    const ordered = orderPage(page(0, lines));
    expect(ordered.map((l) => l.text).slice(1)).toEqual([
      'left 0',
      'left 1',
      'left 2',
      'left 3',
      'right 0',
      'right 1',
      'right 2',
      'right 3',
    ]);
    expect(ordered[0]?.column).toBe(0);
  });
});

describe('de-hyphenation (SPEC §8.4)', () => {
  it('joins broken words and keeps real compounds', () => {
    const words = new Map([
      ['computation', 2],
      ['self-driving', 1],
    ]);
    expect(dehyphenate('compu', 'tation', words)).toBe('join');
    expect(dehyphenate('self', 'driving', words)).toBe('keep');
    expect(dehyphenate('Anglo', 'Saxon', new Map())).toBe('keep');
    expect(dehyphenate('some', 'thing', new Map())).toBe('join');
  });
});

describe('continuations (bug §4.2-6)', () => {
  const stats = { bodySize: 10, lineGap: 14, words: new Map<string, number>(), lang: 'en' };
  const block = (o: Partial<Block>): Block => ({
    type: 'paragraph',
    page: 0,
    pageEnd: 0,
    column: 0,
    y: 100,
    x0: 50,
    x1: 350,
    size: 10,
    lines: [],
    text: '',
    bold: false,
    indent: 0,
    meta: {},
    ...o,
  });

  it('merges a list item continued with a hanging indent on the next page, skipping a footnote', () => {
    const out = mergeContinuations(
      [
        block({ type: 'list_item', text: 'how stiff the bar stays, which matters most when the', textX: 66 }),
        block({ type: 'footnote', text: 'A note.', y: 560 }),
        block({ page: 1, pageEnd: 1, x0: 66, indent: 16, text: 'load is heavy.' }),
      ],
      stats,
    );
    expect(out.map((b) => [b.type, b.text])).toEqual([
      ['list_item', 'how stiff the bar stays, which matters most when the load is heavy.'],
      ['footnote', 'A note.'],
    ]);
    expect(out[0]?.pageEnd).toBe(1);
  });

  it('does not merge after a finished sentence, into an indented paragraph or a new list item', () => {
    const a = block({ text: 'A finished sentence.' });
    const b = block({ page: 1, pageEnd: 1, text: 'Next paragraph' });
    expect(mergeContinuations([a, b], stats)).toHaveLength(2);
    const c = block({ text: 'unfinished' });
    expect(
      mergeContinuations([c, block({ page: 1, pageEnd: 1, indent: 15, text: 'Indented start.' })], stats),
    ).toHaveLength(2);
    expect(mergeContinuations([c, block({ page: 1, pageEnd: 1, text: '• a new item' })], stats)).toHaveLength(2);
  });
});

describe('title matching', () => {
  it('matches outline titles with printed headings despite numbering', () => {
    expect(normTitle('Chapter 1: Levers & Pulleys')).toBe('chapter 1 levers pulleys');
    expect(stripNumbering('chapter 1 levers pulleys')).toBe('levers pulleys');
    expect(titleSimilarity('Chapter 1: Levers and Pulleys', 'Levers and Pulleys')).toBe(1);
    expect(titleSimilarity('1.2 Pulleys', 'Pulleys')).toBe(1);
    expect(titleSimilarity('What Is an Algorithm?', 'What is an algorithm')).toBe(1);
    expect(titleSimilarity('Gears', 'Levers')).toBeLessThan(0.5);
  });
});

describe('worker thread', () => {
  it('ingests a PDF off the main thread with page progress', async () => {
    const progress: number[] = [];
    const result = await ingestInWorker(
      fileURLToPath(new URL('../../../fixtures/pdf/outline-book.pdf', import.meta.url)),
      {
        onProgress: (p) => progress.push(p),
      },
    );
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.nodes.filter((n) => n.kind === 'chapter')).toHaveLength(2);
    expect(result.report.structureSource).toBe('outline');
  });

  it('rejects files that are not PDFs', async () => {
    await expect(ingestInWorker(fileURLToPath(import.meta.url))).rejects.toThrow();
  });
});

describe('OCR text layers', () => {
  it('treats the invisible GlyphLessFont as plain body text even though pdf.js calls it monospace', () => {
    expect(fontStyle('GlyphLessFont', { family: 'monospace' })).toEqual({ bold: false, italic: false, mono: false });
    expect(fontStyle('ABCDEF+Courier', { family: 'monospace' }).mono).toBe(true);
  });
});
