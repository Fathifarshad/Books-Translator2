import { sampleBook } from '@dozabaneh/shared/sample-book';
import { describe, expect, it } from 'vitest';
import { createBookIndex } from './book';
import { buildErrata, diffHunks } from './errata';

const index = createBookIndex(sampleBook);
const paragraphs = sampleBook.segments.filter((s) => s.type === 'paragraph');
const first = paragraphs[0];
const second = paragraphs[1];

describe('diff hunks', () => {
  it('keeps a ZWNJ fix as one correction («می شود» → «می‌شود»)', () => {
    expect(diffHunks('این کار انجام می شود و تمام.', 'این کار انجام می‌شود و تمام.')).toEqual([
      { before: 'می شود', after: 'می‌شود', at: 14 },
    ]);
  });

  it('reports insertions and deletions separately when unchanged words lie between them', () => {
    const hunks = diffHunks('کتاب را خواندم و و رفتم', 'کتاب را خواندم و رفتم .');
    expect(hunks.map((h) => [h.before, h.after])).toEqual([
      ['و', ''],
      ['', '.'],
    ]);
  });
});

describe('errata list (ADR-045)', () => {
  it('lists every real correction with location, page, paragraph, reason and context', () => {
    if (!first || !second) throw new Error('sample book has paragraphs');
    const errata = buildErrata(index, 'fa', [
      {
        segmentId: first.id,
        before: 'این روش ساده است ولی موثر می باشد.',
        after: 'این روش ساده است ولی مؤثر است.',
        changes: [
          { type: 'spelling', before: 'موثر', after: 'مؤثر', reason: 'همزه روی واو' },
          { type: 'wording', before: 'می باشد', after: 'است', reason: 'پرهیز از «می‌باشد»' },
          // Described but never made: must not appear.
          { type: 'punctuation', before: 'ساده', after: 'ساده،', reason: 'ویرگول' },
        ],
      },
      { segmentId: second.id, before: 'متن بدون تغییر.', after: 'متن بدون تغییر.', changes: [] },
    ]);
    expect(errata.segments).toBe(1);
    expect(errata.entries.map((e) => [e.before, e.after, e.type, e.reason])).toEqual([
      ['موثر می باشد.', 'مؤثر است.', 'spelling', 'همزه روی واو'],
    ]);
    const e = errata.entries[0];
    expect(e?.n).toBe(1);
    expect(e?.paragraph).toBeGreaterThan(0);
    expect(e?.location.length).toBeGreaterThan(0);
    expect(e?.page).toBe(sampleBook.book.pageLabels[first.page] || String(first.page + 1));
    expect(e?.context).toContain('موثر');
  });

  it('marks a correction no engine described as «other», with no reason', () => {
    if (!first) throw new Error('sample book has paragraphs');
    const errata = buildErrata(index, 'fa', [
      { segmentId: first.id, before: 'یک دو سه', after: 'یک دو چهار', changes: [] },
    ]);
    expect(errata.entries).toMatchObject([{ before: 'سه', after: 'چهار', type: 'other', reason: '' }]);
  });

  it('counts Arabic letter forms once instead of listing every occurrence', () => {
    if (!first || !second) throw new Error('sample book has paragraphs');
    const errata = buildErrata(index, 'fa', [
      { segmentId: first.id, before: 'كتاب علمي', after: 'کتاب علمی', changes: [] },
      { segmentId: second.id, before: 'يك روز', after: 'یک روز', changes: [] },
    ]);
    expect(errata.entries).toEqual([]);
    // «كتاب علمي» is one correction (two adjacent words), «يك» another.
    expect(errata.systematic).toEqual([{ type: 'characters', count: 2 }]);
  });

  it('follows document order, not the order of the sources', () => {
    if (!first || !second) throw new Error('sample book has paragraphs');
    const errata = buildErrata(index, 'fa', [
      { segmentId: second.id, before: 'الف', after: 'ب', changes: [] },
      { segmentId: first.id, before: 'ج', after: 'د', changes: [] },
    ]);
    expect(errata.entries.map((e) => e.segmentId)).toEqual([first.id, second.id]);
  });
});
