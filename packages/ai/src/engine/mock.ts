import type {
  AgentBatch,
  AgentTask,
  BriefInput,
  CoverBlurbTaskInput,
  CoverBlurbTaskResult,
  CoverDesignTaskInput,
  CoverDesignTaskResult,
  EditInput,
  GlossaryEntry,
  GlossaryInput,
  SpeechInput,
  SpeechResult,
  TaskResult,
  TranslateInput,
} from '@dozabaneh/shared';
import { createGlossaryMatcher, type MarkupToken, serializeMarkup, tokenize } from '@dozabaneh/text';
import { mockStrings } from '../mock/strings';

/**
 * Deterministic mock outputs for every pipeline task (SPEC §10.6). Translations are pseudo-text: each source word
 * maps to a fixed target-language word, glossary terms use their equivalents, and markup tokens and numbers are kept,
 * so mock results pass the same validation as real ones and exercise the whole pipeline and UI.
 */
const PSEUDO_WORDS: Record<string, readonly string[]> = {
  fa: [
    'دانش',
    'راه',
    'نیرو',
    'ساختار',
    'اندیشه',
    'گام',
    'مسئله',
    'پاسخ',
    'ابزار',
    'روش',
    'نمونه',
    'جهان',
    'زمان',
    'معنا',
    'نظم',
    'الگو',
    'داده',
    'پیوند',
    'سنجش',
    'چرخه',
    'ریشه',
    'نشانه',
    'جریان',
    'قاعده',
    'آزمون',
    'رویداد',
    'تجربه',
    'فرایند',
    'هدف',
    'دستور',
    'نقشه',
    'پایه',
    'سامانه',
    'گزینه',
    'نتیجه',
    'پرسش',
    'مرحله',
    'کار',
    'شیوه',
    'بنیاد',
  ],
};

/** FNV-1a 32-bit — stable across platforms and runs. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pseudoWords(text: string, vocab: readonly string[]): string {
  // Neighbouring words never map to the same pseudo word, so the output never looks like a repetition loop.
  let previous = '';
  return text.replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (w) => {
    let i = stableHash(w.toLowerCase()) % vocab.length;
    if (vocab[i] === previous) i = (i + 1) % vocab.length;
    previous = vocab[i] as string;
    return previous;
  });
}

/** Pseudo-translation of one segment: glossary equivalents + a fixed word mapping; markup tokens stay intact. */
export function pseudoTranslate(
  src: string,
  sourceLang: string,
  targetLang: string,
  glossary: GlossaryEntry[] = [],
): string {
  const vocab = PSEUDO_WORDS[targetLang];
  if (!vocab) return `[${targetLang}] ${src}`;
  const matcher = createGlossaryMatcher(
    glossary.map((g, i) => ({ id: String(i), text: g.src })),
    sourceLang,
  );
  const mapText = (text: string): string => {
    let out = '';
    let at = 0;
    for (const m of matcher.find(text)) {
      out += pseudoWords(text.slice(at, m.start), vocab);
      out += glossary[Number(m.termId)]?.tgt ?? '';
      at = m.end;
    }
    return out + pseudoWords(text.slice(at), vocab);
  };
  const walk = (tokens: MarkupToken[]): MarkupToken[] =>
    tokens.map((t) => {
      if (t.type === 'text') return { type: 'text', text: mapText(t.text) };
      if (t.type === 'em' || t.type === 'strong') return { ...t, children: walk(t.children) };
      return t;
    });
  return serializeMarkup(walk(tokenize(src)));
}

function mockTranslate(batch: AgentBatch<TranslateInput>): TaskResult<'translate'> {
  const { input } = batch;
  return {
    items: input.items.map((item) => ({
      key: item.key,
      tgt: pseudoTranslate(item.src, batch.sourceLanguage, batch.targetLanguage, input.glossary),
    })),
  };
}

function mockEdit(batch: AgentBatch<EditInput>): TaskResult<'edit'> {
  const strings = mockStrings(batch.targetLanguage);
  return {
    items: batch.input.items.map((item) => {
      // A deterministic sample of items is flagged so the review queue has something to show.
      const flagged = stableHash(`${item.key}:${item.src}`) % 9 === 0;
      return {
        key: item.key,
        tgt: item.draft,
        changes: [],
        confidence: flagged ? 0.62 : 0.94,
        flag: flagged ? { severity: 'low' as const, reason: strings.mockNote } : null,
      };
    }),
  };
}

function mockGlossary(batch: AgentBatch<GlossaryInput>): TaskResult<'glossary'> {
  const vocab = PSEUDO_WORDS[batch.targetLanguage];
  return {
    items: batch.input.candidates.map((c) => {
      const keep = c.freq >= 2;
      if (!keep) return { key: c.key, keep: false };
      const acronym = /^[A-Z0-9]{2,}$/u.test(c.src);
      const tgt = acronym ? c.src : vocab ? pseudoWords(c.src, vocab) : `[${batch.targetLanguage}] ${c.src}`;
      return {
        key: c.key,
        keep: true,
        kind: acronym ? ('acronym' as const) : /^\p{Lu}/u.test(c.src) ? ('concept' as const) : ('term' as const),
        tgt,
        alternatives: [],
        definition: mockStrings(batch.targetLanguage).mockNote,
        parenthetical: 'first_in_chapter' as const,
        confidence: 0.8,
      };
    }),
  };
}

function mockBrief(batch: AgentBatch<BriefInput>): TaskResult<'brief'> {
  const vocab = PSEUDO_WORDS[batch.targetLanguage];
  const strings = mockStrings(batch.targetLanguage);
  const title = vocab ? pseudoWords(batch.book.title, vocab) : `[${batch.targetLanguage}] ${batch.book.title}`;
  const sentence = `${strings.mockNote} `;
  return {
    titleTranslated: title,
    titleAlternatives: [],
    domain: 'mock',
    audience: 'mock',
    level: 'popular',
    voice: 'mock',
    recurringConcepts: [],
    specialHandling: '',
    brief: sentence.repeat(6).trim(),
  };
}

/** The mock result of a batch, for every task the pipeline runs. */
/** The mock speech pass hands every line back as it was: nothing a rule could not already settle. */
function mockSpeech(batch: AgentBatch<SpeechInput>): SpeechResult {
  return { items: batch.input.items.map((i) => ({ key: i.key, tgt: i.src })) };
}

/**
 * The mock art director: as many concepts as asked, cycling through the offered layouts, faces and four fixed
 * palettes; a picture only when one can be drawn.
 */
const MOCK_PALETTES = [
  { ground: '#16264a', ground2: '#0b1530', ink: '#f6f1e3', accent: '#c9a54a' },
  { ground: '#0d4a45', ground2: '#062b28', ink: '#f3efe2', accent: '#d2b25c' },
  { ground: '#f3ecdc', ground2: '#e2d6bb', ink: '#1d2740', accent: '#9b2c2c' },
  { ground: '#5a1628', ground2: '#310a15', ink: '#f7efe4', accent: '#d4a95a' },
];
function mockCoverDesign(batch: AgentBatch<CoverDesignTaskInput>): CoverDesignTaskResult {
  const { count, layouts, fonts, canPaint, title } = batch.input;
  return {
    concepts: Array.from({ length: count }, (_, i) => {
      const font = fonts[i % fonts.length]?.id ?? 'vazirmatn';
      const image = canPaint && i % 2 === 0;
      return {
        name: `${mockStrings(batch.targetLanguage).conceptName} ${i + 1}`,
        rationale: mockStrings(batch.targetLanguage).conceptWhy,
        layout: layouts[i % layouts.length]?.id ?? 'classic',
        palette: MOCK_PALETTES[i % MOCK_PALETTES.length] as CoverDesignTaskResult['concepts'][number]['palette'],
        ground: image ? 'image' : 'gradient',
        pattern: image ? 'none' : 'stars',
        frame: i % 2 ? 'corners' : 'double',
        titleFont: font,
        bodyFont: fonts[0]?.id ?? font,
        titleWeight: 800,
        titleScale: 1,
        imagePrompt: image ? `Quiet abstract artwork evoking the book "${title}", soft light, no text` : '',
      };
    }),
  };
}

function mockCoverBlurb(batch: AgentBatch<CoverBlurbTaskInput>): CoverBlurbTaskResult {
  const { title, subject, maxChars } = batch.input;
  const body = `${title}

${subject || title}`.slice(0, Math.max(40, maxChars));
  return { blurb: body.length >= 20 ? body : `${body}${' …'.repeat(10)}`, tagline: title.slice(0, 60) };
}

export function mockOutput<T extends AgentTask>(batch: AgentBatch): TaskResult<T> {
  switch (batch.task) {
    case 'translate':
      return mockTranslate(batch as AgentBatch<TranslateInput>) as TaskResult<T>;
    case 'edit':
      return mockEdit(batch as AgentBatch<EditInput>) as TaskResult<T>;
    case 'glossary':
      return mockGlossary(batch as AgentBatch<GlossaryInput>) as TaskResult<T>;
    case 'brief':
      return mockBrief(batch as AgentBatch<BriefInput>) as TaskResult<T>;
    case 'speech':
      return mockSpeech(batch as AgentBatch<SpeechInput>) as TaskResult<T>;
    case 'cover_design':
      return mockCoverDesign(batch as AgentBatch<CoverDesignTaskInput>) as TaskResult<T>;
    case 'cover_blurb':
      return mockCoverBlurb(batch as AgentBatch<CoverBlurbTaskInput>) as TaskResult<T>;
    default:
      throw new Error(`The mock engine does not run "${batch.task}" batches in the pipeline.`);
  }
}
