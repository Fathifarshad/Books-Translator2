import type { ContextGlossaryEntry } from '@dozabaneh/shared';
import { splitSentences } from '@dozabaneh/text';
import { mockStrings } from './strings';

export interface SummaryInput {
  kind: 'section' | 'chapter';
  targetLang: string;
  passages: { label: string; src: string; tgt?: string }[];
  glossary: ContextGlossaryEntry[];
}

/** Extractive, deterministic summary with the SummaryResultV1 layout (prompts/summary.md). */
export function mockSummary(input: SummaryInput): { markdown: string } {
  const s = mockStrings(input.targetLang);
  const texts = input.passages.map((p) =>
    p.tgt ? { text: p.tgt, lang: input.targetLang } : { text: p.src, lang: 'en' },
  );
  const first = (i: number) => {
    const t = texts[i];
    return t ? (splitSentences(t.text, t.lang)[0] ?? t.text) : '';
  };
  const last = texts[texts.length - 1];
  const lastSentence = last ? (splitSentences(last.text, last.lang).at(-1) ?? last.text) : '';
  const points = texts.slice(0, 7).map((_, i) => `- ${first(i)}`);
  const terms = input.glossary.slice(0, 6).map((g) => `${g.tgt} (${g.src})`);
  const lines = [`**${s.summary.mainIdea}:** ${first(0)}`, '', `**${s.summary.keyPoints}:**`, ...points];
  if (terms.length) lines.push('', `**${s.summary.keyTerms}:** ${terms.join(s.listSeparator)}`);
  lines.push('', `**${s.summary.whyItMatters}:** ${lastSentence}`);
  return { markdown: lines.join('\n') };
}
