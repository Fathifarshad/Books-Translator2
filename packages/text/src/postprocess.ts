import { getLanguage } from './languages';

/**
 * Deterministic post-processing of translations (SPEC §9.5) — no AI, runs after translate and after edit.
 * Never touches code spans, URLs, markup tokens or Latin-script runs: those are masked before any rule runs.
 * Language-specific rules are looked up through the registry (`LanguageInfo.normalizer`); languages without a
 * normalizer only get whitespace cleanup.
 */
export type EzafeStyle = 'yeh' | 'hamza';

export interface PostprocessOptions {
  /** Ezafe after silent «ه»: «ه‌ی» (default) or «هٔ». */
  ezafe?: EzafeStyle;
  /** Segment type (`heading`, `caption`, `code`, …). Headings keep dotted section numbers; code is never changed. */
  segmentType?: string;
  /** Digits in running text: the language's own digits (default) or Latin digits. */
  digits?: 'native' | 'latin';
}

type Options = Required<PostprocessOptions>;
type Normalizer = (masked: string, o: Options) => string;

const ZWNJ = '\u{200C}';
// Masked spans become private-use characters: word-like spans (Latin runs, code, URLs, figure refs) in
// U+E000…U+EFFF, footnote references (attached to the preceding word) in U+F000…U+F8FF.
const WORD_PUA = 0xe000;
const ATTACHED_PUA = 0xf000;
const PUA_SIZE = 0x1000;
const NORMALIZERS: Record<string, Normalizer> = { fa: normalizeFa };

export function postprocess(text: string, lang: string, options: PostprocessOptions = {}): string {
  const o: Options = { ezafe: 'yeh', segmentType: 'paragraph', digits: 'native', ...options };
  if (o.segmentType === 'code') return text;
  const name = getLanguage(lang).normalizer;
  const normalizer = name ? NORMALIZERS[name] : undefined;
  const { masked, spans } = mask(cleanWhitespace(text));
  return unmask(normalizer ? normalizer(masked, o) : masked, spans);
}

/** Collapses horizontal whitespace and trims every line (newlines only survive in multi-line segments). */
function cleanWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u{00A0}\u{2000}-\u{200A}\u{202F}\u{3000}]+/gu, ' ').trim())
    .join('\n')
    .trim();
}

// ── Masking ──────────────────────────────────────────────────────────────────────────────────────────────

const LATIN_WORD = String.raw`[\p{Script=Latin}0-9]*\p{Script=Latin}[\p{Script=Latin}0-9]*(?:['’.\-][\p{Script=Latin}0-9]+)*`;
const LATIN_RUN = String.raw`${LATIN_WORD}(?:[ ,.:/&+\-]+(?:${LATIN_WORD}|[0-9]+(?:[.,][0-9]+)*))*[+#]*`;
const PROTECTED = new RegExp(
  [
    '`[^`\\n]+`', // inline code
    String.raw`\[\^[A-Za-z0-9_-]+\]`, // footnote reference
    String.raw`\[\[(?:fig|tab):[^\]\s]+\]\]`, // figure/table reference
    String.raw`https?:\/\/[^\s<>«»"]+`, // URL
    LATIN_RUN,
  ].join('|'),
  'gu',
);
const URL_TRAILING = /[.,;:!?)»”’؟،؛]+$/u;

interface Masked {
  masked: string;
  spans: Map<string, string>;
}

function mask(text: string): Masked {
  const spans = new Map<string, string>();
  let words = 0;
  let attached = 0;
  const masked = text.replace(PROTECTED, (m) => {
    let keep = m;
    let rest = '';
    if (/^https?:/u.test(m)) {
      const trailing = URL_TRAILING.exec(m);
      if (trailing) {
        keep = m.slice(0, trailing.index);
        rest = trailing[0];
      }
    }
    const isAttached = keep.startsWith('[^');
    const n = isAttached ? attached++ : words++;
    if (n >= PUA_SIZE) return m;
    const ch = String.fromCodePoint((isAttached ? ATTACHED_PUA : WORD_PUA) + n);
    spans.set(ch, keep);
    return ch + rest;
  });
  return { masked, spans };
}

function unmask(text: string, spans: Map<string, string>): string {
  return text.replace(/[\u{E000}-\u{F8FF}]/gu, (ch) => spans.get(ch) ?? ch);
}

// ── Persian (fa) ─────────────────────────────────────────────────────────────────────────────────────────

/** A letter of the running text: any letter/mark or a masked word-like span. */
const WORD_CHAR = String.raw`[\p{L}\p{M}\u{E000}-\u{EFFF}]`;
const FA_LETTER = String.raw`[\u{0621}-\u{063A}\u{0641}-\u{064A}\u{067E}\u{0686}\u{0698}\u{06A9}\u{06AF}\u{06CC}\u{06C0}]`;
const NOT_LETTER_AFTER = String.raw`(?![\p{L}\p{M}])`;
const NOT_LETTER_BEFORE = String.raw`(?<![\p{L}\p{M}${ZWNJ}])`;

// Verbal prefix «می/نمی» written without a joiner: only these stems are rewritten, so words such as «میدان»,
// «میز» or «میان» are never touched. Present stems need a person ending; past stems may stand alone.
const PRESENT_STEMS = [
  'شو',
  'کن',
  'توان',
  'ده',
  'گیر',
  'رو',
  'آی',
  'بین',
  'دان',
  'گوی',
  'گو',
  'خواه',
  'ساز',
  'مان',
  'یاب',
  'رس',
  'گرد',
  'دار',
  'نویس',
  'خوان',
  'پرداز',
  'کوش',
  'بخش',
  'آموز',
  'شناس',
  'سنج',
  'گذار',
  'گذر',
  'پذیر',
  'افت',
  'آور',
  'بر',
  'زن',
  'کش',
  'نگر',
];
const PRESENT_ENDINGS = ['م', 'ی', 'د', 'یم', 'ید', 'ند'];
const PAST_STEMS = [
  'شد',
  'کرد',
  'توانست',
  'داد',
  'گرفت',
  'رفت',
  'آمد',
  'دید',
  'دانست',
  'گفت',
  'خواست',
  'ساخت',
  'یافت',
  'رسید',
  'داشت',
  'نوشت',
  'خواند',
  'پرداخت',
  'کوشید',
  'آموخت',
  'شناخت',
  'آورد',
  'برد',
  'زد',
  'کشید',
  'نگریست',
];
const PAST_ENDINGS = ['', 'م', 'ی', 'یم', 'ید', 'ند'];
// Present forms that are also common nouns (e.g. «میدانی» = «a square»).
const AMBIGUOUS_JOINED = new Set(['میدانی']);

const JOINED_VERB = new RegExp(
  `${NOT_LETTER_BEFORE}(ن?می)((?:${PRESENT_STEMS.join('|')})(?:${PRESENT_ENDINGS.join('|')})|(?:${PAST_STEMS.join('|')})(?:${PAST_ENDINGS.filter(Boolean).join('|')})?)${NOT_LETTER_AFTER}`,
  'gu',
);
const SPACED_VERB_PREFIX = new RegExp(`(?<!ماه )${NOT_LETTER_BEFORE}(ن?می) +(?=${FA_LETTER})`, 'gu');
const PLURAL_SUFFIXES = ['هایشان', 'هایتان', 'هایمان', 'هایش', 'هایت', 'هایم', 'هایی', 'های', 'ها'];
const SPACED_PLURAL = new RegExp(`(${FA_LETTER}) +(${PLURAL_SUFFIXES.join('|')})${NOT_LETTER_AFTER}`, 'gu');
const SPACED_SUPERLATIVE = new RegExp(`(${FA_LETTER}) +(ترین)${NOT_LETTER_AFTER}`, 'gu');
// «تر» alone is also an adjective («wet»), so only the comparative construction «… تر از» is joined.
const SPACED_COMPARATIVE = new RegExp(`(${FA_LETTER}) +(تر)(?= از${NOT_LETTER_AFTER})`, 'gu');
const JOINED_PRONOUN_PLURALS: [RegExp, string][] = [
  [new RegExp(`${NOT_LETTER_BEFORE}آنها${NOT_LETTER_AFTER}`, 'gu'), `آن${ZWNJ}ها`],
  [new RegExp(`${NOT_LETTER_BEFORE}اینها${NOT_LETTER_AFTER}`, 'gu'), `این${ZWNJ}ها`],
];

const FIGURE_LABELS = ['شکل', 'جدول', 'فصل', 'بخش', 'بند', 'نمودار', 'تصویر', 'معادله', 'پیوست', 'صفحه', 'قسمت'];

function normalizeFa(input: string, o: Options): string {
  let s = input;

  // 1. Characters: presentation forms, Arabic yeh/kaf, tatweel, Arabic heh, heh with yeh above.
  s = s.replace(/[\u{FB50}-\u{FDFF}\u{FE70}-\u{FEFF}]/gu, (ch) => ch.normalize('NFKC'));
  s = s
    .replace(/[يى]/gu, 'ی')
    .replace(/ك/gu, 'ک')
    .replace(/\u{06D5}/gu, 'ه')
    .replace(/\u{0640}/gu, '');
  s = s.replace(/\u{06C0}/gu, 'ه\u{0654}');

  // 2. ZWNJ hygiene: never next to a space or punctuation, never doubled, never at the edges of the text.
  s = s.replace(/\u{200C}{2,}/gu, ZWNJ);
  s = s.replace(/ *\u{200C}+ */gu, (m) => (m.includes(' ') ? ' ' : m));
  s = s.replace(/\u{200C}+(?=[\p{P}\p{S}\n]|$)/gu, '').replace(/(^|[\p{P}\p{S}\n])\u{200C}+/gu, '$1');

  // 3. ZWNJ joins (safe rules only).
  s = s.replace(JOINED_VERB, (m, prefix: string, verb: string) =>
    AMBIGUOUS_JOINED.has(m) ? m : `${prefix}${ZWNJ}${verb}`,
  );
  s = s.replace(SPACED_VERB_PREFIX, `$1${ZWNJ}`);
  s = s.replace(SPACED_PLURAL, `$1${ZWNJ}$2`);
  s = s.replace(SPACED_SUPERLATIVE, `$1${ZWNJ}$2`);
  s = s.replace(SPACED_COMPARATIVE, `$1${ZWNJ}$2`);
  for (const [re, to] of JOINED_PRONOUN_PLURALS) s = s.replace(re, to);

  // 4. Ezafe after silent «ه».
  const yeh = `ه${ZWNJ}ی`;
  const hamza = 'ه\u{0654}';
  if (o.ezafe === 'yeh') {
    s = s.replace(/ه\u{0654}/gu, yeh);
    s = s.replace(new RegExp(`ه +ی${NOT_LETTER_AFTER}`, 'gu'), yeh);
  } else {
    s = s.replace(new RegExp(`ه(?:\u{200C}| +)ی${NOT_LETTER_AFTER}`, 'gu'), hamza);
  }

  // 5. Digits: work on ASCII digits, set grouping and decimal separators (they contain «,» and «.»), then
  //    render the digit shapes of the language.
  s = s.replace(/[۰-۹٠-٩]/gu, toAsciiDigit);
  if (o.digits === 'latin') s = s.replace(/٬/gu, ',').replace(/٫/gu, '.');
  else s = localDigits(s, o);
  return punctuateFa(s);
}

function localDigits(input: string, o: Options): string {
  let s = input;
  s = s.replace(
    /(?<![\d.,٫٬])(\d{1,3})((?:,\d{3})+)(?![\d]|[.,]\d)/gu,
    (_m, head: string, rest: string) => `${head}${rest.replaceAll(',', '٬')}`,
  );
  const labelled = new RegExp(`(?:${FIGURE_LABELS.join('|')})[ ${ZWNJ}]*$`, 'u');
  s = s.replace(/(?<![\d.])(\d+)\.(\d+)(?![.\d])/gu, (m, a: string, b: string, offset: number, whole: string) => {
    if (o.segmentType === 'heading' || o.segmentType === 'caption') return m;
    if (labelled.test(whole.slice(Math.max(0, offset - 12), offset))) return m;
    return `${a}٫${b}`;
  });
  s = s.replace(/(\d)\s?%/gu, '$1٪');
  return s.replace(/[0-9]/gu, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
}

function punctuateFa(input: string): string {
  let s = input;
  // 6. Punctuation marks of the Persian run.
  // A comma between Latin digits is a grouping separator (digits: 'latin'), not punctuation.
  s = s.replace(/,/gu, (m, at: number, str: string) =>
    /\d/u.test(str[at - 1] ?? '') && /\d/u.test(str[at + 1] ?? '') ? m : '،',
  );
  s = s.replace(/;/gu, '؛').replace(/\?/gu, '؟');
  s = pairStraightQuotes(s);

  // 7. Spacing around punctuation.
  s = s.replace(/ +(?=[،؛؟!.:»)\]])/gu, '');
  s = s.replace(/([«([]) +/gu, '$1');
  s = s.replace(new RegExp(`([،؛؟!])(?=${WORD_CHAR}|[«(*])`, 'gu'), '$1 ');
  s = s.replace(new RegExp(`([.:])(?=${FA_LETTER})`, 'gu'), '$1 ');
  s = s.replace(new RegExp(`([»)])(?=${WORD_CHAR})`, 'gu'), '$1 ');
  s = s.replace(new RegExp(`(${WORD_CHAR})(?=[«(])`, 'gu'), '$1 ');
  return s.replace(/ {2,}/gu, ' ');
}

function toAsciiDigit(d: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹'.indexOf(d);
  if (persian >= 0) return String(persian);
  const arabic = '٠١٢٣٤٥٦٧٨٩'.indexOf(d);
  return arabic >= 0 ? String(arabic) : d;
}

/** Straight double quotes → «…» when they pair up; an odd count is left for QA to flag. */
function pairStraightQuotes(s: string): string {
  const count = (s.match(/"/gu) ?? []).length;
  if (count === 0 || count % 2 !== 0) return s;
  let open = true;
  return s.replace(/"/gu, () => {
    const q = open ? '«' : '»';
    open = !open;
    return q;
  });
}

/** Exposed for QA: the text with protected spans (code, URLs, markup tokens, Latin runs) replaced by placeholders. */
export function maskProtected(text: string): string {
  return mask(text).masked;
}
