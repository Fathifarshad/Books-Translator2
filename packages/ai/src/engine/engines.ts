import type { AgentBatch, AgentTask, TaskResult } from '@dozabaneh/shared';
import { sleep } from '../mock/chunks';
import { mockOutput } from './mock';

/**
 * Engines (SPEC §10.2): where a task runs. Every engine receives the same batch envelope built from the task spec,
 * so switching engines is configuration only: `mock`, `agent` (Claude Code), and the free OpenAI-compatible
 * providers (`gemini`, `ollama`, `openrouter`); `anthropic` / `openai` (paid APIs) fit the same interface.
 */
export const ENGINE_IDS = ['agent', 'anthropic', 'openai', 'mock', 'gemini', 'ollama', 'openrouter'] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  costUsd?: number;
}

export type RunResult<T extends AgentTask> =
  | { kind: 'done'; output: TaskResult<T>; usage?: Usage; model?: string }
  | { kind: 'deferred'; batchId: string };

export interface RunContext {
  /** Writes the batch file for an agent to pick up (agent engine only). */
  materialize?: (batch: AgentBatch) => Promise<void>;
  signal?: AbortSignal;
}

export interface Engine {
  id: EngineId;
  capabilities: { realtime: boolean; streaming: boolean; structuredOutput: boolean; batch: boolean };
  run<T extends AgentTask>(batch: AgentBatch, ctx: RunContext): Promise<RunResult<T>>;
}

export function createMockEngine(opts: { latencyMs?: number } = {}): Engine {
  return {
    id: 'mock',
    capabilities: { realtime: true, streaming: true, structuredOutput: true, batch: false },
    async run<T extends AgentTask>(batch: AgentBatch, ctx: RunContext): Promise<RunResult<T>> {
      if (opts.latencyMs) await sleep(opts.latencyMs, ctx.signal);
      return { kind: 'done', output: mockOutput<T>(batch), usage: { tokensIn: 0, tokensOut: 0 }, model: 'mock' };
    },
  };
}

/** Claude Code as the engine: the batch is written to the outbox and the job waits for `agent:submit`. */
export function createAgentEngine(): Engine {
  return {
    id: 'agent',
    capabilities: { realtime: false, streaming: false, structuredOutput: true, batch: true },
    async run<T extends AgentTask>(batch: AgentBatch, ctx: RunContext): Promise<RunResult<T>> {
      if (!ctx.materialize) throw new Error('The agent engine needs a materialize() callback.');
      await ctx.materialize(batch);
      return { kind: 'deferred', batchId: batch.batchId };
    },
  };
}
