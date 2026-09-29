import type {
  AgentBatch,
  AgentTask,
  BriefInput,
  EditInput,
  GlossaryEntry,
  GlossaryInput,
  TaskInput,
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
  return text.replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (w) => vocab[stableHash(w.toLowerCase()) % vocab.length] as string);
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
export function mockOutput<T extends AgentTask>(batch: AgentBatch<TaskInput<T>>): TaskResult<T> {
  switch (batch.task) {
    case 'translate':
      return mockTranslate(batch as AgentBatch<TranslateInput>) as TaskResult<T>;
    case 'edit':
      return mockEdit(batch as AgentBatch<EditInput>) as TaskResult<T>;
    case 'glossary':
      return mockGlossary(batch as AgentBatch<GlossaryInput>) as TaskResult<T>;
    case 'brief':
      return mockBrief(batch as AgentBatch<BriefInput>) as TaskResult<T>;
    default:
      throw new Error(`The mock engine does not run "${batch.task}" batches in the pipeline.`);
  }
}
