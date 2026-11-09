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

/**
 * The speech pass (ADR-042) rewrites a line to be *said*: digits become words, short units are spelled out, the
 * bracketed original term is dropped. So the checks that guard a translation — same numbers, same markup, same
 * length — would all fire on a correct answer. What must still hold is that every line comes back, in the
 * target language, and not empty.
 */
const speech: TaskSpec<'speech'> = {
  task: 'speech',
  input: TASK_INPUT_SCHEMAS.speech,
  output: TASK_RESULT_SCHEMAS.speech,
  check(input, output, ctx) {
    const issues = checkKeys(
      input.items.map((i) => i.key),
      output.items.map((i) => i.key),
    );
    const script = getLanguage(ctx.targetLang).script;
    for (const item of output.items) {
      const text = item.tgt.trim();
      if (!text) {
        issues.push({
          level: 'error',
          rule: 'empty',
          key: item.key,
          message: 'The spoken form is empty.',
          fix: 'Return the line unchanged when it needs nothing.',
        });
        continue;
      }
      const letters = text.match(/\p{L}/gu) ?? [];
      const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
      const own = script === 'Latn' ? latin : letters.length - latin;
      if (letters.length >= 3 && own / letters.length < 0.5) {
        issues.push({
          level: 'warning',
          rule: 'target_script',
          key: item.key,
          message: `The spoken form is not predominantly written in ${getLanguage(ctx.targetLang).name}.`,
          fix: 'Keep the line in the target language; a foreign name may stay as it is.',
        });
      }
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

/** A question the reader can actually answer and grade: options and answer must fit the question type. */
function quizQuestionIssues(q: TaskResult<'quiz'>['questions'][number], i: number): ValidationIssue[] {
  const at = `Question ${i + 1}`;
  const issue = (rule: string, message: string, fix: string): ValidationIssue => ({
    level: 'error',
    rule,
    message: `${at}: ${message}`,
    fix,
  });
  const out: ValidationIssue[] = [];
  if (!q.question.trim()) out.push(issue('empty_question', 'the question is empty.', 'Write the question.'));
  if (q.type === 'mcq') {
    const n = q.options?.length ?? 0;
    if (n < 2) out.push(issue('mcq_options', 'a multiple-choice question needs 2–6 options.', 'Give 4 options.'));
    if (typeof q.answer !== 'number' || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= n)
      out.push(
        issue('mcq_answer', 'the answer must be the 0-based index of the correct option.', 'Set "answer" to 0…n-1.'),
      );
  } else if (q.type === 'tf' && typeof q.answer !== 'boolean') {
    out.push(issue('tf_answer', 'a true/false answer must be true or false.', 'Set "answer" to true or false.'));
  } else if (q.type === 'short' && (typeof q.answer !== 'string' || !q.answer.trim())) {
    out.push(issue('short_answer', 'a short-answer question needs a model answer.', 'Set "answer" to a model answer.'));
  }
  return out;
}

const quiz: TaskSpec<'quiz'> = {
  task: 'quiz',
  input: TASK_INPUT_SCHEMAS.quiz,
  output: TASK_RESULT_SCHEMAS.quiz,
  check: (input, output) => [
    ...(output.questions.length === 0
      ? [
          {
            level: 'error' as const,
            rule: 'no_questions',
            message: 'The quiz has no questions.',
            fix: 'Write the questions.',
          },
        ]
      : []),
    ...output.questions.flatMap(quizQuestionIssues),
    ...labelsIssues(
      input.passages.map((p) => p.label),
      output.questions.flatMap((q) => q.sources),
      'unknown_source',
    ),
    ...quizLevelIssues(input, output),
  ],
};

/**
 * A single asked level must be the level of every question; a wrong count is only a warning (a short chapter may
 * not carry twenty good questions, and a weak model's quiz is still worth showing).
 */
function quizLevelIssues(input: TaskInput<'quiz'>, output: TaskResult<'quiz'>): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const level = input.level ?? 'mixed';
  if (level !== 'mixed') {
    output.questions.forEach((q, i) => {
      if (q.difficulty !== level)
        out.push({
          level: 'error',
          rule: 'quiz_level',
          message: `Question ${i + 1}: difficulty is "${q.difficulty}" but the quiz was asked at level "${level}".`,
          fix: `Write every question at level "${level}" and set "difficulty": "${level}".`,
        });
    });
  }
  if (input.count !== undefined && output.questions.length !== input.count) {
    out.push({
      level: 'warning',
      rule: 'quiz_count',
      message: `The quiz has ${output.questions.length} questions; ${input.count} were asked for.`,
      fix: `Return exactly ${input.count} questions.`,
    });
  }
  return out;
}

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

/**
 * The cover's art director (ADR-048): as many concepts as asked, each with a layout and faces from the lists it was
 * given, distinct names, words for the owner in the book's language, and a picture described in English — image
 * models read English, and lettering is set by the app, never drawn.
 */
const coverDesign: TaskSpec<'cover_design'> = {
  task: 'cover_design',
  input: TASK_INPUT_SCHEMAS.cover_design,
  output: TASK_RESULT_SCHEMAS.cover_design,
  check(input, output, ctx) {
    const issues: ValidationIssue[] = [];
    const error = (rule: string, message: string, fix: string, key?: string) =>
      issues.push({ level: 'error', rule, message, fix, ...(key ? { key } : {}) });
    if (output.concepts.length < input.count) {
      error(
        'concept_count',
        `${output.concepts.length} concepts for ${input.count} asked.`,
        `Return exactly ${input.count} concepts.`,
      );
    }
    const fonts = new Set(input.fonts.map((f) => f.id));
    const layouts = new Set(input.layouts.map((l) => l.id));
    const names = new Set<string>();
    const script = getLanguage(ctx.targetLang).script;
    output.concepts.forEach((c, i) => {
      const key = String(i + 1);
      for (const font of [c.titleFont, c.bodyFont]) {
        if (!fonts.has(font))
          error('unknown_font', `Font "${font}" is not in input.fonts.`, 'Use only the ids of input.fonts.', key);
      }
      if (!layouts.has(c.layout))
        error('unknown_layout', `Layout "${c.layout}" was not offered.`, 'Use only the ids of input.layouts.', key);
      if (names.has(c.name))
        error('duplicate_name', `Two concepts are called "${c.name}".`, 'Give each concept its own name.', key);
      names.add(c.name);
      if (c.ground === 'image' && !c.imagePrompt.trim()) {
        error(
          'missing_prompt',
          'An image ground needs an imagePrompt.',
          'Describe the picture, or use a gradient ground.',
          key,
        );
      }
      if (/[\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Hebrew}]/u.test(c.imagePrompt)) {
        error('prompt_language', 'The imagePrompt is not in English.', 'Write imagePrompt in English only.', key);
      }
      if (script !== 'Latn' && !/\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Hebrew}/u.test(c.name)) {
        issues.push({
          level: 'warning',
          rule: 'target_script',
          key,
          message: "The concept name is not in the book's language.",
          fix: 'Write name and rationale in the target language.',
        });
      }
      if (input.avoid.includes(c.name)) {
        issues.push({
          level: 'warning',
          rule: 'repeated',
          key,
          message: `"${c.name}" was already shown.`,
          fix: 'Propose new concepts.',
        });
      }
    });
    if (output.concepts.length > 1 && new Set(output.concepts.map((c) => c.layout)).size === 1) {
      issues.push({
        level: 'warning',
        rule: 'same_layout',
        message: 'Every concept uses the same layout.',
        fix: 'Vary the layouts so the owner has a real choice.',
      });
    }
    return issues;
  },
};

export const TASK_SPECS: { [T in AgentTask]: TaskSpec<T> } = {
  brief,
  glossary,
  translate,
  edit,
  speech,
  summary,
  quiz,
  tutor_answer: tutorAnswer,
  cover_design: coverDesign,
};

/** Input keys of a batch (for mapping schema errors on `items[i]` back to their key). */
export function batchKeys(batch: AgentBatch): string[] {
  const input = batch.input as { items?: { key: string }[]; candidates?: { key: string }[] };
  return (input.items ?? input.candidates ?? []).map((i) => i.key);
}
