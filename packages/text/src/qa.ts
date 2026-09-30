import { toLatinDigits } from './digits';
import { createGlossaryMatcher } from './glossary-match';
import { getLanguage, type LanguageInfo } from './languages';
import { compareMarkup, plainText, tokenize } from './markup';
import { maskProtected } from './postprocess';

/**
 * Automated QA of one translated segment (SPEC §9.7). The same checks run inside `agent:submit`, after every API
 * response and after post-processing; their issues become review-queue flags. Messages are English and precise
 * (they are read by the agent CLI); the UI renders its own text per `code`.
 */
export type QaSeverity = 'low' | 'medium' | 'high';

export const QA_CODES = [
  'empty',
  'markup',
  'numbers',
  'target_script',
  'untranslated',
  'repetition',
  'glossary',
  'name',
  'leftover_chars',
  'latin_punctuation',
  'length',
] as const;
export type QaCode = (typeof QA_CODES)[number];

export interface QaIssue {
  code: QaCode;
  severity: QaSeverity;
  message: string;
  /** How to fix it — actionable for the agent CLI. */
  fix: string;
}

export interface QaGlossaryEntry {
  src: string;
  tgt: string;
  alternatives?: string[];
  kind?: string;
}

export interface QaContext {
  srcLang: string;
  tgtLang: string;
  glossary?: QaGlossaryEntry[];
}

const UNICODE_SCRIPT: Record<LanguageInfo['script'], string> = {
  Latn: 'Latin',
  Arab: 'Arabic',
  Cyrl: 'Cyrillic',
  Hebr: 'Hebrew',
};
const NAME_KINDS = new Set(['person', 'org', 'place', 'work']);
// Language-specific leftovers after post-processing (normalizer name → pattern, description).
const LEFTOVERS: Record<string, [RegExp, string]> = {
  fa: [/[يك]/u, 'Arabic yeh/kaf (ي ك) instead of Persian ی ک'],
};
const LATIN_PUNCTUATION: Record<string, RegExp> = {
  fa: /[,;?"]/u,
};

/** Plain text without code spans, URLs and parenthesized asides — the running prose of a segment. */
function prose(text: string): string {
  const tokens = tokenize(text).filter((t) => t.type !== 'code' && t.type !== 'url');
  return plainText(tokens).replace(/\([^()]*\)/gu, ' ');
}

/** Digit sequences that must survive translation (ordinals such as "19th" may become words). */
function requiredNumbers(src: string): string[] {
  const text = toLatinDigits(plainText(tokenize(src))).replace(/\b\d+(?:st|nd|rd|th)\b/giu, ' ');
  return text.match(/[0-9]+/gu) ?? [];
}

function multisetMissing(need: string[], have: string[]): string[] {
  const counts = new Map<string, number>();
  for (const h of have) counts.set(h, (counts.get(h) ?? 0) + 1);
  const missing: string[] = [];
  for (const n of need) {
    const c = counts.get(n) ?? 0;
    if (c > 0) counts.set(n, c - 1);
    else missing.push(n);
  }
  return missing;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\u{200C}]+/u)
    .map((w) => w.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter(Boolean);
}

/** A word or phrase repeated back-to-back (1 word ×4, 2–6 words ×3) — the classic generation loop. */
export function findRepetition(text: string): string | null {
  const w = words(text);
  for (let n = 1; n <= 6; n++) {
    const need = n === 1 ? 4 : 3;
    for (let i = 0; i + n * need <= w.length; i++) {
      const unit = w.slice(i, i + n).join(' ');
      let k = 1;
      while (i + (k + 1) * n <= w.length && w.slice(i + k * n, i + (k + 1) * n).join(' ') === unit) k++;
      if (k >= need) return unit;
    }
  }
  return null;
}

function letterCounts(text: string, script: string): { target: number; latin: number } {
  const target = (text.match(new RegExp(`\\p{Script=${script}}`, 'gu')) ?? []).filter((c) => /\p{L}/u.test(c)).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  return { target, latin };
}

export function checkTranslation(src: string, tgt: string, ctx: QaContext): QaIssue[] {
  const issues: QaIssue[] = [];
  const tgtInfo = getLanguage(ctx.tgtLang);
  const srcInfo = getLanguage(ctx.srcLang);

  if (!plainText(tokenize(tgt)).replace(/[\s*]+/gu, '')) {
    return [
      {
        code: 'empty',
        severity: 'high',
        message: 'The translation is empty.',
        fix: 'Translate the complete source text.',
      },
    ];
  }

  const markup = compareMarkup(src, tgt);
  if (markup.missing.length || markup.extra.length) {
    const parts = [
      markup.missing.length ? `missing ${markup.missing.join(', ')}` : '',
      markup.extra.length ? `unexpected ${markup.extra.join(', ')}` : '',
    ].filter(Boolean);
    issues.push({
      code: 'markup',
      severity: 'high',
      message: `Inline markup tokens differ from the source: ${parts.join('; ')}.`,
      fix: 'Copy every `code`, [^n], [[fig:…]], [[tab:…]] and URL token from the source exactly once.',
    });
  }

  const missingNumbers = multisetMissing(requiredNumbers(src), toLatinDigits(tgt).match(/[0-9]+/gu) ?? []);
  if (missingNumbers.length) {
    issues.push({
      code: 'numbers',
      severity: 'medium',
      message: `Numbers from the source are missing in the translation: ${missingNumbers.join(', ')}.`,
      fix: 'Keep every number of the source as digits (in the target language digit style).',
    });
  }

  if (tgtInfo.script !== 'Latn') {
    const script = UNICODE_SCRIPT[tgtInfo.script];
    const { target, latin } = letterCounts(prose(tgt), script);
    const srcLetters = (prose(src).match(/\p{L}/gu) ?? []).length;
    if (srcLetters >= 3 && target + latin >= 3 && target / (target + latin) < 0.5) {
      issues.push({
        code: 'target_script',
        severity: 'high',
        message: `The translation is not predominantly written in ${tgtInfo.name} (${script} script).`,
        fix: `Translate the text into ${tgtInfo.name}; keep Latin script only for names in parentheses, code and identifiers.`,
      });
    }
    const latinRun =
      /(?:\p{Script=Latin}[\p{Script=Latin}'’-]*[\s,;:]+){3,}\p{Script=Latin}[\p{Script=Latin}'’-]*/u.exec(prose(tgt));
    if (latinRun && !issues.some((i) => i.code === 'target_script')) {
      issues.push({
        code: 'untranslated',
        severity: 'medium',
        message: `Untranslated ${srcInfo.name} text remains: "${latinRun[0].trim()}".`,
        fix: 'Translate it, or keep only the original term/title in parentheses after its translation.',
      });
    }
  }

  const repeated = findRepetition(plainText(tokenize(tgt)));
  if (repeated && !findRepetition(plainText(tokenize(src)))) {
    issues.push({
      code: 'repetition',
      severity: 'high',
      message: `The translation repeats "${repeated}" back to back.`,
      fix: 'Remove the repeated words so the text matches the source.',
    });
  }

  if (ctx.glossary?.length) issues.push(...glossaryIssues(src, tgt, ctx));

  const leftover = tgtInfo.normalizer ? LEFTOVERS[tgtInfo.normalizer] : undefined;
  if (leftover?.[0].test(tgt)) {
    issues.push({
      code: 'leftover_chars',
      severity: 'low',
      message: `The text contains ${leftover[1]}.`,
      fix: 'Use the letters of the target language (post-processing normally fixes this).',
    });
  }
  const punct = tgtInfo.normalizer ? LATIN_PUNCTUATION[tgtInfo.normalizer] : undefined;
  if (punct) {
    const hit = punct.exec(maskProtected(tgt));
    if (hit) {
      issues.push({
        code: 'latin_punctuation',
        severity: 'low',
        message: `Latin punctuation "${hit[0]}" inside ${tgtInfo.name} text.`,
        fix: `Use ${tgtInfo.name} punctuation (for example ، ؛ ؟ « »).`,
      });
    }
  }
  return issues;
}

function glossaryIssues(src: string, tgt: string, ctx: QaContext): QaIssue[] {
  const entries = (ctx.glossary ?? []).filter((e) => e.src.trim() && e.tgt.trim());
  const srcHits = new Set(
    createGlossaryMatcher(
      entries.map((e, i) => ({ id: String(i), text: e.src })),
      ctx.srcLang,
    )
      .find(plainText(tokenize(src)))
      .map((m) => Number(m.termId)),
  );
  if (srcHits.size === 0) return [];
  const tgtText = plainText(tokenize(tgt));
  const issues: QaIssue[] = [];
  for (const i of srcHits) {
    const e = entries[i];
    if (!e) continue;
    const approved = createGlossaryMatcher([{ id: 'tgt', text: e.tgt }], ctx.tgtLang).find(tgtText);
    if (approved.length > 0) continue;
    const alternatives = (e.alternatives ?? []).filter((a) => a.trim());
    const used = alternatives.find(
      (a) => createGlossaryMatcher([{ id: 'alt', text: a }], ctx.tgtLang).find(tgtText).length > 0,
    );
    const isName = NAME_KINDS.has(e.kind ?? '');
    issues.push({
      code: isName ? 'name' : 'glossary',
      severity: 'medium',
      message: used
        ? `"${e.src}" is rendered as "${used}" instead of the approved "${e.tgt}".`
        : `"${e.src}" appears in the source but its approved equivalent "${e.tgt}" is missing.`,
      fix: `Use "${e.tgt}" (inflect it as the grammar requires).`,
    });
  }
  return issues;
}

export interface LengthPair {
  key: string;
  src: string;
  tgt: string;
}

/**
 * Length-ratio outliers across a book or batch (robust z-score of log(len tgt / len src) against the median, via
 * the median absolute deviation). Short segments are ignored; returns the keys of outliers.
 */
export function lengthOutliers(pairs: LengthPair[], threshold = 3.5, minChars = 40): string[] {
  const ratios = pairs
    .map((p) => ({ key: p.key, s: plainText(tokenize(p.src)).length, t: plainText(tokenize(p.tgt)).length }))
    .filter((r) => r.s >= minChars && r.t > 0)
    .map((r) => ({ key: r.key, x: Math.log(r.t / r.s) }));
  if (ratios.length < 5) return [];
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
  };
  const med = median(ratios.map((r) => r.x));
  const mad = median(ratios.map((r) => Math.abs(r.x - med))) || 0.05;
  return ratios.filter((r) => Math.abs((0.6745 * (r.x - med)) / mad) > threshold).map((r) => r.key);
}

/** Length ratio sanity band for a single segment when no book statistics exist yet. */
export function lengthRatioSuspicious(src: string, tgt: string, minChars = 60): boolean {
  const s = plainText(tokenize(src)).length;
  const t = plainText(tokenize(tgt)).length;
  if (s < minChars) return false;
  const r = t / s;
  return r < 0.4 || r > 2.5;
}
