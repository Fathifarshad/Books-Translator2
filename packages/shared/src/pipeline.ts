import { z } from 'zod';
import { EzafeSchema, ParentheticalSchema } from './agent';

/**
 * Per-book translation settings (wizard step 4, SPEC §13.2) and pipeline state shared by the API and the web app.
 */
export const QUALITY_PROFILES = ['economy', 'balanced', 'best'] as const;
export const QualityProfileSchema = z.enum(QUALITY_PROFILES);
export type QualityProfile = z.infer<typeof QualityProfileSchema>;

/** Engines selectable in Phase 3; `anthropic` / `openai` join in Phase 4. */
export const PIPELINE_ENGINES = ['agent', 'mock'] as const;
export const PipelineEngineSchema = z.enum(PIPELINE_ENGINES);
export type PipelineEngine = z.infer<typeof PipelineEngineSchema>;

export const PIPELINE_TASKS = ['brief', 'glossary', 'translate', 'edit'] as const;
export type PipelineTask = (typeof PIPELINE_TASKS)[number];

export const TranslationSettingsSchema = z.object({
  profile: QualityProfileSchema.default('balanced'),
  engines: z
    .object({
      brief: PipelineEngineSchema.default('agent'),
      glossary: PipelineEngineSchema.default('agent'),
      translate: PipelineEngineSchema.default('agent'),
      edit: PipelineEngineSchema.default('agent'),
    })
    .default({ brief: 'agent', glossary: 'agent', translate: 'agent', edit: 'agent' }),
  ezafe: EzafeSchema.default('yeh'),
  digits: z.enum(['native', 'latin']).default('native'),
  /** Default parenthetical policy for new glossary terms. */
  parenthetical: ParentheticalSchema.default('first_in_chapter'),
  /** Skip the human glossary review (wizard step 5 «بدون بازبینی ادامه بده»). */
  autoApproveGlossary: z.boolean().default(false),
  /** Chapters/sections translated first. */
  priorityNodeIds: z.array(z.string()).default([]),
});
export type TranslationSettings = z.infer<typeof TranslationSettingsSchema>;

export const PIPELINE_STAGES = ['brief', 'glossary', 'glossary_review', 'translate', 'edit', 'qa', 'done'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface StageCount {
  done: number;
  total: number;
}

export interface ChapterProgress {
  nodeId: string;
  title: { src: string; tgt?: string };
  done: number;
  total: number;
  flagged: number;
}

export interface PipelineJobError {
  jobId: string;
  stage: string;
  error: string;
  attempts: number;
}

export interface PipelineLogEntry {
  at: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

/** Snapshot for the pipeline dashboard (GET /books/:id/pipeline). */
export interface PipelineStatus {
  lang: string;
  state: 'idle' | 'running' | 'paused' | 'waiting_glossary_review' | 'done' | 'cancelled';
  stage: PipelineStage;
  settings: TranslationSettings;
  stages: Record<'brief' | 'glossary' | 'translate' | 'edit' | 'qa', StageCount>;
  counter: StageCount;
  flagged: number;
  chapters: ChapterProgress[];
  agent: { pending: number; leased: number; imported: number; rejected: number };
  errors: PipelineJobError[];
  log: PipelineLogEntry[];
}

export interface PipelineEstimate {
  words: number;
  segments: number;
  batches: { brief: number; glossary: number; translate: number; edit: number };
}
