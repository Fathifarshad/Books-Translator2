import { describe, expect, it } from 'vitest';
import { digitSequences, formatNumber, formatPercent, localizeDigits, toLatinDigits } from './digits';

describe('digits', () => {
  it('converts Persian and Arabic-Indic digits to Latin', () => {
    expect(toLatinDigits('۱۲۳۴ و ٥٦٧')).toBe('1234 و 567');
  });

  it('localizes digits per text-run language (bug §4.2-7)', () => {
    expect(localizeDigits('Sample Press 2025', 'en')).toBe('Sample Press 2025');
    expect(localizeDigits('Sample Press ۲۰۲۵', 'en')).toBe('Sample Press 2025');
    expect(localizeDigits('سال 2025', 'fa')).toBe('سال ۲۰۲۵');
    expect(localizeDigits('unknown 42', 'xx')).toBe('unknown 42');
  });

  it('formats numbers and percentages for the locale', () => {
    expect(formatNumber(1200, 'fa-IR')).toBe('۱٬۲۰۰');
    expect(formatPercent(1, 'fa-IR')).toMatch(/^۱۰۰\s?٪$/);
    expect(formatPercent(0.78, 'en-US')).toBe('78%');
  });

  it('extracts digit sequences independent of numbering system', () => {
    expect(digitSequences('in 1843 and ۱۹۵۰')).toEqual(['1843', '1950']);
  });
});
