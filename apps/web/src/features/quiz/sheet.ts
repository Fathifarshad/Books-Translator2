import type { QuizQuestion } from '@dozabaneh/shared';

/** Labels the question sheet needs, already translated (no literals here, golden rule 3). */
export interface SheetLabels {
  title: string;
  questions: string;
  answers: string;
  difficulty: (q: QuizQuestion) => string;
  trueLabel: string;
  falseLabel: string;
  answer: string;
  explanation: string;
  keyPoints: string;
  /** Marks for multiple-choice options in the sheet's language («الف، ب، ج، د» or A–D). */
  optionMarks: readonly string[];
  /** Numbers in the reader's digits. */
  num: (n: number) => string;
  /** A list joined the way the language writes one. */
  list: (items: string[]) => string;
}

/** The mark of an option; past the last mark, its number. */
export function optionMark(index: number, marks: readonly string[]): string {
  return marks[index] ?? String(index + 1);
}

function answerText(q: QuizQuestion, l: SheetLabels): string {
  if (q.type === 'mcq' && typeof q.answer === 'number') {
    return `${optionMark(q.answer, l.optionMarks)}) ${q.options?.[q.answer] ?? ''}`;
  }
  if (q.type === 'tf') return q.answer === true ? l.trueLabel : l.falseLabel;
  return String(q.answer);
}

/**
 * A question sheet a teacher can print or paste into a document: the questions first (with options), then an answer
 * key with explanations — so the first part can be handed out on its own.
 */
export function quizSheetMarkdown(questions: QuizQuestion[], l: SheetLabels): string {
  const out: string[] = [`# ${l.title}`, '', `## ${l.questions}`, ''];
  questions.forEach((q, i) => {
    out.push(`**${l.num(i + 1)}.** ${q.question} _(${l.difficulty(q)})_`, '');
    if (q.type === 'mcq') {
      for (const [oi, o] of (q.options ?? []).entries()) out.push(`- ${optionMark(oi, l.optionMarks)}) ${o}`);
      out.push('');
    } else if (q.type === 'tf') {
      out.push(`- ${l.trueLabel}`, `- ${l.falseLabel}`, '');
    }
  });
  out.push(`## ${l.answers}`, '');
  questions.forEach((q, i) => {
    out.push(`**${l.num(i + 1)}.** ${l.answer}: ${answerText(q, l)}`);
    if (q.keyPoints?.length) out.push(`${l.keyPoints}: ${l.list(q.keyPoints)}`);
    out.push(`${l.explanation}: ${q.explanation}`, '');
  });
  return `${out.join('\n').trimEnd()}\n`;
}
