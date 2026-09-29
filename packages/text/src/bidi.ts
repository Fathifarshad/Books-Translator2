import type { TextDirection } from './languages';

// Strong RTL: Hebrew, Arabic, Syriac, Thaana, NKo, Arabic presentation forms.
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/u;

/** Direction of the first strong character (like `dir="auto"`), or `fallback` when none is found. */
export function firstStrongDir(text: string, fallback: TextDirection = 'ltr'): TextDirection {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return 'rtl';
    if (LTR_CHAR.test(ch)) return 'ltr';
  }
  return fallback;
}

export function hasRtl(text: string): boolean {
  return RTL_CHAR.test(text);
}

const FSI = '\u2068';
const PDI = '\u2069';

/**
 * Wraps a run in First-Strong-Isolate … Pop-Directional-Isolate. Use for plain-text surfaces where
 * `<bdi>` is not available (document.title, clipboard text, aria-labels composed from mixed runs).
 */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}
