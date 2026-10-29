import { describe, expect, it } from 'vitest';
import { dropForeignParentheticals, numberToWords, speechSsml, speechText, spellNumbers, spellUnits } from './speech';

/**
 * Text a voice can read (ADR-042). A translation is written to be read; spoken literally it says digits one by
 * one, shouts the English term out of the middle of a Persian sentence and reads footnote markers aloud.
 */
describe('numbers as words', () => {
  it('writes Persian numbers the way they are said', () => {
    const fa = (n: number) => numberToWords(n, 'fa');
    expect(fa(0)).toBe('صفر');
    expect(fa(5)).toBe('پنج');
    expect(fa(15)).toBe('پانزده');
    expect(fa(35)).toBe('سی و پنج');
    expect(fa(100)).toBe('صد');
    expect(fa(101)).toBe('صد و یک');
    expect(fa(1_000)).toBe('هزار');
    expect(fa(2_025)).toBe('دو هزار و بیست و پنج');
    expect(fa(1_887)).toBe('هزار و هشتصد و هشتاد و هفت');
    expect(fa(1_000_000)).toBe('یک میلیون');
    expect(fa(-7)).toBe('منفی هفت');
  });

  it('writes English numbers too', () => {
    const en = (n: number) => numberToWords(n, 'en');
    expect(en(0)).toBe('zero');
    expect(en(21)).toBe('twenty-one');
    expect(en(1_887)).toBe('one thousand eight hundred and eighty-seven');
  });

  it('leaves a language the registry has no spoken forms for alone', () => {
    expect(numberToWords(35, 'de')).toBeNull();
    expect(spellNumbers('۳۵٪', 'de')).toBe('۳۵٪');
  });
});

describe('numbers, percentages and ranges inside a sentence', () => {
  it('reads Persian digits, a percentage and a range as words', () => {
    expect(spellNumbers('افزایش ۳۵٪', 'fa')).toBe('افزایش سی و پنج درصد');
    expect(spellNumbers('افزایش ۳۵ تا ۴۵ درصد', 'fa')).toBe('افزایش سی و پنج تا چهل و پنج درصد');
    expect(spellNumbers('۳۵–۴۵٪', 'fa')).toBe('سی و پنج تا چهل و پنج درصد');
  });

  it('reads a decimal as a decimal, not as two numbers', () => {
    expect(spellNumbers('۰٫۵ گرم', 'fa')).toBe('صفر ممیز پنج گرم');
  });

  it('keeps thousands together instead of reading the separator', () => {
    expect(spellNumbers('۲٬۲۳۱ بند', 'fa')).toBe('دو هزار و دویست و سی و یک بند');
  });
});

describe('the original terms in parentheses', () => {
  it('leaves out a term in the other script, which only breaks a spoken sentence', () => {
    expect(dropForeignParentheticals('بی‌هوشی (Anesthesia) عمومی', 'fa')).toBe('بی‌هوشی عمومی');
  });

  it('keeps a parenthesis that is part of the sentence', () => {
    expect(dropForeignParentheticals('سه گروه (الف، ب و ج) بررسی شدند', 'fa')).toBe('سه گروه (الف، ب و ج) بررسی شدند');
  });

  it('keeps everything when the reader asked for the original terms', () => {
    expect(speechText('بی‌هوشی (Anesthesia)', 'fa', { keepForeignTerms: true })).toContain('Anesthesia');
  });
});

describe('short units', () => {
  it('says them in full', () => {
    expect(spellUnits('فشار ۱۲۰ mmHg', 'fa')).toContain('میلی‌متر جیوه');
    expect(spellUnits('۵ mg', 'fa')).toContain('میلی‌گرم');
    expect(spellUnits('5 mg', 'en')).toContain('milligrams');
  });
});

describe('the whole preparation', () => {
  it('removes what is for the eye and writes what is for the ear', () => {
    const written = 'فشار خون (blood pressure) تا ۲۰٪ کم می‌شود[^14]. *مهم* است.';
    const spoken = speechText(written, 'fa');
    expect(spoken).not.toContain('blood pressure');
    expect(spoken).not.toContain('[^14]');
    expect(spoken).not.toContain('*');
    expect(spoken).toContain('بیست درصد');
    expect(spoken).toContain('مهم');
  });
});

describe('SSML', () => {
  it('puts a silence between lines so it is not one wall of speech', () => {
    const ssml = speechSsml('سطر یک\nسطر دو', 'fa', { pauseMs: 700 });
    expect(ssml).toBe('<p>سطر یک<break time="700ms"/>سطر دو</p>');
  });

  it('marks a run in the other script so the voice switches language', () => {
    const ssml = speechSsml('نام آن cardiac output است', 'fa', {
      foreignLang: 'en-US',
      keepForeignTerms: true,
      spellNumbers: false,
    });
    expect(ssml).toContain('<lang xml:lang="en-US">cardiac output</lang>');
  });

  it('escapes what would otherwise close a tag', () => {
    expect(speechSsml('a < b & c', 'en', { spellNumbers: false })).toContain('a &lt; b &amp; c');
  });
});
