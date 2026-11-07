import { describe, expect, it } from 'vitest';
import { getLanguage } from './languages';
import { type FlowRow, isCapsHeading, isLeaderLine, reflowRows } from './reflow';

const row = (type: string, src: string, tgt: string, id = src.slice(0, 6)): FlowRow => ({ type, src, tgt, ids: [id] });
const enFa = { sourceLang: 'en', targetLang: 'fa' };
const faFa = { sourceLang: 'fa', targetLang: 'fa' };

describe('book layout: reflow (ADR-046)', () => {
  it('joins a paragraph broken mid-sentence, deciding on the source text', () => {
    const out = reflowRows(
      [
        row(
          'paragraph',
          'One of the key components of the transfusion decision is the',
          'یکی از اجزای مهم تصمیم تزریق',
          'a',
        ),
        row('quote', 'patient’s overall condition and its trend.', 'وضعیت کلی بیمار و روند آن است.', 'b'),
        row('paragraph', 'A new paragraph starts here with a capital.', 'پاراگراف تازه.', 'c'),
      ],
      enFa,
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.tgt).toBe('یکی از اجزای مهم تصمیم تزریق وضعیت کلی بیمار و روند آن است.');
    expect(out[0]?.src).toBe(
      'One of the key components of the transfusion decision is the patient’s overall condition and its trend.',
    );
    expect(out[0]?.ids).toEqual(['a', 'b']);
  });

  it('removes the hyphen of a word broken across lines', () => {
    const out = reflowRows(
      [
        row('paragraph', 'the incidence of blood transfusion-related transmis-', 'الف', 'a'),
        row('paragraph', 'sion decreased.', 'ب', 'b'),
      ],
      enFa,
    );
    expect(out[0]?.src).toBe('the incidence of blood transfusion-related transmission decreased.');
  });

  it('never joins a short label or a finished sentence', () => {
    const out = reflowRows(
      [
        row('paragraph', 'Monitoring protocol', 'پروتکل پایش', 'a'),
        row('paragraph', 'blood volume is checked.', 'حجم خون بررسی می‌شود.', 'b'),
      ],
      enFa,
    );
    expect(out).toHaveLength(2);
  });

  it('turns a line set in capitals into a subheading', () => {
    expect(isCapsHeading('THE 1960s', 'en')).toBe(true);
    expect(isCapsHeading('Hb-BASED OXYGEN CARRIERS', 'en')).toBe(true);
    expect(isCapsHeading('This is a sentence.', 'en')).toBe(false);
    expect(isCapsHeading('نکات کلیدی', 'fa')).toBe(false);
    const out = reflowRows([row('paragraph', 'KEY POINTS', 'نکات کلیدی')], enFa);
    expect(out[0]?.type).toBe('subheading');
  });

  it('drops the source book’s own contents lines and stray marks', () => {
    expect(isLeaderLine('قانون مبارزه با پولشویی ........................ ۵۰')).toBe(true);
    expect(isLeaderLine('A sentence. Another one.')).toBe(false);
    const out = reflowRows(
      [
        row('paragraph', 'Chapter 1 ............ 12', 'فصل ۱ ............ ۱۲'),
        row('paragraph', '–', '–'),
        row('paragraph', 'Text.', 'متن.'),
      ],
      enFa,
    );
    expect(out.map((r) => r.tgt)).toEqual(['متن.']);
  });

  it('splits bullets that were run into one paragraph', () => {
    const out = reflowRows(
      [row('paragraph', '• First point. • Second point.', '• نکته‌ی اول. • نکته‌ی دوم.', 'a')],
      enFa,
    );
    expect(out.map((r) => [r.type, r.marker, r.tgt, r.src])).toEqual([
      ['list_item', 'bullet', 'نکته‌ی اول.', 'First point.'],
      ['list_item', 'bullet', 'نکته‌ی دوم.', 'Second point.'],
    ]);
    expect(out[0]?.ids).toEqual(['a']);
    expect(out[1]?.ids).toEqual([]);
  });

  it('splits numbered items and articles of a Persian text at sentence ends only', () => {
    const text =
      'ماده ۵ - وظایف اتاق عبارت است از: الف - ایجاد هماهنگی میان بازرگانان. ب - ارائه‌ی نظر مشورتی. ماده ۶ - ارکان اتاق ایران.';
    const out = reflowRows([row('paragraph', text, text, 'a')], faFa);
    expect(out.map((r) => r.tgt)).toEqual([
      'ماده ۵ - وظایف اتاق عبارت است از:',
      'الف - ایجاد هماهنگی میان بازرگانان.',
      'ب - ارائه‌ی نظر مشورتی.',
      'ماده ۶ - ارکان اتاق ایران.',
    ]);
    expect(out.slice(1).every((r) => r.type === 'list_item' && r.marker === 'own')).toBe(true);
    // Every word is still there.
    expect(out.map((r) => r.tgt).join(' ')).toBe(text);
  });

  it('draws a bullet for a dash marker and keeps a written number', () => {
    const out = reflowRows(
      [
        row('list_item', '- in the event of a request', '- در صورت درخواست خریدار', 'a'),
        row('list_item', '۲ - مورد دوم', '۲ - مورد دوم', 'b'),
      ],
      faFa,
    );
    expect(out.map((r) => [r.marker, r.tgt])).toEqual([
      ['bullet', 'در صورت درخواست خریدار'],
      ['own', '۲ - مورد دوم'],
    ]);
  });

  it('keeps one of two identical headings in a row', () => {
    const out = reflowRows([row('heading', 'Therapy', 'درمان', 'a'), row('heading', 'Therapy', 'درمان', 'b')], enFa);
    expect(out).toHaveLength(1);
    expect(out[0]?.ids).toEqual(['a', 'b']);
  });

  it('reads caption words and list letters from the language registry', () => {
    expect(getLanguage('fa').captionWords.tab).toContain('جدول');
    expect(getLanguage('en').captionWords.fig).toContain('Fig.');
    expect(getLanguage('en').listLetters).toBeUndefined();
  });
});
