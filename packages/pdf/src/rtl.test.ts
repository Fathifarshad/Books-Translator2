import { describe, expect, it } from 'vitest';
import { removeHeadersFooters } from './cleanup';
import { buildLines, type RawItem, rtlOrder } from './lines';
import { normalizeRunText } from './normalize';
import type { Line, PageData } from './types';

/** Items placed by their left edge `x`, like pdf.js reports them; widths follow the text length. */
const item = (text: string, x: number, y = 100, o: Partial<RawItem> = {}): RawItem => ({
  text,
  x,
  y,
  width: text.length * 5,
  size: 10,
  font: 'B Nazanin',
  bold: false,
  italic: false,
  mono: false,
  ...o,
});

describe('right-to-left lines (Persian source books)', () => {
  it('reads the words of a line from the right edge', () => {
    // «این کتاب خوب است» set right to left: «این» is rightmost.
    const items = [item('است', 100), item('خوب', 125), item('کتاب', 150), item('این', 180)];
    expect(buildLines(items, 0, true).map((l) => l.text)).toEqual(['این کتاب خوب است']);
    // Left to right (the default) keeps the old behaviour for English books.
    expect(buildLines(items, 0).map((l) => l.text)).toEqual(['است خوب کتاب این']);
  });

  it('keeps an embedded English phrase left to right inside the Persian line', () => {
    // «مفهوم Machine Learning مهم است»: the Latin words sit in the middle, in their own order.
    const items = [item('است', 40), item('مهم', 65), item('Machine', 90), item('Learning', 130), item('مفهوم', 180)];
    expect(buildLines(items, 0, true)[0]?.text).toBe('مفهوم Machine Learning مهم است');
  });

  it('keeps punctuation between two Latin words inside their run', () => {
    const ordered = rtlOrder([item('A', 50), item('-', 57), item('B', 64), item('الف', 90)]).map((i) => i.text);
    expect(ordered).toEqual(['الف', 'A', '-', 'B']);
  });

  it('puts two lines on one baseline in right-to-left order', () => {
    const lines = buildLines([item('ستون چپ', 30), item('ستون راست', 300)], 0, true);
    expect(lines.map((l) => l.text)).toEqual(['ستون راست', 'ستون چپ']);
  });
});

describe('Persian text from PDFs', () => {
  it('turns Arabic presentation forms into the letters they show and keeps the ZWNJ', () => {
    expect(normalizeRunText('\u{FEB3}\u{FEFC}\u{FEE1}')).toBe('سلام');
    expect(normalizeRunText('می‌شود')).toBe('می‌شود');
  });

  it('removes page numbers printed in Persian digits and records them', () => {
    const line = (text: string, y: number): Line => ({
      page: 0,
      y,
      x0: 150,
      x1: 250,
      size: 10,
      runs: [],
      text,
      bold: false,
      italic: false,
      mono: false,
    });
    const pages: PageData[] = ['۱۲', '۱۳', 'صفحه ۱۴'].map((n, index) => ({
      index,
      width: 400,
      height: 600,
      images: [],
      lines: [line('متن اصلی صفحه که باید بماند.', 300), line(n, 590)],
    }));
    const out = removeHeadersFooters(pages, []);
    expect(out.pages.every((p) => p.lines.length === 1)).toBe(true);
    expect([...out.printed.values()]).toEqual(['12', '13', '14']);
  });
});
