import { type AgentBatch, type AgentTask, ResultHeaderSchema, type TaskResult } from '@dozabaneh/shared';
import type { z } from 'zod';
import { batchKeys, type CheckContext, TASK_SPECS, type ValidationIssue } from './specs';

/**
 * Validation of a result file (SPEC §10.3-5 and Appendix E): JSON → header → task schema → domain checks.
 * Used by `agent:submit`/`agent:validate` and after every API response, so a rejected result always comes with
 * actionable messages (which key, which rule, how to fix it).
 */
export interface ValidationReport<T extends AgentTask = AgentTask> {
  ok: boolean;
  output?: TaskResult<T>;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function zodIssues(error: z.ZodError, keys: string[], raw: unknown): ValidationIssue[] {
  const items = (raw as { items?: unknown[] } | null)?.items;
  return error.issues.slice(0, 50).map((issue) => {
    const [first, index] = issue.path;
    let key: string | undefined;
    if (first === 'items' && typeof index === 'number') {
      const item = Array.isArray(items) ? (items[index] as { key?: unknown } | undefined) : undefined;
      key = typeof item?.key === 'string' ? item.key : keys[index];
    }
    const path = issue.path.join('.') || '(root)';
    return {
      level: 'error' as const,
      rule: 'schema',
      ...(key ? { key } : {}),
      message: `${path}: ${issue.message}.`,
      fix: 'Follow the result schema of this task (docs/SPEC.md Appendix E).',
    };
  });
}

export function validateResult<T extends AgentTask>(
  batch: AgentBatch,
  raw: unknown,
  ctx: CheckContext,
): ValidationReport<T> {
  const fail = (errors: ValidationIssue[]): ValidationReport<T> => ({ ok: false, errors, warnings: [] });
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw.replace(/^\u{FEFF}/u, ''));
    } catch (e) {
      return fail([
        {
          level: 'error',
          rule: 'json',
          message: `The result is not valid JSON: ${(e as Error).message}.`,
          fix: 'Write a single JSON object (UTF-8, no comments, no trailing commas).',
        },
      ]);
    }
  }
  const header = ResultHeaderSchema.safeParse(data);
  if (!header.success) {
    return fail([
      {
        level: 'error',
        rule: 'header',
        message: 'The result must start with { "schemaVersion": 1, "batchId": "…" }.',
        fix: `Set "schemaVersion": 1 and "batchId": "${batch.batchId}".`,
      },
    ]);
  }
  if (header.data.batchId !== batch.batchId) {
    return fail([
      {
        level: 'error',
        rule: 'batch_id',
        message: `batchId "${header.data.batchId}" does not match this batch ("${batch.batchId}").`,
        fix: `Set "batchId": "${batch.batchId}".`,
      },
    ]);
  }

  const spec = TASK_SPECS[batch.task as T];
  const input = spec.input.safeParse(batch.input);
  if (!input.success) {
    return fail([
      {
        level: 'error',
        rule: 'batch_input',
        message: 'The batch input itself is invalid (app bug).',
        fix: 'Release the batch and report it.',
      },
    ]);
  }
  const { schemaVersion: _v, batchId: _b, ...rest } = data as Record<string, unknown>;
  const parsed = spec.output.safeParse(rest);
  if (!parsed.success) return fail(zodIssues(parsed.error, batchKeys(batch), rest));

  const issues = spec.check(input.data, parsed.data, ctx);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return errors.length ? { ok: false, errors, warnings } : { ok: true, output: parsed.data, errors, warnings };
}

/** Human-readable report for the agent CLI (one line per issue, errors first). */
export function formatReport(report: ValidationReport, batchId: string): string {
  const line = (i: ValidationIssue) =>
    `  ${i.level === 'error' ? 'ERROR' : 'warn '} ${i.key ? `[key ${i.key}] ` : ''}${i.rule}: ${i.message}${i.fix ? `\n        fix: ${i.fix}` : ''}`;
  const head = report.ok
    ? `✓ ${batchId}: valid${report.warnings.length ? ` (${report.warnings.length} warning(s) will become review flags)` : ''}`
    : `✗ ${batchId}: ${report.errors.length} error(s) — nothing was imported. Fix the result file and submit again.`;
  return [head, ...report.errors.map(line), ...report.warnings.map(line)].join('\n');
}
