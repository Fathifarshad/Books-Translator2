import type { QuizQuestion } from '@dozabaneh/shared';
import { describe, expect, it } from 'vitest';
import { optionMark, quizSheetMarkdown, type SheetLabels } from './sheet';

const labels: SheetLabels = {
  title: 'Quiz',
  questions: 'Questions',
  answers: 'Answer key',
  difficulty: (q) => q.difficulty,
  trueLabel: 'True',
  falseLabel: 'False',
  answer: 'Answer',
  explanation: 'Why',
  keyPoints: 'Key points',
  optionMarks: ['A', 'B', 'C', 'D'],
  num: (n) => String(n),
  list: (items) => items.join(', '),
};

const questions: QuizQuestion[] = [
  {
    type: 'mcq',
    question: 'Which one?',
    options: ['a', 'b', 'c', 'd'],
    answer: 2,
    explanation: 'Because c.',
    difficulty: 'professional',
    sources: ['P1'],
  },
  { type: 'tf', question: 'Is it?', answer: false, explanation: 'No.', difficulty: 'easy', sources: [] },
  {
    type: 'short',
    question: 'Explain.',
    answer: 'Like this.',
    keyPoints: ['one', 'two'],
    explanation: 'Model.',
    difficulty: 'hard',
    sources: [],
  },
];

describe('quiz sheet', () => {
  it('puts every question before the answer key, so the questions can be handed out alone', () => {
    const md = quizSheetMarkdown(questions, labels);
    const key = md.indexOf('## Answer key');
    expect(md.indexOf('Which one?')).toBeLessThan(key);
    expect(md.indexOf('Explain.')).toBeLessThan(key);
    expect(md.slice(0, key)).not.toContain('Because c.');
    expect(md).toContain('_(professional)_');
  });

  it('writes the right option, true/false and the model answer with key points', () => {
    const md = quizSheetMarkdown(questions, labels);
    expect(md).toContain('**1.** Answer: C) c');
    expect(md).toContain('**2.** Answer: False');
    expect(md).toContain('**3.** Answer: Like this.');
    expect(md).toContain('Key points: one, two');
  });

  it('marks options with the given letters and falls back to numbers', () => {
    expect(optionMark(0, ['الف', 'ب'])).toBe('الف');
    expect(optionMark(1, labels.optionMarks)).toBe('B');
    expect(optionMark(9, labels.optionMarks)).toBe('10');
  });
});
