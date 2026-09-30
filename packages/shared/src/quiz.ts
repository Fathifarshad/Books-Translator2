import { z } from 'zod';

/** QuizResultV1 (SPEC Appendix E). */
export const QuizQuestionSchema = z.object({
  type: z.enum(['mcq', 'tf', 'short']),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  answer: z.union([z.number(), z.boolean(), z.string()]),
  keyPoints: z.array(z.string()).optional(),
  explanation: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  sources: z.array(z.string()),
});
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizResultSchema = z.object({ questions: z.array(QuizQuestionSchema).min(1) });
export type QuizResult = z.infer<typeof QuizResultSchema>;
