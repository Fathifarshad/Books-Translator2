/**
 * Free OpenAI-compatible providers (SPEC §10.5): Google Gemini (free tier), Ollama (local, offline) and OpenRouter
 * (free models, one-click key). One fetch-based client talks to all of them — no SDK, so it runs in Node and tests
 * can inject a fake `fetch`. Model ids and free-tier limits change often, so both are settings, not constants.
 */
import { isProviderId, PROVIDER_IDS, type ProviderId } from '@dozabaneh/shared';

export { isProviderId, PROVIDER_IDS, type ProviderId };

export interface ProviderPreset {
  id: ProviderId;
  baseUrl: string;
  needsKey: boolean;
  /** Where the user gets a key (opened from the settings page). */
  keyUrl?: string;
  /** Suggested model when the user has not picked one ('' = pick from the provider's list). */
  defaultModel: string;
  /** Conservative defaults; editable per provider in settings. */
  limits: { rpm: number; rpd: number };
  /** How JSON output is requested: OpenAI `response_format` json_object, or only through the prompt. */
  jsonMode: 'json_object' | 'prompt';
  /** Request timeout: local models on a CPU need much longer. */
  timeoutMs: number;
  /** Source words per translate chunk / edit unit (smaller for slow local models). */
  chunkWords?: { translate: number; edit: number };
  /** Preferred models, best first, when the user has not picked one (matched against the provider's list). */
  preferredModels: RegExp[];
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  gemini: {
    id: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-flash-lite-latest',
    limits: { rpm: 10, rpd: 400 },
    jsonMode: 'json_object',
    timeoutMs: 180_000,
    preferredModels: [/^gemini-flash-lite-latest$/u, /^gemini-flash-latest$/u, /flash-lite/u, /flash/u],
  },
  ollama: {
    id: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    needsKey: false,
    defaultModel: '',
    limits: { rpm: 60, rpd: 100_000 },
    jsonMode: 'json_object',
    timeoutMs: 15 * 60_000,
    chunkWords: { translate: 600, edit: 800 },
    preferredModels: [/aya/u, /gemma/u, /qwen/u, /llama/u, /mistral/u],
  },
  openrouter: {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    defaultModel: '',
    limits: { rpm: 15, rpd: 45 },
    jsonMode: 'prompt',
    timeoutMs: 180_000,
    preferredModels: [/gemini.*flash.*:free$/u, /deepseek.*:free$/u, /llama.*70b.*:free$/u, /qwen.*:free$/u, /:free$/u],
  },
};

/**
 * A sensible model when the user has not chosen one: the first preferred pattern that matches a listed model. For
 * OpenRouter only free models qualify. Returns '' when nothing fits (the user picks from the list).
 */
export function pickDefaultModel(provider: ProviderId, models: ProviderModel[]): string {
  const candidates = provider === 'openrouter' ? models.filter((m) => m.free) : models;
  const preset = PROVIDERS[provider];
  if (preset.defaultModel && candidates.some((m) => m.id === preset.defaultModel)) return preset.defaultModel;
  for (const re of preset.preferredModels) {
    const hit = candidates.find((m) => re.test(m.id) && !/embed|vision|guard|tts|image|audio/iu.test(m.id));
    if (hit) return hit.id;
  }
  return provider === 'ollama' ? (candidates.find((m) => !/embed/iu.test(m.id))?.id ?? '') : '';
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderUsage {
  tokensIn: number;
  tokensOut: number;
}

export type ProviderErrorCode =
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'QUOTA'
  | 'OVERLOADED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'BAD_RESPONSE'
  | 'UNKNOWN';

/** A typed provider failure; `retryAfterMs` tells the scheduler when to try again. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly status = 0,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }

  get retryable(): boolean {
    return ['RATE_LIMIT', 'QUOTA', 'OVERLOADED', 'NETWORK', 'TIMEOUT'].includes(this.code);
  }
}

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Per request (default: the preset's timeout). */
  timeoutMs?: number;
}

export interface ChatOptions {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderModel {
  id: string;
  /** True when the provider reports it as free (OpenRouter pricing). */
  free?: boolean;
}

export interface ProviderClient {
  readonly provider: ProviderId;
  readonly model: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<{ text: string; usage?: ProviderUsage; model: string }>;
  stream(
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): AsyncIterable<{ type: 'delta'; text: string } | { type: 'usage'; usage: ProviderUsage }>;
  listModels(): Promise<ProviderModel[]>;
}

const DAY_HINT = /per[_ ]?day|daily|RESOURCE_EXHAUSTED.*(day|Day)|quota/iu;

function retryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

async function toError(res: Response): Promise<ProviderError> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    // ignore
  }
  const detail = body.slice(0, 300).replace(/\s+/gu, ' ');
  if (res.status === 401 || res.status === 403)
    return new ProviderError('AUTH', `The provider rejected the key (${res.status}): ${detail}`, res.status);
  if (res.status === 404) return new ProviderError('NOT_FOUND', `Model or endpoint not found (404): ${detail}`, 404);
  if (res.status === 429) {
    const daily = DAY_HINT.test(body);
    return new ProviderError(
      daily ? 'QUOTA' : 'RATE_LIMIT',
      `${daily ? 'Daily free quota used up' : 'Rate limited'} (429): ${detail}`,
      429,
      retryAfter(res) ?? (daily ? 60 * 60_000 : 20_000),
    );
  }
  if (res.status >= 500)
    return new ProviderError(
      'OVERLOADED',
      `Provider error ${res.status}: ${detail}`,
      res.status,
      retryAfter(res) ?? 15_000,
    );
  return new ProviderError('UNKNOWN', `Unexpected response ${res.status}: ${detail}`, res.status);
}

export function createProviderClient(config: ProviderConfig): ProviderClient {
  const preset = PROVIDERS[config.provider];
  const base = (config.baseUrl || preset.baseUrl).replace(/\/+$/u, '');
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? preset.timeoutMs;
  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...(config.provider === 'openrouter' ? { 'X-Title': 'Dozabaneh' } : {}),
  });

  async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: merged,
      });
    } catch (err) {
      if (timeout.aborted) throw new ProviderError('TIMEOUT', `No answer within ${Math.round(timeoutMs / 1000)} s.`);
      if (signal?.aborted) throw err;
      throw new ProviderError('NETWORK', `Cannot reach ${base}: ${(err as Error).message}`);
    }
    if (!res.ok) throw await toError(res);
    return res;
  }

  const requestBody = (messages: ChatMessage[], opts: ChatOptions, stream: boolean) => ({
    model: config.model,
    messages,
    temperature: opts.temperature ?? 0.3,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.json && preset.jsonMode === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  });

  return {
    provider: config.provider,
    model: config.model,

    async chat(messages, opts = {}) {
      const res = await post('/chat/completions', requestBody(messages, opts, false), opts.signal);
      const data = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
        error?: { message?: string };
      } | null;
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        throw new ProviderError(
          'BAD_RESPONSE',
          `Empty answer from the model${data?.error?.message ? `: ${data.error.message}` : ''}.`,
        );
      }
      return {
        text,
        model: data?.model ?? config.model,
        ...(data?.usage
          ? { usage: { tokensIn: data.usage.prompt_tokens ?? 0, tokensOut: data.usage.completion_tokens ?? 0 } }
          : {}),
      };
    },

    async *stream(messages, opts = {}) {
      const res = await post('/chat/completions', requestBody(messages, opts, true), opts.signal);
      if (!res.body) throw new ProviderError('BAD_RESPONSE', 'The provider sent no stream.');
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          let data: {
            choices?: { delta?: { content?: string | null } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
            error?: { message?: string };
          };
          try {
            data = JSON.parse(payload);
          } catch {
            continue;
          }
          if (data.error) throw new ProviderError('UNKNOWN', data.error.message ?? 'stream error');
          const text = data.choices?.[0]?.delta?.content;
          if (text) yield { type: 'delta', text };
          if (data.usage)
            yield {
              type: 'usage',
              usage: { tokensIn: data.usage.prompt_tokens ?? 0, tokensOut: data.usage.completion_tokens ?? 0 },
            };
        }
      }
    },

    async listModels() {
      let res: Response;
      try {
        res = await doFetch(`${base}/models`, { headers: headers(), signal: AbortSignal.timeout(20_000) });
      } catch (err) {
        throw new ProviderError('NETWORK', `Cannot reach ${base}: ${(err as Error).message}`);
      }
      if (!res.ok) throw await toError(res);
      const data = (await res.json()) as {
        data?: { id: string; pricing?: { prompt?: string; completion?: string } }[];
        models?: { name: string }[];
      };
      const list: { id: string; pricing?: { prompt?: string; completion?: string } }[] =
        data.data ?? data.models?.map((m) => ({ id: m.name })) ?? [];
      return list
        .map((m) => ({
          id: m.id.replace(/^models\//u, ''),
          ...(m.pricing ? { free: Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 } : {}),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
  };
}
