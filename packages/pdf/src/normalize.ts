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
 * Page cleanup on raw text (SPEC §8.3): NFC, ligatures expanded, soft hyphens removed, odd spaces
 * normalized. Curly quotes and dashes are kept.
 */
export function normalizeRunText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[ﬀ-ﬆ]/gu, (c) => LIGATURES[c] ?? c)
    .replace(/\u{00AD}/gu, '')
    .replace(/[\u{00A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu, ' ')
    .replace(/[\u{200B}\u{FEFF}]/gu, '');
}

const BOLD = /bold|black|heavy|semibold|demi|[-,]b$|extrabold|ultrabold/i;
const ITALIC = /italic|oblique|[-,]it$|[-,]i$|slanted/i;
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
  return {
    bold: Boolean(hints.bold) || BOLD.test(clean),
    italic: Boolean(hints.italic) || ITALIC.test(clean) || /BoldIt|[a-z]It\b/.test(clean),
    mono: Boolean(hints.mono) || hints.family === 'monospace' || MONO.test(clean),
  };
}
