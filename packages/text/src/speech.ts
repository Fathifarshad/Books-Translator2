import { getLanguage, isKnownLanguage } from './languages';
import { stripMarkup } from './markup';

/**
 * Turning written text into text a voice can read (SPEC §14, ADR-042).
 *
 * A translation is written to be *read*, and a speech engine reads it literally: «۳۵٪» comes out as digits one
 * by one, «بی‌هوشی (Anesthesia)» has an English word shouted into the middle of a Persian sentence, and a
 * footnote marker becomes a number nobody asked for. None of that is the engine's fault — the text was never
 * meant for it.
 *
 * What is certain is done here, by rule; what needs judgement (which vowel a written-without-vowels word takes)
 * is a separate editorial pass by the model, because no rule can decide it.
 */
export interface SpeechOptions {
  /** Read the original terms that sit in parentheses instead of skipping them (off by default). */
  keepForeignTerms?: boolean;
  /** Write numbers as words («۳۵» → «سی و پنج»). On where the language has the words. */
  spellNumbers?: boolean;
}

const DEFAULTS: Required<SpeechOptions> = { keepForeignTerms: false, spellNumbers: true };

/** Spoken forms of a language: the words for numbers, and the units it says in full. */
interface SpeechRules {
  numberToWords(value: number): string;
  /** Joins the whole and the fraction of a decimal («۰٫۵» → «صفر ممیز پنج»). */
  decimalWord: string;
  percentWord: string;
  rangeWord: string;
  /** Written forms a voice should say in full, longest first so «mmHg» wins over «mm». */
  units: [written: RegExp, spoken: string][];
}

const FA_ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const FA_TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const FA_TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const FA_HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const FA_SCALES: [number, string][] = [
  [1_000_000_000, 'میلیارد'],
  [1_000_000, 'میلیون'],
  [1_000, 'هزار'],
];

function faBelowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(FA_HUNDREDS[hundreds] as string);
  if (rest >= 10 && rest < 20) parts.push(FA_TEENS[rest - 10] as string);
  else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) parts.push(FA_TENS[tens] as string);
    if (ones) parts.push(FA_ONES[ones] as string);
  }
  return parts.join(' و ');
}

function faNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value < 0) return `منفی ${faNumber(-value)}`;
  const n = Math.floor(value);
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  let rest = n;
  for (const [size, word] of FA_SCALES) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      // «هزار», not «یک هزار»; every larger scale keeps its count.
      parts.push(count === 1 && size === 1_000 ? word : `${faBelowThousand(count)} ${word}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(faBelowThousand(rest));
  return parts.join(' و ');
}

const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_TEENS = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES: [number, string][] = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand'],
];

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(`${EN_ONES[hundreds]} hundred`);
  if (rest >= 10 && rest < 20) parts.push(EN_TEENS[rest - 10] as string);
  else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens && ones) parts.push(`${EN_TENS[tens]}-${EN_ONES[ones]}`);
    else if (tens) parts.push(EN_TENS[tens] as string);
    else if (ones) parts.push(EN_ONES[ones] as string);
  }
  return parts.join(' and ');
}

function enNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value < 0) return `minus ${enNumber(-value)}`;
  const n = Math.floor(value);
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let rest = n;
  for (const [size, word] of EN_SCALES) {
    const count = Math.floor(rest / size);
    if (count > 0) {
      parts.push(`${enBelowThousand(count)} ${word}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(enBelowThousand(rest));
  return parts.join(' ');
}

/** Units a medical or technical book writes short and a voice should say in full. */
const SHARED_UNITS: [RegExp, string][] = [
  [/\bmm\s?Hg\b/giu, '@mmHg'],
  [/\bmg\s?\/\s?dL\b/giu, '@mgdl'],
  [/\bmL\b/gu, '@ml'],
  [/\bmg\b/giu, '@mg'],
  [/\bkg\b/giu, '@kg'],
  [/\bcm\b/giu, '@cm'],
  [/\bmm\b/giu, '@mm'],
  [/°\s?C\b/giu, '@celsius'],
];

const spoken = (map: Record<string, string>): [RegExp, string][] =>
  SHARED_UNITS.map(([re, token]) => [re, map[token.slice(1)] ?? token.slice(1)] as [RegExp, string]);

const RULES: Record<string, SpeechRules> = {
  fa: {
    numberToWords: faNumber,
    decimalWord: 'ممیز',
    percentWord: 'درصد',
    rangeWord: 'تا',
    units: spoken({
      mmHg: 'میلی‌متر جیوه',
      mgdl: 'میلی‌گرم بر دسی‌لیتر',
      ml: 'میلی‌لیتر',
      mg: 'میلی‌گرم',
      kg: 'کیلوگرم',
      cm: 'سانتی‌متر',
      mm: 'میلی‌متر',
      celsius: 'درجه‌ی سانتی‌گراد',
    }),
  },
  en: {
    numberToWords: enNumber,
    decimalWord: 'point',
    percentWord: 'percent',
    rangeWord: 'to',
    units: spoken({
      mmHg: 'millimetres of mercury',
      mgdl: 'milligrams per decilitre',
      ml: 'millilitres',
      mg: 'milligrams',
      kg: 'kilograms',
      cm: 'centimetres',
      mm: 'millimetres',
      celsius: 'degrees Celsius',
    }),
  },
};

/**
 * The spoken forms of a language — only for a language the registry actually knows. An unknown code falls back
 * to English everywhere else, but English number words read into another language would be worse than leaving
 * the digits as they are.
 */
function rulesFor(lang: string): SpeechRules | undefined {
  if (!isKnownLanguage(lang)) return undefined;
  const name = getLanguage(lang).speech;
  return name ? RULES[name] : undefined;
}

/** A number as words in a language that has them; null when the registry has no spoken forms for it. */
export function numberToWords(value: number, lang: string): string | null {
  const rules = rulesFor(lang);
  return rules ? rules.numberToWords(value) : null;
}

const LATIN = /\p{Script=Latin}/u;

/** Latin digits of a string written in any numbering system, or null when it is not a plain number. */
function parseNumber(text: string): number | null {
  const latin = text
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,٬٬]/gu, '')
    .replace(/[٫٫]/gu, '.');
  if (!/^\d+(?:\.\d+)?$/u.test(latin)) return null;
  const value = Number(latin);
  return Number.isFinite(value) ? value : null;
}

/** Whether a run of text is written in the language's own script (so a voice can read it). */
function isOwnScript(text: string, lang: string): boolean {
  const info = getLanguage(lang);
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return true;
  const own = letters.filter((c) => (info.script === 'Latn' ? LATIN.test(c) : !LATIN.test(c))).length;
  return own / letters.length >= 0.5;
}

/**
 * Parentheses that hold the original term — «بی‌هوشی (Anesthesia)» — are there for a reader's eye. Spoken, they
 * break the sentence in half, so they are left out unless asked for.
 */
export function dropForeignParentheticals(text: string, lang: string): string {
  return text
    .replace(/\s*[([]([^()[\]]{1,80})[)\]]/gu, (whole, inner: string) => (isOwnScript(inner, lang) ? whole : ''))
    .replace(/\s{2,}/gu, ' ');
}

/** Numbers, percentages and ranges as words, in the numbering system the text actually uses. */
export function spellNumbers(text: string, lang: string): string {
  const rules = rulesFor(lang);
  if (!rules) return text;
  const say = (value: number): string => {
    const whole = Math.floor(value);
    const head = rules.numberToWords(whole);
    if (Number.isInteger(value)) return head;
    const fraction = String(value).split('.')[1] ?? '';
    return `${head} ${rules.decimalWord} ${rules.numberToWords(Number(fraction))}`;
  };
  const NUMBER = /[\d٠-٩۰-۹][\d٠-٩۰-۹,٬٬.٫٫]*/gu;
  return (
    text
      // «۳۵–۴۵» and «۳۵ تا ۴۵» read as one range, not two loose numbers.
      .replace(/([\d٠-٩۰-۹]+)\s*[–—-]\s*([\d٠-٩۰-۹]+)/gu, (whole, a: string, b: string) => {
        const from = parseNumber(a);
        const to = parseNumber(b);
        return from !== null && to !== null ? `${say(from)} ${rules.rangeWord} ${say(to)}` : whole;
      })
      .replace(NUMBER, (match) => {
        const value = parseNumber(match);
        return value === null ? match : say(value);
      })
      .replace(/\s*[٪%]/gu, ` ${rules.percentWord}`)
  );
}

/** Short written units said in full. */
export function spellUnits(text: string, lang: string): string {
  const rules = rulesFor(lang);
  if (!rules) return text;
  let out = text;
  for (const [written, word] of rules.units) out = out.replace(written, ` ${word}`);
  return out.replace(/\s{2,}/gu, ' ');
}

/** Everything a voice can be given without judgement: the text as it should be said. */
export function speechText(raw: string, lang: string, options: SpeechOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  let text = stripMarkup(raw);
  if (!opts.keepForeignTerms) text = dropForeignParentheticals(text, lang);
  text = spellUnits(text, lang);
  if (opts.spellNumbers) text = spellNumbers(text, lang);
  return text
    .replace(/[«»"“”]/gu, '')
    .replace(/\s*\n\s*/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
}

const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' } as const;
const escapeXml = (t: string) => t.replace(/[&<>"']/gu, (c) => XML[c as keyof typeof XML]);

export interface SsmlOptions extends SpeechOptions {
  /** Silence after a line, in milliseconds: what turns a wall of text into paragraphs. */
  pauseMs?: number;
  /** Tag for runs in the other script, so the voice switches language instead of spelling them out. */
  foreignLang?: string;
}

/**
 * The same text as SSML: a pause between lines, and runs in the other script marked so the voice switches to it
 * rather than reading English letter by letter. Azure and Google take SSML; Piper and OpenAI take plain text.
 */
export function speechSsml(raw: string, lang: string, options: SsmlOptions = {}): string {
  return toSsml(speechText(raw, lang, options), lang, options);
}

/**
 * Wraps text that is **already prepared** — the engines call this per request, so the preparation is not redone
 * for every piece a long chapter is split into.
 */
export function toSsml(text: string, lang: string, options: SsmlOptions = {}): string {
  const pause = options.pauseMs ?? 500;
  const info = getLanguage(lang);
  const other = options.foreignLang;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const body = lines
    .map((line) => {
      const escaped = escapeXml(line);
      if (!other || info.script === 'Latn') return escaped;
      // A run of Latin words inside Arabic-script text: say it in the other language.
      return escaped.replace(
        /[\p{Script=Latin}][\p{Script=Latin}\d'’.\- ]{2,}[\p{Script=Latin}\d]/gu,
        (run) => `<lang xml:lang="${escapeXml(other)}">${run}</lang>`,
      );
    })
    .join(`<break time="${pause}ms"/>`);
  return `<p>${body}</p>`;
}

/** Numbers and digits the registry knows for a language — used by the tests and by the speech prompt. */
export const SPEECH_LANGUAGES = Object.keys(RULES);
