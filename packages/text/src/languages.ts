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
  /**
   * Spoken forms for reading aloud (number words, units, «percent»), resolved in `speech.ts`. A language
   * without them is still read — only numbers and units stay as written.
   */
  speech?: string;
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
    speech: 'en',
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
    speech: 'fa',
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

/** Language of a new book, and the language it is translated into, unless the user picks others. */
export const DEFAULT_SOURCE_LANG: KnownLanguage = 'en';
export const DEFAULT_TARGET_LANG: KnownLanguage = 'fa';

/**
 * A book whose target language is its own language is *edited*, not translated (ADR-045): the pipeline skips the
 * brief, glossary and translation stages, the editor works on the original text, and its changes become the
 * errata list («فایل سوتی»).
 */
export function isEditOnly(sourceLang: string, targetLang: string): boolean {
  return sourceLang === targetLang;
}

export interface BookKind {
  sourceLang: KnownLanguage;
  targetLang: KnownLanguage;
  editOnly: boolean;
}

/**
 * What a new book can be, from the registry: a book in any other language translated into `target`, then a book
 * written in `target` itself, edited without translation.
 */
export function bookKinds(target: KnownLanguage = DEFAULT_TARGET_LANG): BookKind[] {
  const codes = Object.keys(LANGUAGES) as KnownLanguage[];
  return [
    ...codes.filter((c) => c !== target).map((c) => ({ sourceLang: c, targetLang: target, editOnly: false })),
    { sourceLang: target, targetLang: target, editOnly: true },
  ];
}
