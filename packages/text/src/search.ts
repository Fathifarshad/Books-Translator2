import { toLatinDigits } from './digits';

/**
 * Search normalization (SPEC §9.5-6) — for FTS/search only, never for display.
 * Unifies ی/ک and digits, strips diacritics and tatweel, lowercases Latin, and canonicalizes affix
 * joins so «کتاب‌ها», «کتاب ها» and «کتابها» all normalize to the same string.
 */
export interface NormalizedText {
  text: string;
  /** map[i] = index in the original string of normalized character i. */
  map: number[];
}

const DIACRITICS = /[\u064B-\u065F\u0670\u0640]|[\u0300-\u036F]/u;
const ZWNJ = '\u200c';
const JOIN_SUFFIXES = ['هایی', 'های', 'ها', 'ترین', 'تر'];
const JOIN_PREFIXES = ['نمی', 'می'];

export function normalizeWithMap(input: string): NormalizedText {
  // NFD can change lengths; build the map against the original via per-char decomposition.
  const chars: { ch: string; orig: number }[] = [];
  let origIndex = 0;
  for (const ch of input) {
    for (const part of ch.normalize('NFD')) chars.push({ ch: part, orig: origIndex });
    origIndex += ch.length;
  }

  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const { ch, orig } = chars[i] as { ch: string; orig: number };
    if (DIACRITICS.test(ch)) continue;
    let c = ch;
    if (c === 'ي' || c === 'ى') c = 'ی';
    else if (c === 'ك') c = 'ک';
    else if (c === 'ة') c = 'ه';
    else if (c === 'أ' || c === 'إ' || c === 'ٱ') c = 'ا';
    c = toLatinDigits(c).toLowerCase();

    if (c === ZWNJ || /\s/u.test(c)) {
      // Drop a joiner/space when it separates a stem from a known suffix or a verbal prefix from its verb.
      const before = out.join('');
      const after = chars
        .slice(i + 1, i + 6)
        .map((x) => x.ch)
        .join('');
      const suffixFollows = JOIN_SUFFIXES.some(
        (s) => after.startsWith(s) && !/[\p{L}]/u.test(after.charAt(s.length) || ' '),
      );
      const prefixPrecedes = JOIN_PREFIXES.some(
        (p) => before.endsWith(p) && !/[\p{L}]/u.test(before.charAt(before.length - p.length - 1) || ' '),
      );
      // Otherwise a ZWNJ counts as a word gap, so «جست‌وجو» and «جست وجو» match each other.
      if ((suffixFollows || prefixPrecedes) && /[\u0600-\u06FF]/u.test(before.slice(-1))) continue;
      if (out[out.length - 1] === ' ') continue;
      c = ' ';
    }
    out.push(c);
    map.push(orig);
  }
  return { text: out.join(''), map };
}

export function normalizeForSearch(text: string): string {
  return normalizeWithMap(text).text.trim();
}

export interface TextRange {
  start: number;
  end: number;
}

/** Finds all occurrences of `query` in `text` using search normalization; returns ranges in `text`. */
export function findNormalized(text: string, query: string): TextRange[] {
  const q = normalizeForSearch(query);
  if (!q) return [];
  const { text: norm, map } = normalizeWithMap(text);
  const out: TextRange[] = [];
  let from = 0;
  for (let at = norm.indexOf(q, from); at !== -1; at = norm.indexOf(q, from)) {
    const start = map[at] as number;
    const lastOrig = map[at + q.length - 1] as number;
    const end = lastOrig + ((text.codePointAt(lastOrig) ?? 0) > 0xffff ? 2 : 1);
    out.push({ start, end });
    from = at + q.length;
  }
  return out;
}
