import { getLanguage } from './languages';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Converts Persian (U+06F0…) and Arabic-Indic (U+0660…) digits to ASCII digits. */
export function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => {
    const p = PERSIAN_DIGITS.indexOf(d);
    return String(p >= 0 ? p : ARABIC_DIGITS.indexOf(d));
  });
}

function toDigitSet(text: string, set: string): string {
  return toLatinDigits(text).replace(/[0-9]/g, (d) => set[Number(d)] ?? d);
}

/**
 * Renders the digits of a text run in the numbering system of the run's language.
 * English (Latin-script) runs always keep Latin digits — fixes prototype bug §4.2-7.
 */
export function localizeDigits(text: string, lang: string): string {
  switch (getLanguage(lang).digits) {
    case 'arabext':
      return toDigitSet(text, PERSIAN_DIGITS);
    case 'arab':
      return toDigitSet(text, ARABIC_DIGITS);
    default:
      return toLatinDigits(text);
  }
}

/** Locale-aware number formatting for UI strings (Persian digits, «٬» and «٪» for fa). */
export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPercent(ratio: number, locale: string): string {
  return formatNumber(ratio, locale, { style: 'percent', maximumFractionDigits: 0 });
}

/** Digit sequences (after normalizing to Latin digits) — used by QA to compare numbers in source and target. */
export function digitSequences(text: string): string[] {
  return toLatinDigits(text).match(/[0-9]+/g) ?? [];
}
