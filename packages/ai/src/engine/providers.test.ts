import type { AgentBatch } from '@dozabaneh/shared';
import { describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './limiter';
import { buildMessages, createProviderEngine, extractJson } from './provider-engine';
import { createProviderClient, PROVIDERS, ProviderError } from './providers';
import { validateResult } from './validate';

type FetchArgs = [string, RequestInit | undefined];

function fakeFetch(responses: (Response | ((args: FetchArgs) => Response))[]) {
  const calls: FetchArgs[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const next = responses.shift();
    if (!next) throw new Error('no more fake responses');
    return typeof next === 'function' ? next([url, init]) : next;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const completion = (content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) =>
  json({ model: 'm-1', choices: [{ message: { content } }], usage });

describe('provider client', () => {
  it('posts an OpenAI-style chat request with the key and JSON mode', async () => {
    const f = fakeFetch([completion('{"ok":true}')]);
    const client = createProviderClient({ provider: 'gemini', model: 'gemini-x', apiKey: 'k-123', fetch: f.fetch });
    const out = await client.chat([{ role: 'user', content: 'hi' }], { json: true });
    expect(out).toEqual({ text: '{"ok":true}', model: 'm-1', usage: { tokensIn: 10, tokensOut: 5 } });
    const [url, init] = f.calls[0] as FetchArgs;
    expect(url).toBe(`${PROVIDERS.gemini.baseUrl}/chat/completions`);
    const sentHeaders = init?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.Authorization).toBe('Bearer k-123');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: 'gemini-x', response_format: { type: 'json_object' } });
  });

  it('asks for JSON only through the prompt where the provider may not support response_format', async () => {
    const f = fakeFetch([completion('{}')]);
    await createProviderClient({ provider: 'openrouter', model: 'x:free', apiKey: 'k', fetch: f.fetch }).chat([], {
      json: true,
    });
    const body = JSON.parse(String((f.calls[0] as FetchArgs)[1]?.body));
    expect(body.response_format).toBeUndefined();
    const sentHeaders = (f.calls[0] as FetchArgs)[1]?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.['X-Title']).toBe('Dozabaneh');
  });

  it('needs no key for Ollama and honours a custom base URL', async () => {
    const f = fakeFetch([completion('ok')]);
    await createProviderClient({
      provider: 'ollama',
      model: 'llm',
      baseUrl: 'http://pc:11434/v1/',
      fetch: f.fetch,
    }).chat([]);
    const [url, init] = f.calls[0] as FetchArgs;
    expect(url).toBe('http://pc:11434/v1/chat/completions');
    const sentHeaders = init?.headers as Record<string, string> | undefined;
    expect(sentHeaders?.Authorization).toBeUndefined();
  });

  it.each([
    [json({ error: 'bad key' }, 401), 'AUTH', false],
    [json({ error: 'no model' }, 404), 'NOT_FOUND', false],
    [json({ error: 'slow down' }, 429, { 'retry-after': '7' }), 'RATE_LIMIT', true],
    [
      json({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded: requests per day' } }, 429),
      'QUOTA',
      true,
    ],
    [json({ error: 'busy' }, 503), 'OVERLOADED', true],
  ] as const)('maps HTTP errors (%#) to typed errors', async (res, code, retryable) => {
    const f = fakeFetch([res]);
    const err = await createProviderClient({ provider: 'gemini', model: 'm', apiKey: 'k', fetch: f.fetch })
      .chat([])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).code).toBe(code);
    expect((err as ProviderError).retryable).toBe(retryable);
    if (code === 'RATE_LIMIT') expect((err as ProviderError).retryAfterMs).toBe(7000);
  });

  it('reports network failures and empty answers', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(createProviderClient({ provider: 'ollama', model: 'm', fetch: down }).chat([])).rejects.toMatchObject({
      code: 'NETWORK',
    });
    const f = fakeFetch([json({ choices: [{ message: { content: '' } }] })]);
    await expect(
      createProviderClient({ provider: 'ollama', model: 'm', fetch: f.fetch }).chat([]),
    ).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('streams deltas and usage from server-sent events', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"سلام"}}]}',
      'data: {"choices":[{"delta":{"content":" دنیا"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    const f = fakeFetch([new Response(sse, { headers: { 'content-type': 'text/event-stream' } })]);
    const events = [];
    for await (const e of createProviderClient({ provider: 'gemini', model: 'm', apiKey: 'k', fetch: f.fetch }).stream(
      [],
    ))
      events.push(e);
    expect(events).toEqual([
      { type: 'delta', text: 'سلام' },
      { type: 'delta', text: ' دنیا' },
      { type: 'usage', usage: { tokensIn: 3, tokensOut: 2 } },
    ]);
    expect(JSON.parse(String((f.calls[0] as FetchArgs)[1]?.body)).stream).toBe(true);
  });

  it('lists models and marks free OpenRouter models', async () => {
    const f = fakeFetch([
      json({
        data: [
          { id: 'b/paid', pricing: { prompt: '0.000001', completion: '0.000002' } },
          { id: 'a/model:free', pricing: { prompt: '0', completion: '0' } },
        ],
      }),
    ]);
    const models = await createProviderClient({
      provider: 'openrouter',
      model: '',
      apiKey: 'k',
      fetch: f.fetch,
    }).listModels();
    expect(models).toEqual([
      { id: 'a/model:free', free: true },
      { id: 'b/paid', free: false },
    ]);
  });
});

describe('RateLimiter', () => {
  it('enforces requests per minute and per day, and blocks after a 429', () => {
    let now = 1_000_000;
    const lim = new RateLimiter({ rpm: 2, rpd: 3 }, () => now);
    expect(lim.waitMs()).toBe(0);
    lim.record();
    lim.record();
    expect(lim.waitMs()).toBe(60_000);
    expect(lim.state().reason).toBe('rpm');
    now += 60_001;
    expect(lim.waitMs()).toBe(0);
    lim.record();
    expect(lim.state().reason).toBe('rpd');
    expect(lim.state().usedToday).toBe(3);
    now += 24 * 3_600_000;
    expect(lim.waitMs()).toBe(0);
    lim.block(5_000);
    expect(lim.waitMs()).toBe(5_000);
    expect(lim.state().reason).toBe('blocked');
  });
});

describe('provider engine', () => {
  const batch: AgentBatch = {
    schemaVersion: 1,
    batchId: 'bt_p1',
    task: 'translate',
    promptRefs: ['prompts/translate.md', 'prompts/style/fa.md'],
    sourceLanguage: 'en',
    targetLanguage: 'fa',
    options: { ezafe: 'yeh', parenthetical: 'first_in_chapter' },
    book: { title: 'Small Machines', authors: [] },
    input: {
      glossary: [],
      alreadyIntroduced: [],
      context: { previous: [], next: [] },
      items: [
        { key: '01', type: 'h', src: 'Gears' },
        { key: '02', type: 'p', src: 'A gear has 12 teeth.' },
      ],
    },
    resultPath: 'data/x.json',
    createdAt: '2026-09-30T00:00:00.000Z',
  };
  const validate = (b: AgentBatch, raw: unknown) => validateResult(b, raw, { sourceLang: 'en', targetLang: 'fa' });
  const good = {
    items: [
      { key: '01', tgt: 'چرخ‌دنده‌ها' },
      { key: '02', tgt: 'یک چرخ‌دنده ۱۲ دندانه دارد.' },
    ],
  };

  it('sends the prompt, the schema and the batch payload, and returns the validated output', async () => {
    const f = fakeFetch([completion(`\`\`\`json\n${JSON.stringify(good)}\n\`\`\``)]);
    const before = vi.fn(async () => {});
    const engine = createProviderEngine({
      client: createProviderClient({ provider: 'gemini', model: 'm', apiKey: 'k', fetch: f.fetch }),
      systemPrompt: () => 'TASK PROMPT',
      validate,
      beforeRequest: before,
    });
    const result = await engine.run(batch, {});
    expect(result).toMatchObject({ kind: 'done', output: good, usage: { tokensIn: 10, tokensOut: 5 } });
    expect(before).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String((f.calls[0] as FetchArgs)[1]?.body)).messages;
    expect(sent[0].content).toContain('TASK PROMPT');
    expect(sent[0].content).toContain('JSON Schema');
    expect(JSON.parse(sent[1].content)).toMatchObject({
      task: 'translate',
      input: { items: batch.input && (batch.input as { items: unknown[] }).items },
    });
    expect(sent[1].content).not.toContain('resultPath');
  });

  it('repairs once with the validation errors, then succeeds', async () => {
    const f = fakeFetch([
      completion(JSON.stringify({ items: [{ key: '01', tgt: 'چرخ‌دنده‌ها' }] })),
      completion(JSON.stringify(good)),
    ]);
    const engine = createProviderEngine({
      client: createProviderClient({ provider: 'gemini', model: 'm', apiKey: 'k', fetch: f.fetch }),
      systemPrompt: () => 'P',
      validate,
    });
    const result = await engine.run(batch, {});
    expect(result.kind).toBe('done');
    const second = JSON.parse(String((f.calls[1] as FetchArgs)[1]?.body)).messages;
    expect(second.at(-1).content).toContain('missing_key');
    expect(second.at(-1).content).toContain('[key 02]');
  });

  it('gives up with BAD_RESPONSE after the repair round', async () => {
    const f = fakeFetch([completion('not json at all'), completion('still not json')]);
    const engine = createProviderEngine({
      client: createProviderClient({ provider: 'ollama', model: 'm', fetch: f.fetch }),
      systemPrompt: () => 'P',
      validate,
    });
    await expect(engine.run(batch, {})).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('extracts JSON from chatty answers', () => {
    expect(extractJson('Here you go: {"a": 1} hope it helps')).toEqual({ a: 1 });
    expect(() => extractJson('nothing here')).toThrow();
    expect(buildMessages(batch, 'S')).toHaveLength(2);
  });
});
