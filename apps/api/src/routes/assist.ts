import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createProviderEngine,
  createProviderTutorEngine,
  loadTaskPrompt,
  PROMPT_REFS,
  ProviderError,
  promptRefsFor,
  validateResult,
} from '@dozabaneh/ai';
import {
  type AgentBatch,
  API_PREFIX,
  type ChatEvent,
  isProviderId,
  type ProviderId,
  QuizRequestSchema,
  SummaryRequestSchema,
  TutorEngineInputSchema,
} from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import { repoRoot } from '../config';
import { newId } from '../db/repo';
import { httpError } from './errors';

/** A reader waits for these; a longer queue for the provider's limits is reported instead of waiting. */
const MAX_WAIT_MS = 10_000;

const readPrompt = (ref: string) => readFileSync(join(repoRoot(), ref), 'utf8');

const failure = (err: unknown) => {
  if (!(err instanceof ProviderError)) return err;
  if (err.code === 'RATE_LIMIT' || err.code === 'QUOTA')
    return httpError(429, 'PROVIDER_RATE_LIMIT', { waitMs: err.retryAfterMs ?? null });
  if (err.code === 'AUTH' || err.code === 'NOT_FOUND') return httpError(409, 'PROVIDER_NOT_READY');
  return httpError(502, `PROVIDER_${err.code}`, { message: err.message });
};

/**
 * The reading assistant on the configured free provider (SPEC §12, §13.6): the tutor streams over SSE, summaries
 * and quizzes return validated JSON. The browser builds the context from the book it already has; the provider key
 * never leaves the server.
 */
export async function assistRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { providers } = ctx;

  const engineOrThrow = (): ProviderId => {
    const engine = providers.assistantEngine();
    if (!isProviderId(engine)) throw httpError(409, 'ASSISTANT_IS_LOCAL');
    if (!providers.view(engine).ready) throw httpError(409, 'PROVIDER_NOT_READY', { provider: engine });
    return engine;
  };

  app.post(`${API_PREFIX}/assist/tutor`, async (req, reply) => {
    const input = TutorEngineInputSchema.parse(req.body ?? {});
    const engine = providers.assistantEngine();
    const origin = req.headers.origin;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(origin && ctx.config.webOrigins.includes(origin)
        ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
        : {}),
    });
    const send = (event: ChatEvent) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const controller = new AbortController();
    res.on('close', () => controller.abort());

    if (!isProviderId(engine) || !providers.view(engine).ready) {
      send({ type: 'error', code: 'NO_ENGINE', message: 'No connected AI engine for the tutor.', retryable: false });
      res.end();
      return;
    }
    const tutor = createProviderTutorEngine({
      client: providers.client(engine),
      template: readPrompt(PROMPT_REFS.tutor_answer),
      beforeRequest: () => providers.acquire(engine, MAX_WAIT_MS),
      onError: (err) => {
        if (err instanceof ProviderError) providers.reportError(engine, err);
      },
    });
    let ok = false;
    for await (const event of tutor.streamChat(input, controller.signal)) {
      if (controller.signal.aborted) break;
      send(event);
      if (event.type === 'done') ok = true;
    }
    if (ok) providers.reportSuccess(engine);
    res.end();
  });

  /** Runs a JSON task (summary, quiz) through the provider engine: prompts/, JSON schema, validation, one repair. */
  async function runTask<T extends 'summary' | 'quiz'>(
    task: T,
    body: { sourceLang: string; targetLang: string; book: { title: string; authors: string[] } },
    input: Record<string, unknown>,
  ) {
    const engine = engineOrThrow();
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
      beforeRequest: () => providers.acquire(engine, MAX_WAIT_MS),
    });
    try {
      const res = await run.run<T>(batch, {});
      if (res.kind !== 'done') throw new Error('provider engines answer in real time');
      providers.reportSuccess(engine);
      return { ...res.output, engine, model: res.model ?? providers.view(engine).model };
    } catch (err) {
      if (err instanceof ProviderError) providers.reportError(engine, err);
      throw failure(err);
    }
  }

  app.post(`${API_PREFIX}/assist/summary`, async (req) => {
    const body = SummaryRequestSchema.parse(req.body ?? {});
    return runTask('summary', body, {
      kind: body.kind,
      passages: body.passages.map((p) => ({ label: p.label, src: p.src, tgt: p.tgt ?? '' })),
      glossary: body.glossary,
    });
  });

  app.post(`${API_PREFIX}/assist/quiz`, async (req) => {
    const body = QuizRequestSchema.parse(req.body ?? {});
    return runTask('quiz', body, {
      scope: body.scope,
      passages: body.passages.map((p) => ({ label: p.label, src: p.src, tgt: p.tgt ?? '' })),
      glossary: body.glossary,
    });
  });
}
