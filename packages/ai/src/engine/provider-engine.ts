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
