const LIGATURES: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'st',
  ﬆ: 'st',
};

/**
 * Page cleanup on raw text (SPEC §8.3): NFC, ligatures and Arabic presentation forms expanded, soft hyphens
 * removed, odd spaces normalized. Curly quotes, dashes and the zero-width non-joiner («می‌شود») are kept.
 */
export function normalizeRunText(text: string): string {
  return (
    text
      .normalize('NFC')
      .replace(/[ﬀ-ﬆ]/gu, (c) => LIGATURES[c] ?? c)
      // Arabic-script presentation forms (contextual glyph shapes some Persian/Arabic PDFs map their text to) become
      // the letters they show, so «ﺳﻼﻡ» is searchable and editable as «سلام».
      .replace(/[\u{FB50}-\u{FDFF}\u{FE70}-\u{FEFC}]/gu, (c) => c.normalize('NFKC'))
      .replace(/\u{00AD}/gu, '')
      .replace(/[\u{00A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu, ' ')
      .replace(/[\u{200B}\u{FEFF}]/gu, '')
  );
}

const BOLD = /bold|black|heavy|semibold|demi|[-,]b$|extrabold|ultrabold/i;
const ITALIC = /italic|oblique|[-,]it$|[-,]i$|slanted/i;
const OCR_LAYER_FONT = /^GlyphLessFont$/i;
const MONO = /mono|courier|consol|menlo|inconsolata|typewriter|code|fixed|lucidaconsole/i;

export interface FontStyle {
  bold: boolean;
  italic: boolean;
  mono: boolean;
}

/** Bold / italic / mono from the real font name (e.g. "ABCDEF+Minion-BoldIt") and pdf.js hints. */
export function fontStyle(
  name: string,
  hints: { family?: string; bold?: boolean; italic?: boolean; mono?: boolean } = {},
): FontStyle {
  const clean = name.replace(/^[A-Z]{6}\+/, '');
  // Invisible OCR text layers (Tesseract via PDF24, ocrmypdf…) use GlyphLessFont, which pdf.js reports as
  // monospace; it carries no style at all, so it is plain body text, never code.
  if (OCR_LAYER_FONT.test(clean)) return { bold: false, italic: false, mono: false };
  return {
    bold: Boolean(hints.bold) || BOLD.test(clean),
    italic: Boolean(hints.italic) || ITALIC.test(clean) || /BoldIt|[a-z]It\b/.test(clean),
    mono: Boolean(hints.mono) || hints.family === 'monospace' || MONO.test(clean),
  };
}
