import { z } from 'zod';

/** How hard one question is: recall → understanding → application/analysis → expert judgement. */
export const QUIZ_DIFFICULTIES = ['easy', 'medium', 'hard', 'professional'] as const;
export const QuizDifficultySchema = z.enum(QUIZ_DIFFICULTIES);
export type QuizDifficulty = z.infer<typeof QuizDifficultySchema>;

/** The level a reader (or a teacher preparing questions) asks for; `mixed` spreads the questions over all levels. */
export const QUIZ_LEVELS = ['mixed', ...QUIZ_DIFFICULTIES] as const;
export const QuizLevelSchema = z.enum(QUIZ_LEVELS);
export type QuizLevel = z.infer<typeof QuizLevelSchema>;

/** Questions per chapter quiz: the default, and what a reader may ask for. */
export const QUIZ_COUNT = { default: 8, min: 3, max: 20 } as const;
export const QuizCountSchema = z.number().int().min(QUIZ_COUNT.min).max(QUIZ_COUNT.max);

/** QuizResultV1 (SPEC Appendix E). */
export const QuizQuestionSchema = z.object({
  type: z.enum(['mcq', 'tf', 'short']),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  answer: z.union([z.number(), z.boolean(), z.string()]),
  keyPoints: z.array(z.string()).optional(),
  explanation: z.string(),
  difficulty: QuizDifficultySchema,
  sources: z.array(z.string()),
});
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizResultSchema = z.object({ questions: z.array(QuizQuestionSchema).min(1) });
export type QuizResult = z.infer<typeof QuizResultSchema>;
