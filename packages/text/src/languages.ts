/**
 * Content-language registry (SPEC §14). Components and pipeline logic never hard-code language codes;
 * they read the book's `sourceLang` / target language and look them up here.
 * Adding a target language = a registry entry + `prompts/style/<lang>.md` (+ optional normalizer and font).
 */
export type TextDirection = 'ltr' | 'rtl';

export interface LanguageInfo {
  name: string;
  nativeName: string;
  dir: TextDirection;
  script: 'Latn' | 'Arab' | 'Cyrl' | 'Hebr';
  /** CLDR numbering system used for digits in running text of this language. */
  digits: 'latn' | 'arabext' | 'arab';
  locale: string;
  fonts: { text: string; ui: string };
  quotes: readonly [open: string, close: string];
  styleGuide?: string;
  normalizer?: string;
  /** Characters that may end a sentence (used to detect paragraphs broken mid-sentence). */
  terminalPunctuation: string;
  /** Emphasis rendering: Arabic-script languages use weight instead of fake italics. */
  emphasis: 'italic' | 'weight';
  /** Words used for `[[fig:…]]` / `[[tab:…]]` references inside text of this language. */
  refLabels: { fig: string; tab: string };
  /** Tesseract language code for OCR of scanned pages (its data package must be installed). */
  ocr?: string;
}

export const LANGUAGES = {
  en: {
    name: 'English',
    nativeName: 'English',
    dir: 'ltr',
    script: 'Latn',
    digits: 'latn',
    locale: 'en-US',
    fonts: { text: 'Literata', ui: 'Vazirmatn' },
    quotes: ['“', '”'],
    terminalPunctuation: '.?!:”’)"\'…',
    emphasis: 'italic',
    refLabels: { fig: 'Figure', tab: 'Table' },
    ocr: 'eng',
  },
  fa: {
    name: 'Persian',
    nativeName: 'فارسی',
    dir: 'rtl',
    script: 'Arab',
    digits: 'arabext',
    locale: 'fa-IR',
    fonts: { text: 'Vazirmatn', ui: 'Vazirmatn' },
    quotes: ['«', '»'],
    styleGuide: 'prompts/style/fa.md',
    normalizer: 'fa',
    terminalPunctuation: '.?!:؟»)…',
    emphasis: 'weight',
    refLabels: { fig: 'شکل', tab: 'جدول' },
    ocr: 'fas',
  },
} as const satisfies Record<string, LanguageInfo>;

export type KnownLanguage = keyof typeof LANGUAGES;

const FALLBACK: LanguageInfo = LANGUAGES.en;

export function isKnownLanguage(code: string): code is KnownLanguage {
  return Object.hasOwn(LANGUAGES, code);
}

/** Registry lookup that never throws: unknown codes fall back to LTR/Latin defaults. */
export function getLanguage(code: string): LanguageInfo {
  return isKnownLanguage(code) ? LANGUAGES[code] : FALLBACK;
}

/** Tesseract code for a book language; undefined for languages without OCR support. */
export function ocrLanguageOf(code: string): string | undefined {
  return isKnownLanguage(code) ? (LANGUAGES[code] as LanguageInfo).ocr : undefined;
}

export function dirOf(code: string): TextDirection {
  return getLanguage(code).dir;
}

export function localeOf(code: string): string {
  return getLanguage(code).locale;
}
