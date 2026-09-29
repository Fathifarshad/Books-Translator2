import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mockOutput } from '@dozabaneh/ai';
import type { AgentBatch } from '@dozabaneh/shared';

/**
 * A fake OpenAI-compatible provider for tests and e2e (never used in production): Gemini under /gemini, Ollama
 * under /ollama/v1 (no key), OpenRouter under /openrouter/api/v1 with its OAuth pages (/openrouter/auth). Chat
 * answers are the mock engine's output for the batch in the request, so the whole pipeline runs offline.
 */
export interface FakeFailure {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FakeProvider {
  url: string;
  server: Server;
  /** Answers returned (once each, in order) before normal answers — e.g. a 429. */
  failures: FakeFailure[];
  /** Replace the next answers' content (e.g. invalid JSON to exercise the repair round). */
  contents: string[];
  keys: Set<string>;
  requests: { path: string; auth: string | null; body: unknown }[];
  close(): Promise<void>;
}

export const FAKE_KEY = 'fake-key-0123456789';

const MODELS = {
  gemini: [{ id: 'models/gemini-flash-lite-latest' }, { id: 'models/gemini-pro-latest' }],
  ollama: [{ id: 'aya-expanse:8b' }, { id: 'nomic-embed-text:latest' }],
  openrouter: [
    { id: 'vendor/big-model', pricing: { prompt: '0.000002', completion: '0.000004' } },
    { id: 'vendor/good-model:free', pricing: { prompt: '0', completion: '0' } },
  ],
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** The batch sent by the provider engine (first user message), rebuilt as an envelope for mockOutput. */
function batchFrom(messages: { role: string; content: string }[]): AgentBatch | null {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return null;
  try {
    const payload = JSON.parse(first.content) as Record<string, unknown>;
    if (typeof payload.task !== 'string') return null;
    return {
      schemaVersion: 1,
      batchId: 'bt_fake',
      promptRefs: [],
      resultPath: '',
      createdAt: new Date(0).toISOString(),
      ...payload,
    } as unknown as AgentBatch;
  } catch {
    return null;
  }
}

function answerFor(messages: { role: string; content: string }[]): string {
  const batch = batchFrom(messages);
  if (batch) {
    const { schemaVersion: _v, batchId: _b, ...output } = mockOutput(batch) as Record<string, unknown>;
    return JSON.stringify(output);
  }
  return 'OK';
}

export async function startFakeProvider(port = 0, host = '127.0.0.1'): Promise<FakeProvider> {
  const codes = new Map<string, string>(); // code → PKCE challenge
  const state: Omit<FakeProvider, 'url' | 'server' | 'close'> = {
    failures: [],
    contents: [],
    keys: new Set([FAKE_KEY]),
    requests: [],
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const path = url.pathname;
      const raw = req.method === 'POST' ? await readBody(req) : '';
      let body: unknown = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      const auth = req.headers.authorization ?? null;
      state.requests.push({ path, auth, body });

      if (path === '/__health') return sendJson(res, 200, { ok: true });
      // Test control (e2e): queue failures or replacement contents.
      if (path === '/__control' && req.method === 'POST') {
        const b = (body ?? {}) as { failures?: FakeFailure[]; contents?: string[]; reset?: boolean };
        if (b.reset) {
          state.failures.length = 0;
          state.contents.length = 0;
        }
        state.failures.push(...(b.failures ?? []));
        state.contents.push(...(b.contents ?? []));
        return sendJson(res, 200, { ok: true });
      }

      // OpenRouter's authorization page: the user clicks «Authorize» and returns with a one-time code.
      if (path === '/openrouter/auth') {
        const callback = url.searchParams.get('callback_url') ?? '';
        const challenge = url.searchParams.get('code_challenge') ?? '';
        const code = randomBytes(8).toString('hex');
        codes.set(code, challenge);
        const target = new URL(callback);
        target.searchParams.set('code', code);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          `<!doctype html><html lang="en"><head><title>Fake OpenRouter</title></head><body><main><h1>Authorize Dozabaneh</h1><a id="authorize" href="${target.toString().replace(/"/gu, '&quot;')}">Authorize</a> <a id="deny" href="${callback}">Deny</a></main></body></html>`,
        );
        return;
      }
      if (path === '/openrouter/api/v1/auth/keys' && req.method === 'POST') {
        const b = (body ?? {}) as { code?: string; code_verifier?: string };
        const challenge = b.code ? codes.get(b.code) : undefined;
        if (b.code) codes.delete(b.code);
        const expected = createHash('sha256')
          .update(b.code_verifier ?? '')
          .digest('base64url');
        if (!challenge || challenge !== expected) return sendJson(res, 403, { error: { message: 'invalid code' } });
        const key = `sk-or-fake-${randomBytes(6).toString('hex')}`;
        state.keys.add(key);
        return sendJson(res, 200, { key });
      }

      const provider = path.startsWith('/gemini')
        ? 'gemini'
        : path.startsWith('/ollama')
          ? 'ollama'
          : path.startsWith('/openrouter')
            ? 'openrouter'
            : null;
      if (!provider) return sendJson(res, 404, { error: { message: 'not found' } });
      const keyOk = provider === 'ollama' || (auth?.startsWith('Bearer ') && state.keys.has(auth.slice(7)));

      if (path.endsWith('/models') && req.method === 'GET') {
        if (provider === 'gemini' && !keyOk) return sendJson(res, 401, { error: { message: 'API key not valid' } });
        return sendJson(res, 200, { object: 'list', data: MODELS[provider] });
      }
      if (path.endsWith('/chat/completions') && req.method === 'POST') {
        if (!keyOk) return sendJson(res, 401, { error: { message: 'API key not valid' } });
        const failure = state.failures.shift();
        if (failure) return sendJson(res, failure.status, failure.body ?? { error: 'fail' }, failure.headers);
        const b = body as { model?: string; messages?: { role: string; content: string }[]; stream?: boolean };
        const content = state.contents.shift() ?? answerFor(b.messages ?? []);
        const usage = { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(content.length / 4) };
        if (b.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const piece of content.match(/[\s\S]{1,12}/gu) ?? []) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
          res.end('data: [DONE]\n\n');
          return;
        }
        return sendJson(res, 200, {
          id: 'cmpl-fake',
          model: b.model ?? 'fake',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage,
        });
      }
      return sendJson(res, 404, { error: { message: 'not found' } });
    })().catch((err: unknown) => {
      sendJson(res, 500, { error: { message: (err as Error).message } });
    });
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  return {
    ...state,
    url: `http://${host}:${actual}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
