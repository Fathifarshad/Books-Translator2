import { z } from 'zod';

/**
 * Agent batch files (SPEC Appendix E, schema version 1). The app writes one batch per unit of AI work to
 * data/exchange/outbox/<bookId>/<task>/<batchId>.json; the agent (Claude Code via /process-batches) writes the
 * result to `resultPath`; `agent:submit` validates it against these schemas plus the domain checks.
 * API engines reuse the same input/output schemas, so quality and validation are identical across engines.
 */
export const AGENT_TASKS = ['brief', 'glossary', 'translate', 'edit', 'summary', 'quiz', 'tutor_answer'] as const;
export const AgentTaskSchema = z.enum(AGENT_TASKS);
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const ParentheticalSchema = z.enum(['first_in_chapter', 'always', 'never']);
export const EzafeSchema = z.enum(['yeh', 'hamza']);
export const GlossaryKindSchema = z.enum(['concept', 'term', 'person', 'org', 'place', 'work', 'acronym']);

export const GlossaryEntrySchema = z.object({
  src: z.string(),
  tgt: z.string(),
  kind: z.string(),
  parenthetical: ParentheticalSchema,
  note: z.string().optional(),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;

/** Short item types used in translate batches. */
export const ITEM_TYPES = ['h', 'p', 'li', 'q', 'cap', 'fn'] as const;
export const ItemTypeSchema = z.enum(ITEM_TYPES);
export type ItemType = z.infer<typeof ItemTypeSchema>;

const key = z.string().min(1);

// ── Inputs ───────────────────────────────────────────────────────────────────────────────────────────────

export const TranslateInputSchema = z.object({
  glossary: z.array(GlossaryEntrySchema),
  alreadyIntroduced: z.array(z.string()),
  context: z.object({
    previous: z.array(z.object({ src: z.string(), tgt: z.string().optional() })),
    next: z.array(z.object({ src: z.string() })),
  }),
  items: z.array(z.object({ key, type: ItemTypeSchema, src: z.string() })).min(1),
});
export type TranslateInput = z.infer<typeof TranslateInputSchema>;

export const EditInputSchema = z.object({
  glossary: z.array(GlossaryEntrySchema),
  consistencyMemory: z.array(z.object({ src: z.string(), tgt: z.string() })),
  items: z.array(z.object({ key, type: z.string(), src: z.string(), draft: z.string() })).min(1),
});
export type EditInput = z.infer<typeof EditInputSchema>;

export const GlossaryInputSchema = z.object({
  candidates: z
    .array(z.object({ key, src: z.string(), freq: z.number().int().nonnegative(), examples: z.array(z.string()) }))
    .min(1),
});
export type GlossaryInput = z.infer<typeof GlossaryInputSchema>;

export const BriefInputSchema = z.object({
  metadata: z.record(z.string(), z.unknown()),
  toc: z.array(z.string()),
  samples: z.array(z.string()),
});
export type BriefInput = z.infer<typeof BriefInputSchema>;

const PassageSchema = z.object({ label: z.string(), src: z.string(), tgt: z.string() });
/** Approved glossary terms occurring in the passages (keeps summaries and quizzes consistent with the book). */
const TermsSchema = z.array(z.object({ src: z.string(), tgt: z.string(), definition: z.string().optional() }));

export const SummaryInputSchema = z.object({
  kind: z.enum(['section', 'chapter']),
  passages: z.array(PassageSchema),
  glossary: TermsSchema.optional(),
});
export type SummaryInput = z.infer<typeof SummaryInputSchema>;

export const QuizInputSchema = z.object({
  scope: z.enum(['chapter', 'selection']),
  passages: z.array(PassageSchema),
  glossary: TermsSchema.optional(),
});
export type QuizInput = z.infer<typeof QuizInputSchema>;

export const TutorAnswerInputSchema = z.object({
  question: z.string(),
  mode: z.enum(['default', 'simpler', 'deeper', 'example', 'quiz']),
  selection: z.object({ text: z.string(), lang: z.string() }).optional(),
  passages: z.array(z.object({ label: z.string(), location: z.string(), src: z.string(), tgt: z.string().optional() })),
  glossary: z.array(GlossaryEntrySchema),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
});
export type TutorAnswerInput = z.infer<typeof TutorAnswerInputSchema>;

// ── Results (the task-specific part; the file adds `schemaVersion` and `batchId`) ───────────────────────────

export const TranslateResultSchema = z.object({
  items: z.array(
    z.strictObject({
      key,
      tgt: z.string(),
      note: z.string().optional(),
      introduced: z.array(z.string()).optional(),
    }),
  ),
});
export type TranslateResult = z.infer<typeof TranslateResultSchema>;

export const EditChangeSchema = z.object({
  type: z.string(),
  before: z.string(),
  after: z.string(),
  reason: z.string(),
});

export const EditResultSchema = z.object({
  items: z.array(
    z.strictObject({
      key,
      tgt: z.string(),
      changes: z.array(EditChangeSchema),
      confidence: z.number().min(0).max(1),
      flag: z.object({ severity: z.enum(['low', 'medium', 'high']), reason: z.string().min(1) }).nullable(),
    }),
  ),
});
export type EditResult = z.infer<typeof EditResultSchema>;

export const GlossaryResultSchema = z.object({
  items: z.array(
    z.strictObject({
      key,
      keep: z.boolean(),
      kind: GlossaryKindSchema.optional(),
      tgt: z.string().optional(),
      alternatives: z.array(z.string()).optional(),
      definition: z.string().optional(),
      parenthetical: ParentheticalSchema.optional(),
      confidence: z.number().min(0).max(1).optional(),
      notes: z.string().optional(),
    }),
  ),
});
export type GlossaryResult = z.infer<typeof GlossaryResultSchema>;

export const BriefResultSchema = z.object({
  titleTranslated: z.string().min(1),
  titleAlternatives: z.array(z.string()),
  domain: z.string(),
  audience: z.string(),
  level: z.enum(['popular', 'textbook', 'academic', 'professional']),
  voice: z.string(),
  recurringConcepts: z.array(z.string()),
  specialHandling: z.string(),
  brief: z.string().min(1),
});
export type BriefResult = z.infer<typeof BriefResultSchema>;

export const SummaryResultSchema = z.object({ markdown: z.string().min(1) });
export type SummaryResult = z.infer<typeof SummaryResultSchema>;

export const QuizTaskResultSchema = z.object({
  questions: z.array(
    z.object({
      type: z.enum(['mcq', 'tf', 'short']),
      question: z.string(),
      options: z.array(z.string()).optional(),
      answer: z.union([z.number(), z.boolean(), z.string()]),
      keyPoints: z.array(z.string()).optional(),
      explanation: z.string(),
      difficulty: z.enum(['easy', 'medium', 'hard']),
      sources: z.array(z.string()),
    }),
  ),
});
export type QuizTaskResult = z.infer<typeof QuizTaskResultSchema>;

export const TutorAnswerResultSchema = z.object({ markdown: z.string().min(1), citations: z.array(z.string()) });
export type TutorAnswerResult = z.infer<typeof TutorAnswerResultSchema>;

// ── Envelope ─────────────────────────────────────────────────────────────────────────────────────────────

export const BatchOptionsSchema = z.object({ ezafe: EzafeSchema, parenthetical: ParentheticalSchema });
export type BatchOptions = z.infer<typeof BatchOptionsSchema>;

export const AgentBatchSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string().regex(/^bt_/),
  task: AgentTaskSchema,
  promptRefs: z.array(z.string()).min(1),
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  options: BatchOptionsSchema,
  book: z.object({ title: z.string(), authors: z.array(z.string()), brief: z.string().optional() }),
  location: z.object({ path: z.array(z.string()) }).optional(),
  input: z.unknown(),
  resultPath: z.string(),
  createdAt: z.string(),
});
export type AgentBatch<TInput = unknown> = Omit<z.infer<typeof AgentBatchSchema>, 'input'> & { input: TInput };

/** Every result file starts with `{ schemaVersion: 1, batchId, … }` followed by the task's result fields. */
export const ResultHeaderSchema = z.object({ schemaVersion: z.literal(1), batchId: z.string().min(1) });

export const TASK_INPUT_SCHEMAS = {
  brief: BriefInputSchema,
  glossary: GlossaryInputSchema,
  translate: TranslateInputSchema,
  edit: EditInputSchema,
  summary: SummaryInputSchema,
  quiz: QuizInputSchema,
  tutor_answer: TutorAnswerInputSchema,
} as const satisfies Record<AgentTask, z.ZodType>;

export const TASK_RESULT_SCHEMAS = {
  brief: BriefResultSchema,
  glossary: GlossaryResultSchema,
  translate: TranslateResultSchema,
  edit: EditResultSchema,
  summary: SummaryResultSchema,
  quiz: QuizTaskResultSchema,
  tutor_answer: TutorAnswerResultSchema,
} as const satisfies Record<AgentTask, z.ZodType>;

export type TaskInput<T extends AgentTask> = z.infer<(typeof TASK_INPUT_SCHEMAS)[T]>;
export type TaskResult<T extends AgentTask> = z.infer<(typeof TASK_RESULT_SCHEMAS)[T]>;
