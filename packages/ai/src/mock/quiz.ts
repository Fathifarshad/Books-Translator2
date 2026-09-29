import type { ContextGlossaryEntry, QuizQuestion, QuizResult } from '@dozabaneh/shared';
import { splitSentences } from '@dozabaneh/text';
import { seededRandom, shuffle } from './chunks';
import { mockStrings } from './strings';

export interface QuizInput {
  scope: 'chapter' | 'selection';
  targetLang: string;
  passages: { label: string; src: string; tgt?: string }[];
  glossary: ContextGlossaryEntry[];
  /** Changes the question selection for «آزمون تازه». */
  seed?: string;
}

/**
 * Deterministic quiz from glossary definitions (QuizResultV1): chapter → 5 MCQ + 2 true/false + 1 short;
 * selection → 3 mixed. Real engines write better questions from prompts/quiz.md.
 */
export function mockQuiz(input: QuizInput): QuizResult {
  const s = mockStrings(input.targetLang);
  const random = seededRandom(`${input.seed ?? ''}|${input.passages.map((p) => p.label).join()}`);
  const terms = shuffle(
    input.glossary.filter((g) => g.definition),
    random,
  );
  const sourceOf = (g: ContextGlossaryEntry) =>
    input.passages
      .filter((p) => p.src.toLowerCase().includes(g.src.toLowerCase()) || (p.tgt ?? '').includes(g.tgt))
      .slice(0, 2)
      .map((p) => p.label);
  const nMcq = input.scope === 'chapter' ? 5 : 1;
  const nTf = input.scope === 'chapter' ? 2 : 1;
  const questions: QuizQuestion[] = [];
  const difficulties = ['easy', 'medium', 'hard'] as const;

  for (const g of terms.slice(0, nMcq)) {
    const distractors = shuffle(
      terms.filter((x) => x !== g),
      random,
    ).slice(0, 3);
    const options = shuffle([g, ...distractors], random);
    questions.push({
      type: 'mcq',
      question: s.quiz.whichTerm(g.definition ?? ''),
      options: options.map((o) => o.tgt),
      answer: options.indexOf(g),
      explanation: s.quiz.mcqExplanation(g.tgt),
      difficulty: difficulties[questions.length % 3] ?? 'medium',
      sources: sourceOf(g),
    });
  }
  for (const g of terms.slice(nMcq, nMcq + nTf)) {
    const other = terms.find((x) => x !== g && x.definition);
    const truthful = random() < 0.5 || !other;
    questions.push({
      type: 'tf',
      question: s.quiz.trueFalse(g.tgt, (truthful ? g.definition : other?.definition) ?? ''),
      answer: truthful,
      explanation: truthful ? s.quiz.tfExplanationTrue(g.tgt) : s.quiz.tfExplanationFalse(g.tgt, other?.tgt ?? ''),
      difficulty: 'medium',
      sources: sourceOf(g),
    });
  }
  const first = input.passages[0];
  if (first) {
    const text = first.tgt ?? first.src;
    questions.push({
      type: 'short',
      question: s.quiz.short,
      answer: splitSentences(text, first.tgt ? input.targetLang : 'en')[0] ?? text,
      keyPoints: terms.slice(0, 3).map((g) => g.tgt),
      explanation: s.quiz.shortExplanation,
      difficulty: 'hard',
      sources: [first.label],
    });
  }
  return { questions };
}
