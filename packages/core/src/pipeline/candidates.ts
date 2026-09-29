import { type MarkupToken, plainText, splitSentences, tokenize } from '@dozabaneh/text';

/**
 * Glossary candidates found in code (SPEC §9.3-1): frequent n-grams (1–4 words, stop-word filtered), capitalized
 * sequences (names, organizations), acronyms and terms emphasized at first use. The AI consolidation step then
 * keeps or drops each candidate and proposes equivalents.
 */
export interface GlossaryCandidate {
  src: string;
  freq: number;
  examples: string[];
  score: number;
}

export interface CandidateOptions {
  /** Maximum number of candidates returned (highest score first). */
  max?: number;
  /** Lower-cased source terms that are already in the glossary. */
  exclude?: Set<string>;
}

// Function words per source language; languages without a list only get names, acronyms and emphasized terms.
const STOPWORDS: Record<string, ReadonlySet<string>> = {
  en: new Set(
    `a about above after again against all almost also although always am among an and another any are around as at
    be because been before being below between both but by can cannot could did do does doing done down during each
    either else enough even ever every few first for from further get gets getting given gives go goes going got had
    has have having he her here hers herself him himself his how however i if in instead into is it its itself just
    last least less let like made make makes making many may me might more most much must my myself near need never
    new next no nor not now of off often on once one only onto or other others our ours ourselves out over own per
    perhaps quite rather really same second see seen several shall she should since so some something sometimes such
    than that the their theirs them themselves then there these they thing things this those though three through
    thus to too two under until up upon us use used uses using very via was way ways we well were what when where
    whether which while who whom whose why will with within without would yet you your yours yourself`.split(/\s+/u),
  ),
};

const WORD = /\p{L}[\p{L}\p{N}'’-]*/gu;
const CLAUSE_BREAK = /[,;:()[\]{}«»"“”—–?!.]/u;

interface Tally {
  count: number;
  forms: Map<string, number>;
  bonus: number;
  words: number;
}

// Plural → singular of a word, per source language (null when the word does not look plural).
const SINGULAR: Record<string, (word: string) => string | null> = {
  en: (w) => {
    if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (/(?:ses|xes|zes|ches|shes)$/u.test(w)) return w.slice(0, -2);
    if (w.endsWith('s') && !/(?:ss|us|is)$/u.test(w)) return w.slice(0, -1);
    return null;
  },
};

/**
 * "pulleys" and "pulley" are one glossary entry: a plural candidate is merged into its singular form, but only when
 * the singular also occurs in the book (so words such as "physics" are never cut down).
 */
function mergePlurals(tallies: Map<string, Tally>, lang: string): void {
  const singular = SINGULAR[lang];
  if (!singular) return;
  for (const [key, t] of [...tallies]) {
    const words = key.split(' ');
    const last = singular(words.at(-1) ?? '');
    if (!last) continue;
    const target = [...words.slice(0, -1), last].join(' ');
    const into = tallies.get(target);
    if (!into || target === key) continue;
    into.count += t.count;
    into.bonus = Math.max(into.bonus, t.bonus);
    tallies.delete(key);
  }
}

function emphasized(tokens: MarkupToken[], out: string[] = []): string[] {
  for (const t of tokens) {
    if (t.type === 'em' || t.type === 'strong') {
      const text = plainText(t.children).trim();
      if (text && text.split(/\s+/u).length <= 4) out.push(text);
      emphasized(t.children, out);
    }
  }
  return out;
}

export function extractCandidates(texts: string[], lang: string, opts: CandidateOptions = {}): GlossaryCandidate[] {
  const stop = STOPWORDS[lang];
  const tallies = new Map<string, Tally>();
  const sentences: string[] = [];
  const add = (form: string, words: number, bonus = 0) => {
    const key = form.toLowerCase();
    const t = tallies.get(key) ?? { count: 0, forms: new Map(), bonus: 0, words };
    t.count++;
    t.bonus = Math.max(t.bonus, bonus);
    t.forms.set(form, (t.forms.get(form) ?? 0) + 1);
    tallies.set(key, t);
  };

  for (const src of texts) {
    const tokens = tokenize(src).filter((t) => t.type !== 'code' && t.type !== 'url');
    const text = plainText(tokens);
    for (const term of emphasized(tokens)) add(term, term.split(/\s+/u).length, 6);
    for (const sentence of splitSentences(text, lang)) {
      sentences.push(sentence);
      for (const clause of sentence.split(CLAUSE_BREAK)) {
        const words = [...clause.matchAll(WORD)].map((m) => m[0]);
        // Capitalized sequences (not the sentence's first word alone) and acronyms.
        let run: string[] = [];
        const flush = () => {
          if (run.length >= 2 || (run.length === 1 && clause.trimStart().indexOf(run[0] as string) > 0))
            add(run.join(' '), run.length, 2);
          run = [];
        };
        for (const w of words) {
          if (/^\p{Lu}{2,}\p{N}*$/u.test(w)) {
            flush();
            add(w, 1, 2);
          } else if (/^\p{Lu}\p{Ll}/u.test(w) && !stop?.has(w.toLowerCase())) run.push(w);
          else flush();
        }
        flush();
        if (!stop) continue;
        // Content n-grams: no stop word at either end, no very short words.
        for (let n = 1; n <= 4; n++) {
          for (let i = 0; i + n <= words.length; i++) {
            const gram = words.slice(i, i + n);
            const first = (gram[0] as string).toLowerCase();
            const last = (gram[n - 1] as string).toLowerCase();
            if (stop.has(first) || stop.has(last)) continue;
            if (gram.some((w) => w.length < 2)) continue;
            if (n === 1 && first.length < 4) continue;
            add(gram.join(' ').toLowerCase(), n);
          }
        }
      }
    }
  }

  mergePlurals(tallies, lang);
  const exclude = opts.exclude ?? new Set<string>();
  let list = [...tallies.entries()]
    .filter(([key, t]) => {
      if (exclude.has(key)) return false;
      if (t.bonus >= 6) return true;
      if (t.bonus >= 2) return t.count >= 2;
      return t.words === 1 ? t.count >= 4 : t.count >= 3;
    })
    .map(([key, t]) => {
      const form = [...t.forms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;
      return { key, form, count: t.count, words: t.words, score: t.count * t.words ** 1.5 + t.bonus };
    });

  // Drop a shorter candidate when a longer one containing it accounts for most of its occurrences.
  list = list.filter(
    (c) => !list.some((o) => o.words > c.words && ` ${o.key} `.includes(` ${c.key} `) && o.count >= 0.8 * c.count),
  );

  return list
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, opts.max ?? 120)
    .map((c) => ({
      src: c.form,
      freq: c.count,
      score: Math.round(c.score * 10) / 10,
      examples: sentences
        .filter((s) => s.toLowerCase().includes(c.key))
        .slice(0, 2)
        .map((s) => (s.length > 240 ? `${s.slice(0, 237)}…` : s)),
    }));
}
