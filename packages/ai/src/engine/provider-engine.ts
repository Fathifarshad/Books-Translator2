import { type AgentBatch, type AgentTask, TASK_RESULT_SCHEMAS, type TaskResult } from '@dozabaneh/shared';
import { z } from 'zod';
import type { Engine, RunContext, RunResult } from './engines';
import { type ChatMessage, type ProviderClient, ProviderError, type ProviderUsage } from './providers';
import type { ValidationReport } from './validate';

/**
 * Runs pipeline batches on an OpenAI-compatible provider (Gemini, Ollama, OpenRouter). The system prompt is the task
 * prompt + style guide from prompts/ (the same files the agent reads); the user message is the batch payload. The
 * answer must be JSON; it is validated exactly like an agent result, and one repair round sends the errors back.
 */
export interface ProviderEngineOptions {
  client: ProviderClient;
  /** Rendered system prompt for a batch (task prompt + style guide). */
  systemPrompt: (batch: AgentBatch) => string;
  /** Full validation (schema + domain checks) of the raw answer for a batch. */
  validate: (batch: AgentBatch, raw: unknown) => ValidationReport;
  /** Called right before every request (rate limiting). */
  beforeRequest?: () => Promise<void>;
  repairs?: number;
}

/**
 * Item-level problems that the post-processing QA also detects and sends to the review queue. When they survive the
 * repair round the answer is kept (SPEC §9.7: reject → repair → flag) instead of discarding a whole chunk; missing
 * keys, empty translations and schema errors stay fatal.
 */
export const SOFT_RULES: ReadonlySet<string> = new Set(['numbers', 'target_script', 'markup']);

/** How many items of a chunk may come back empty and still be rescued instead of rejecting the whole answer. */
const MAX_EMPTY_SHARE = 0.1;

type OutputItems = { items?: { key: string; tgt?: string }[] };
type InputItems = { items?: { key: string; src?: string; draft?: string }[] };

/**
 * A book extracted from a two-column scan has "paragraphs" that are single broken lines («pressure» on its own),
 * and a translator asked for them sometimes answers nothing at all — there is nothing to say. An empty item is
 * normally fatal (ADR-036), but throwing away 59 good translations because of one shredded fragment leaves the
 * book stuck forever. On the last round such an item keeps its source text, which post-processing QA flags
 * (`target_script`) and the review queue shows. Only a small minority may be rescued: an engine that answers
 * nothing at all is still a failure.
 */
export function rescueEmptyItems(
  batch: AgentBatch,
  output: unknown,
  errors: { rule: string; key?: string }[],
): boolean {
  const emptyKeys = new Set(errors.filter((e) => e.rule === 'empty' && e.key).map((e) => e.key as string));
  if (emptyKeys.size === 0) return true;
  const items = (output as OutputItems).items ?? [];
  if (items.length === 0 || emptyKeys.size > Math.max(1, Math.ceil(items.length * MAX_EMPTY_SHARE))) return false;
  const source = new Map(
    ((batch.input as InputItems).items ?? []).map((i) => [i.key, (i.draft ?? i.src ?? '').trim()]),
  );
  for (const item of items) {
    if (!emptyKeys.has(item.key)) continue;
    const fallback = source.get(item.key);
    if (!fallback) return false;
    item.tgt = fallback;
  }
  return true;
}

/** The first JSON object in a model answer (tolerates code fences and chatter around it). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in the answer');
  return JSON.parse(candidate.slice(start, end + 1));
}

const schemaCache = new Map<AgentTask, Record<string, unknown>>();
function resultSchemaObject(task: AgentTask): Record<string, unknown> {
  let s = schemaCache.get(task);
  if (!s) {
    s = z.toJSONSchema(TASK_RESULT_SCHEMAS[task]) as Record<string, unknown>;
    schemaCache.set(task, s);
  }
  return s;
}
const resultSchema = (task: AgentTask) => JSON.stringify(resultSchemaObject(task));

/** What the model sees: everything the agent would see in the batch file, minus file-exchange fields. */
export function batchPayload(batch: AgentBatch): Record<string, unknown> {
  const { resultPath: _r, promptRefs: _p, createdAt: _c, schemaVersion: _v, batchId: _b, ...rest } = batch;
  return rest;
}

export function buildMessages(batch: AgentBatch, system: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `${system}\n\n---\n\nAnswer with ONE JSON object only (no prose, no code fences) that matches this JSON Schema:\n${resultSchema(batch.task)}`,
    },
    { role: 'user', content: JSON.stringify(batchPayload(batch)) },
  ];
}

function repairMessage(report: ValidationReport | null, parseError?: string): string {
  const lines = parseError
    ? [`Your answer was not valid JSON (${parseError}).`]
    : (report?.errors ?? [])
        .slice(0, 20)
        .map((e) => `- ${e.key ? `[key ${e.key}] ` : ''}${e.rule}: ${e.message}${e.fix ? ` Fix: ${e.fix}` : ''}`);
  return `The answer was rejected:\n${lines.join('\n')}\nReturn the complete corrected JSON object for ALL keys, nothing else.`;
}

export function createProviderEngine(opts: ProviderEngineOptions): Engine {
  const { client } = opts;
  return {
    id: client.provider,
    capabilities: { realtime: true, streaming: true, structuredOutput: true, batch: false },
    async run<T extends AgentTask>(batch: AgentBatch, ctx: RunContext): Promise<RunResult<T>> {
      const messages = buildMessages(batch, opts.systemPrompt(batch));
      const usage: ProviderUsage = { tokensIn: 0, tokensOut: 0 };
      let lastProblem = '';
      for (let attempt = 0; attempt <= (opts.repairs ?? 1); attempt++) {
        await opts.beforeRequest?.();
        const answer = await client.chat(messages, {
          json: true,
          schema: resultSchemaObject(batch.task),
          ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        usage.tokensIn += answer.usage?.tokensIn ?? 0;
        usage.tokensOut += answer.usage?.tokensOut ?? 0;
        let parsed: unknown;
        try {
          parsed = extractJson(answer.text);
        } catch (err) {
          lastProblem = (err as Error).message;
          messages.push(
            { role: 'assistant', content: answer.text.slice(0, 20_000) },
            { role: 'user', content: repairMessage(null, lastProblem) },
          );
          continue;
        }
        const report = opts.validate(batch, { schemaVersion: 1, batchId: batch.batchId, ...(parsed as object) });
        if (report.ok && report.output) {
          return { kind: 'done', output: report.output as TaskResult<T>, usage, model: answer.model };
        }
        const lastAttempt = attempt === (opts.repairs ?? 1);
        if (lastAttempt && report.output) {
          const rest = report.errors.filter((e) => e.rule !== 'empty');
          if (rest.every((e) => SOFT_RULES.has(e.rule)) && rescueEmptyItems(batch, report.output, report.errors)) {
            return { kind: 'done', output: report.output as TaskResult<T>, usage, model: answer.model };
          }
        }
        lastProblem = report.errors.map((e) => `${e.key ? `[${e.key}] ` : ''}${e.rule}: ${e.message}`).join(' · ');
        messages.push(
          { role: 'assistant', content: answer.text.slice(0, 20_000) },
          { role: 'user', content: repairMessage(report) },
        );
      }
      throw new ProviderError('BAD_RESPONSE', `The model's answer failed validation: ${lastProblem.slice(0, 600)}`);
    },
  };
}
