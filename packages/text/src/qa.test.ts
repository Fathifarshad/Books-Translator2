import { describe, expect, it } from 'vitest';
import { applyFirstMentions } from './parentheticals';
import { checkTranslation, findRepetition, lengthOutliers, lengthRatioSuspicious } from './qa';

const ctx = { srcLang: 'en', tgtLang: 'fa' };
const codes = (src: string, tgt: string, glossary?: Parameters<typeof checkTranslation>[2]['glossary']) =>
  checkTranslation(src, tgt, { ...ctx, ...(glossary ? { glossary } : {}) }).map((i) => i.code);

describe('checkTranslation', () => {
  it.each([
    ['A lever multiplies force.', 'اهرم نیرو را چند برابر می‌کند.', []],
    ['A lever multiplies force.', '', ['empty']],
    ['A lever multiplies force.', '   ', ['empty']],
    ['A lever multiplies force.', '**  **', ['empty']],
    ['See note[^1].', 'یادداشت را ببینید.', ['markup']],
    ['See note[^1].', 'یادداشت را ببینید[^1][^1].', ['markup']],
    ['Call `run()` first.', 'اول run() را صدا بزنید.', ['markup']],
    ['Call `run()` first.', 'اول `run()` را صدا بزنید.', []],
    ['As [[fig:2.1]] shows', 'همان‌طور که [[fig:2.1]] نشان می‌دهد', []],
    ['Visit https://example.org today.', 'امروز به example.org سر بزنید.', ['markup']],
    ['In 1950 there were 25 machines.', 'در سال ۱۹۵۰، ۲۵ دستگاه وجود داشت.', []],
    ['In 1950 there were 25 machines.', 'در آن سال ۲۵ دستگاه وجود داشت.', ['numbers']],
    ['It costs 3.5 units.', 'هزینه‌ی آن ۳٫۵ واحد است.', []],
    ['It has 1,200 pages.', 'این کتاب ۱٬۲۰۰ صفحه دارد.', []],
    ['in the 19th century', 'در قرن نوزدهم', []],
    ['in the 1950s', 'در دهه‌ی ۱۹۵۰', []],
    ['See note[^12].', 'یادداشت را ببینید[^12].', []],
    ['A lever multiplies force.', 'A lever multiplies force.', ['target_script']],
    [
      'A lever multiplies force in many simple machines.',
      'اهرم نیرو را در many simple machines we use چند برابر می‌کند.',
      ['untranslated'],
    ],
    ['Abstraction matters.', 'انتزاع (Abstraction) مهم است.', []],
    [
      'Read The Art of Computer Programming.',
      'کتاب «هنر برنامه‌نویسی» (The Art of Computer Programming) را بخوانید.',
      [],
    ],
    ['Use Python and Java.', 'از Python و Java استفاده کنید.', []],
    ['A lever multiplies force.', 'اهرم اهرم اهرم اهرم نیرو را چند برابر می‌کند.', ['repetition']],
    ['A lever multiplies force.', 'اهرم نیرو را چند برابر نیرو را چند برابر نیرو را چند برابر می‌کند.', ['repetition']],
    ['A lever multiplies force.', 'اهرم نیرو را چند برابر مي‌كند.', ['leftover_chars']],
    ['Why, then?', 'پس چرا?', ['latin_punctuation']],
    ['Why, then?', 'پس, چرا؟', ['latin_punctuation']],
    ['He said "go".', 'او گفت "برو".', ['latin_punctuation']],
    ['He said "go".', 'او گفت «برو».', []],
    ['Use `a, b` here.', 'اینجا از `a, b` استفاده کنید.', []],
  ] as [string, string, string[]][])('%s → %s', (src, tgt, expected) => {
    expect(codes(src, tgt)).toEqual(expected);
  });

  const glossary = [
    { src: 'lever', tgt: 'اهرم', alternatives: ['دیلم'], kind: 'term' },
    { src: 'Alan Turing', tgt: 'آلن تورینگ', alternatives: ['آلان تورینگ'], kind: 'person' },
  ];

  it('accepts the approved equivalent, inflected', () => {
    expect(codes('Levers multiply force.', 'اهرم‌ها نیرو را چند برابر می‌کنند.', glossary)).toEqual([]);
  });

  it('flags a missing glossary equivalent', () => {
    expect(codes('The lever is simple.', 'این ابزار ساده است.', glossary)).toEqual(['glossary']);
  });

  it('flags an alternative used instead of the approved equivalent', () => {
    const issues = checkTranslation('The lever is simple.', 'دیلم ساده است.', { ...ctx, glossary });
    expect(issues.map((i) => i.code)).toEqual(['glossary']);
    expect(issues[0]?.message).toContain('instead of the approved');
  });

  it('flags a name rendered differently', () => {
    expect(codes('Alan Turing wrote it.', 'آلان تورینگ آن را نوشت.', glossary)).toEqual(['name']);
    expect(codes('Alan Turing wrote it.', 'آلن تورینگ آن را نوشت.', glossary)).toEqual([]);
  });

  it('ignores glossary entries absent from the source', () => {
    expect(codes('Gears turn.', 'چرخ‌دنده‌ها می‌چرخند.', glossary)).toEqual([]);
  });

  it('every issue says how to fix it', () => {
    for (const issue of checkTranslation('See note[^1] in 1950.', 'یادداشت را ببینید, ok ok ok ok', ctx)) {
      expect(issue.fix.length).toBeGreaterThan(10);
      expect(issue.message.length).toBeGreaterThan(10);
    }
  });

  it('works for a Latin-script target without script checks', () => {
    expect(checkTranslation('A lever.', 'Una palanca.', { srcLang: 'en', tgtLang: 'es' })).toEqual([]);
  });
});

describe('findRepetition', () => {
  it.each([
    ['one two three', null],
    ['very very very good', null],
    ['very very very very good', 'very'],
    ['go on go on go on now', 'go on'],
    ['a b c a b c a b c', 'a b c'],
  ])('%s', (text, expected) => {
    expect(findRepetition(text)).toBe(expected);
  });
});

describe('length checks', () => {
  const src = 'This sentence is long enough to be measured by the length ratio check.';
  it('finds robust outliers only', () => {
    const pairs = Array.from({ length: 8 }, (_, i) => ({ key: String(i), src, tgt: 'ت'.repeat(70 + i) }));
    pairs.push({ key: 'short', src, tgt: 'ت'.repeat(8) });
    expect(lengthOutliers(pairs)).toEqual(['short']);
  });

  it('needs enough data before judging', () => {
    expect(lengthOutliers([{ key: 'a', src, tgt: 'ت' }])).toEqual([]);
  });

  it('flags a single suspicious ratio', () => {
    expect(lengthRatioSuspicious(src, 'ت'.repeat(10), 40)).toBe(true);
    expect(lengthRatioSuspicious(src, 'ت'.repeat(75), 40)).toBe(false);
    expect(lengthRatioSuspicious('Short.', 'ت')).toBe(false);
  });
});

describe('applyFirstMentions', () => {
  const entries = [
    { id: 'g1', src: 'Abstraction', tgt: 'انتزاع', policy: 'first_in_chapter' as const },
    { id: 'g2', src: 'Alan Turing', tgt: 'آلن تورینگ', policy: 'first_in_chapter' as const },
    { id: 'g3', src: 'CPU', tgt: 'پردازنده', policy: 'never' as const },
    { id: 'g4', src: 'Algorithm', tgt: 'الگوریتم', policy: 'always' as const },
  ];

  it('adds the parenthetical at the first mention and removes later duplicates', () => {
    const { items, introduced } = applyFirstMentions(
      [
        { key: '01', text: 'انتزاع ابزار اصلی است.' },
        { key: '02', text: 'انتزاع (Abstraction) را دوباره می‌بینیم.' },
      ],
      entries,
      'fa',
    );
    expect(items.map((i) => i.text)).toEqual(['انتزاع (Abstraction) ابزار اصلی است.', 'انتزاع را دوباره می‌بینیم.']);
    expect(introduced).toEqual(['Abstraction']);
  });

  it('keeps an existing first-mention parenthetical (any case or plural)', () => {
    const { items } = applyFirstMentions([{ key: '01', text: 'انتزاع‌ها (abstractions) مهم‌اند.' }], entries, 'fa');
    expect(items[0]?.text).toBe('انتزاع‌ها (abstractions) مهم‌اند.');
  });

  it('respects terms introduced in an earlier chunk of the chapter', () => {
    const { items, introduced } = applyFirstMentions(
      [{ key: '05', text: 'آلن تورینگ (Alan Turing) این را نشان داد.' }],
      entries,
      'fa',
      ['Alan Turing'],
    );
    expect(items[0]?.text).toBe('آلن تورینگ این را نشان داد.');
    expect(introduced).toEqual([]);
  });

  it('removes parentheticals for policy never and leaves policy always alone', () => {
    const { items } = applyFirstMentions(
      [
        { key: '01', text: 'پردازنده (CPU) و الگوریتم (Algorithm)' },
        { key: '02', text: 'الگوریتم (Algorithm) دوباره' },
      ],
      entries,
      'fa',
    );
    expect(items.map((i) => i.text)).toEqual(['پردازنده و الگوریتم (Algorithm)', 'الگوریتم (Algorithm) دوباره']);
  });

  it('skips headings: they neither get parentheticals nor count as the first mention', () => {
    const { items } = applyFirstMentions(
      [
        { key: '01', text: 'انتزاع', type: 'h' },
        { key: '02', text: 'انتزاع یعنی پنهان کردن جزئیات.', type: 'p' },
      ],
      entries,
      'fa',
    );
    expect(items.map((i) => i.text)).toEqual(['انتزاع', 'انتزاع (Abstraction) یعنی پنهان کردن جزئیات.']);
  });

  it('returns the same items when nothing is managed', () => {
    const input = [{ key: '01', text: 'متن' }];
    expect(applyFirstMentions(input, [], 'fa').items).toBe(input);
  });
});

describe('applyFirstMentions with emphasis', () => {
  const entries = [{ id: 'm', src: 'mechanical advantage', tgt: 'مزیت مکانیکی', policy: 'first_in_chapter' as const }];

  it('recognizes a parenthetical after the closing emphasis marker', () => {
    const text = 'مهندسان آن را *مزیت مکانیکی* (mechanical advantage) می‌نامند.';
    const { items, introduced } = applyFirstMentions([{ key: '01', text }], entries, 'fa');
    expect(items[0]?.text).toBe(text);
    expect(introduced).toEqual(['mechanical advantage']);
  });

  it('adds a missing parenthetical outside the emphasis', () => {
    const { items } = applyFirstMentions([{ key: '01', text: 'این *مزیت مکانیکی* است.' }], entries, 'fa');
    expect(items[0]?.text).toBe('این *مزیت مکانیکی* (mechanical advantage) است.');
  });

  it('removes a later duplicate but keeps the emphasis', () => {
    const { items } = applyFirstMentions(
      [
        { key: '01', text: 'مزیت مکانیکی (mechanical advantage) مهم است.' },
        { key: '02', text: 'باز هم *مزیت مکانیکی* (mechanical advantage) را می‌بینیم.' },
      ],
      entries,
      'fa',
    );
    expect(items[1]?.text).toBe('باز هم *مزیت مکانیکی* را می‌بینیم.');
  });
});
