import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProviderEngine, loadTaskPrompt, ProviderError, promptRefsFor, validateResult } from '@dozabaneh/ai';
import type { AgentBatch, ProviderId, TaskResult } from '@dozabaneh/shared';
import { repoRoot } from '../config';
import { newId } from '../db/repo';
import type { ProviderService } from '../settings/providers';

/**
 * One JSON task (summary, quiz) on the configured assistant engine: prompts from `prompts/`, the task's JSON
 * schema, the same validation as every other engine and one repair round. Shared by `/assist/*` and by the
 * recording of a book's summary, so both ask for a summary in exactly the same way.
 */
export const ASSIST_MAX_WAIT_MS = 10_000;

const readPrompt = (ref: string) => readFileSync(join(repoRoot(), ref), 'utf8');

export interface AssistTaskBody {
  sourceLang: string;
  targetLang: string;
  book: { title: string; authors: string[] };
}

export async function runAssistTask<T extends 'summary' | 'quiz'>(
  providers: ProviderService,
  engine: ProviderId,
  task: T,
  body: AssistTaskBody,
  input: Record<string, unknown>,
  maxWaitMs = ASSIST_MAX_WAIT_MS,
): Promise<TaskResult<T> & { engine: ProviderId; model: string }> {
  const batch: AgentBatch = {
    schemaVersion: 1,
    batchId: newId('as'),
    task,
    promptRefs: promptRefsFor(task, body.targetLang),
    sourceLanguage: body.sourceLang,
    targetLanguage: body.targetLang,
    options: { ezafe: 'yeh', parenthetical: 'first_in_chapter' },
    book: body.book,
    input,
    resultPath: '',
    createdAt: new Date().toISOString(),
  };
  const run = createProviderEngine({
    client: providers.client(engine),
    systemPrompt: (b) =>
      loadTaskPrompt(b.task, { sourceLang: b.sourceLanguage, targetLang: b.targetLanguage }, readPrompt).system,
    validate: (b, raw) => validateResult(b, raw, { sourceLang: body.sourceLang, targetLang: body.targetLang }),
    beforeRequest: () => providers.acquire(engine, maxWaitMs),
  });
  try {
    const res = await run.run<T>(batch, {});
    if (res.kind !== 'done') throw new Error('provider engines answer in real time');
    providers.reportSuccess(engine);
    return { ...res.output, engine, model: res.model ?? providers.view(engine).model };
  } catch (err) {
    if (err instanceof ProviderError) providers.reportError(engine, err);
    throw err;
  }
}
