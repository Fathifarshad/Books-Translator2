import {
  type AgentBatch,
  type AgentTask,
  TASK_INPUT_SCHEMAS,
  TASK_RESULT_SCHEMAS,
  type TaskInput,
  type TaskResult,
} from '@dozabaneh/shared';
import {
  checkTranslation,
  getLanguage,
  lengthRatioSuspicious,
  type QaCode,
  type QaGlossaryEntry,
} from '@dozabaneh/text';
import type { z } from 'zod';

/**
 * Task specs (SPEC §10.1): one per kind of AI work. A spec owns the input/output schemas and the domain checks,
 * so an agent batch, an API call and a mock run are validated identically.
 */
export interface ValidationIssue {
  level: 'error' | 'warning';
  rule: string;
  key?: string;
  message: string;
  fix?: string;
}

export interface CheckContext {
  sourceLang: string;
  targetLang: string;
  /** Approved glossary entries (with alternatives and kinds) for terminology checks. */
  glossary?: QaGlossaryEntry[];
}

export interface TaskSpec<T extends AgentTask> {
  task: T;
  input: z.ZodType<TaskInput<T>>;
  output: z.ZodType<TaskResult<T>>;
  check(input: TaskInput<T>, output: TaskResult<T>, ctx: CheckContext): ValidationIssue[];
}

/** QA codes that reject a result (the agent must fix them); the rest become review-queue flags. */
const BLOCKING: ReadonlySet<QaCode> = new Set(['empty', 'markup', 'numbers', 'target_script', 'repetition']);

/** Exactly one output item per input key: reports missing, extra and duplicate keys. */
export function checkKeys(inputKeys: string[], outputKeys: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const expected = new Set(inputKeys);
  const seen = new Set<string>();
  for (const k of outputKeys) {
    if (seen.has(k)) {
      issues.push({
        level: 'error',
        rule: 'duplicate_key',
        key: k,
        message: `Key "${k}" appears more than once.`,
        fix: 'Return exactly one item per key.',
      });
    } else if (!expected.has(k)) {
      issues.push({
        level: 'error',
        rule: 'unknown_key',
        key: k,
        message: `Key "${k}" is not in the batch input.`,
        fix: 'Use only the keys of input.items; never rename, merge or split items.',
      });
    }
    seen.add(k);
  }
  for (const k of inputKeys) {
    if (!seen.has(k)) {
      issues.push({
        level: 'error',
        rule: 'missing_key',
        key: k,
        message: `Key "${k}" is missing.`,
        fix: `Add the item for key "${k}".`,
      });
    }
  }
  return issues;
}

function translationIssues(key: string, src: string, tgt: string, ctx: CheckContext): ValidationIssue[] {
  const issues: ValidationIssue[] = checkTranslation(src, tgt, {
    srcLang: ctx.sourceLang,
    tgtLang: ctx.targetLang,
    ...(ctx.glossary ? { glossary: ctx.glossary } : {}),
  }).map((q) => ({
    level: BLOCKING.has(q.code) ? 'error' : 'warning',
    rule: q.code,
    key,
    message: q.message,
    fix: q.fix,
  }));
  if (lengthRatioSuspicious(src, tgt)) {
    issues.push({
      level: 'warning',
      rule: 'length',
      key,
      message: 'The translation is much shorter or longer than the source.',
      fix: 'Check for omissions or additions.',
    });
  }
  return issues;
}

const translate: TaskSpec<'translate'> = {
  task: 'translate',
  input: TASK_INPUT_SCHEMAS.translate,
  output: TASK_RESULT_SCHEMAS.translate,
  check(input, output, ctx) {
    const issues = checkKeys(
      input.items.map((i) => i.key),
      output.items.map((i) => i.key),
    );
    const byKey = new Map(input.items.map((i) => [i.key, i]));
    const glossarySrc = new Set(input.glossary.map((g) => g.src.toLowerCase()));
    for (const item of output.items) {
      const src = byKey.get(item.key);
      if (!src) continue;
      issues.push(...translationIssues(item.key, src.src, item.tgt, ctx));
      for (const term of item.introduced ?? []) {
        if (!glossarySrc.has(term.toLowerCase())) {
          issues.push({
            level: 'warning',
            rule: 'introduced',
            key: item.key,
            message: `"${term}" in introduced is not a glossary entry of this batch.`,
            fix: 'List only source terms from input.glossary.',
          });
        }
      }
    }
    return issues;
  },
};

const edit: TaskSpec<'edit'> = {
  task: 'edit',
  input: TASK_INPUT_SCHEMAS.edit,
  output: TASK_RESULT_SCHEMAS.edit,
  check(input, output, ctx) {
    const issues = checkKeys(
      input.items.map((i) => i.key),
      output.items.map((i) => i.key),
    );
    const byKey = new Map(input.items.map((i) => [i.key, i]));
    for (const item of output.items) {
      const src = byKey.get(item.key);
      if (src) issues.push(...translationIssues(item.key, src.src, item.tgt, ctx));
    }
    return issues;
  },
};

const glossary: TaskSpec<'glossary'> = {
  task: 'glossary',
  input: TASK_INPUT_SCHEMAS.glossary,
  output: TASK_RESULT_SCHEMAS.glossary,
  check(input, output, ctx) {
    const issues = checkKeys(
      input.candidates.map((c) => c.key),
      output.items.map((i) => i.key),
    );
    const script = getLanguage(ctx.targetLang).script;
    for (const item of output.items) {
      if (!item.keep) continue;
      for (const field of ['tgt', 'kind', 'parenthetical'] as const) {
        if (!item[field] || (typeof item[field] === 'string' && !(item[field] as string).trim())) {
          issues.push({
            level: 'error',
            rule: 'kept_term_incomplete',
            key: item.key,
            message: `Kept candidate has no "${field}".`,
            fix: `Set "${field}" for every item with keep: true (or set keep: false).`,
          });
        }
      }
      if (
        item.tgt &&
        script !== 'Latn' &&
        item.kind !== 'acronym' &&
        !/\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Hebrew}/u.test(item.tgt)
      ) {
        issues.push({
          level: 'warning',
          rule: 'target_script',
          key: item.key,
          message: `The equivalent "${item.tgt}" is not written in the target script.`,
          fix: 'Give the equivalent in the target language; keep Latin only for acronyms and product names.',
        });
      }
    }
    return issues;
  },
};

const brief: TaskSpec<'brief'> = {
  task: 'brief',
  input: TASK_INPUT_SCHEMAS.brief,
  output: TASK_RESULT_SCHEMAS.brief,
  check(_input, output, ctx) {
    const issues: ValidationIssue[] = [];
    const words = output.brief.trim().split(/\s+/u).length;
    if (words < 60 || words > 320) {
      issues.push({
        level: 'warning',
        rule: 'brief_length',
        message: `The brief has ${words} words (expected about 120–200).`,
        fix: 'Write a 120–200 word brief.',
      });
    }
    if (
      getLanguage(ctx.targetLang).script !== 'Latn' &&
      !/\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Hebrew}/u.test(output.brief)
    ) {
      issues.push({
        level: 'error',
        rule: 'target_script',
        message: 'The brief is not written in the target language.',
        fix: 'Write `brief` (and `titleTranslated`) in the target language.',
      });
    }
    return issues;
  },
};

function labelsIssues(labels: string[], used: string[], rule: string): ValidationIssue[] {
  const allowed = new Set(labels);
  return used
    .filter((l) => !allowed.has(l))
    .map((l) => ({
      level: 'error' as const,
      rule,
      message: `"${l}" is not one of the provided passage labels.`,
      fix: `Cite only these labels: ${labels.join(', ')}.`,
    }));
}

const summary: TaskSpec<'summary'> = {
  task: 'summary',
  input: TASK_INPUT_SCHEMAS.summary,
  output: TASK_RESULT_SCHEMAS.summary,
  check: () => [],
};

const quiz: TaskSpec<'quiz'> = {
  task: 'quiz',
  input: TASK_INPUT_SCHEMAS.quiz,
  output: TASK_RESULT_SCHEMAS.quiz,
  check: (input, output) =>
    labelsIssues(
      input.passages.map((p) => p.label),
      output.questions.flatMap((q) => q.sources),
      'unknown_source',
    ),
};

const tutorAnswer: TaskSpec<'tutor_answer'> = {
  task: 'tutor_answer',
  input: TASK_INPUT_SCHEMAS.tutor_answer,
  output: TASK_RESULT_SCHEMAS.tutor_answer,
  check: (input, output) =>
    labelsIssues(
      input.passages.map((p) => p.label),
      output.citations,
      'unknown_citation',
    ),
};

export const TASK_SPECS: { [T in AgentTask]: TaskSpec<T> } = {
  brief,
  glossary,
  translate,
  edit,
  summary,
  quiz,
  tutor_answer: tutorAnswer,
};

/** Input keys of a batch (for mapping schema errors on `items[i]` back to their key). */
export function batchKeys(batch: AgentBatch): string[] {
  const input = batch.input as { items?: { key: string }[]; candidates?: { key: string }[] };
  return (input.items ?? input.candidates ?? []).map((i) => i.key);
}
