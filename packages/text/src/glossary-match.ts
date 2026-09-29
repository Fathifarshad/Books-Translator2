import { getLanguage } from './languages';

export interface MatchableTerm {
  id: string;
  /** The surface form in this language (e.g. the English source term or its Persian equivalent). */
  text: string;
}

export interface GlossaryMatch {
  start: number;
  end: number;
  termId: string;
}

export interface GlossaryMatcher {
  find(text: string): GlossaryMatch[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Per-language inflection rules. Unknown languages get exact (case-insensitive) matching only.
const INFLECTIONS: Record<string, (term: string) => string> = {
  en: (term) => {
    const words = term.trim().split(/\s+/).map(escapeRegex);
    const last = words.pop() ?? '';
    const lastPattern =
      /y$/i.test(last) && !/[aeiou]y$/i.test(last) ? `${last.slice(0, -1)}(?:y|ies)` : `${last}(?:s|es)?`;
    return [...words, `${lastPattern}(?:['’]s|['’])?`].join('\\s+');
  },
  fa: (term) => {
    const words = normalizeArabicLetters(term.trim())
      .split(/[\s\u200c]+/)
      .map((w) => escapeRegex(w).replace(/ی/g, '[یي]').replace(/ک/g, '[کك]'));
    // Plural and ezafe suffixes, attached with or without ZWNJ.
    return `${words.join('[\\s\\u200c]+')}(?:\\u200c?(?:هایی|های|ها|ای|ی))?`;
  },
};

/** 1:1 replacements only (offsets stay valid): Arabic yeh/kaf → Persian. */
export function normalizeArabicLetters(text: string): string {
  return text.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
}

/**
 * Builds a matcher for glossary terms in one language. Longest match wins; matches never overlap.
 * English: case-insensitive with plural/possessive; Persian: tolerant of ZWNJ/space and common suffixes.
 */
export function createGlossaryMatcher(terms: MatchableTerm[], lang: string): GlossaryMatcher {
  const inflect = INFLECTIONS[lang] ?? ((t: string) => escapeRegex(t.trim()).replace(/\s+/g, '\\s+'));
  const usable = terms.filter((t) => t.text.trim().length > 1).sort((a, b) => b.text.length - a.text.length);
  if (usable.length === 0) return { find: () => [] };

  const letter = getLanguage(lang).script === 'Arab' ? '[\\p{L}\\p{M}\\u200c]' : '[\\p{L}\\p{N}]';
  const body = usable.map((t) => `(${inflect(t.text)})`).join('|');
  const source = `(?<!${letter})(?:${body})(?!${getLanguage(lang).script === 'Arab' ? '[\\p{L}\\p{M}]' : '[\\p{L}\\p{N}]'})`;
  const re = new RegExp(source, 'giu');

  return {
    find(text: string): GlossaryMatch[] {
      const out: GlossaryMatch[] = [];
      re.lastIndex = 0;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        const groupIndex = m.findIndex((g, i) => i > 0 && g !== undefined);
        const term = usable[groupIndex - 1];
        if (term && m[0].length > 0) out.push({ start: m.index, end: m.index + m[0].length, termId: term.id });
        if (m[0].length === 0) re.lastIndex += 1;
      }
      return out;
    },
  };
}
