import { localeOf } from './languages';

/** Language-aware sentence split via Intl.Segmenter (SPEC §14). */
export function splitSentences(text: string, lang: string): string[] {
  const segmenter = new Intl.Segmenter(localeOf(lang), { granularity: 'sentence' });
  return [...segmenter.segment(text)].map((s) => s.segment.trim()).filter(Boolean);
}

export function countWords(text: string, lang: string): number {
  const segmenter = new Intl.Segmenter(localeOf(lang), { granularity: 'word' });
  let n = 0;
  for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}
