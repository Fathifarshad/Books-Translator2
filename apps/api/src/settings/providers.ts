import {
  createProviderClient,
  type LimiterSnapshot,
  PROVIDERS,
  type ProviderClient,
  ProviderError,
  type ProviderModel,
  pickDefaultModel,
  RateLimiter,
} from '@dozabaneh/ai';
import {
  type AssistantEngine,
  isProviderId,
  type PipelineProviderStatus,
  PROVIDER_IDS,
  type ProviderId,
  type ProviderLimits,
  type ProviderProblem,
  type ProviderProblemCode,
  type ProviderTestResult,
  type ProviderUpdate,
  type ProviderView,
} from '@dozabaneh/shared';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { keyHint, type SecretBox } from './secrets';
import { getSetting, setSetting } from './store';

/** What is stored per provider (`provider:<id>`); the key only encrypted. */
interface StoredProvider {
  keyEnc?: string;
  keyHint?: string;
  connectedVia?: 'oauth' | 'manual';
  model?: string;
  baseUrl?: string;
  limits?: ProviderLimits;
  problem?: ProviderProblem;
}

export type ErrorOutcome = 'requeue' | 'fail';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Free providers on the server (SPEC §16: keys never reach the client): settings with encrypted keys, one rate
 * limiter per provider (persisted, so a restart remembers today's requests), clients for the runner and the tutor,
 * and the problems shown in Settings and on the dashboard.
 */
export class ProviderService {
  private readonly limiters = new Map<ProviderId, RateLimiter>();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly box: SecretBox,
    /** Injected in tests; defaults to the global fetch. */
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private stored(id: ProviderId): StoredProvider {
    return getSetting<StoredProvider>(this.db, `provider:${id}`) ?? {};
  }

  private save(id: ProviderId, next: StoredProvider): void {
    setSetting(this.db, `provider:${id}`, next);
  }

  defaultBaseUrl(id: ProviderId): string {
    const env = { gemini: this.config.GEMINI_BASE_URL, ollama: this.config.OLLAMA_BASE_URL };
    const fromEnv = id === 'openrouter' ? this.config.OPENROUTER_BASE_URL : env[id];
    return (fromEnv || PROVIDERS[id].baseUrl).replace(/\/+$/u, '');
  }

  baseUrl(id: ProviderId): string {
    return (this.stored(id).baseUrl || this.defaultBaseUrl(id)).replace(/\/+$/u, '');
  }

  private limits(id: ProviderId): ProviderLimits {
    return this.stored(id).limits ?? PROVIDERS[id].limits;
  }

  /** The decrypted key; null when none is stored; undefined when it cannot be decrypted. */
  private apiKey(id: ProviderId): string | null | undefined {
    const enc = this.stored(id).keyEnc;
    if (!enc) return null;
    return this.box.decrypt(enc) ?? undefined;
  }

  limiter(id: ProviderId): RateLimiter {
    let lim = this.limiters.get(id);
    if (!lim) {
      lim = new RateLimiter(this.limits(id));
      const snap = getSetting<LimiterSnapshot>(this.db, `limiter:${id}`);
      if (snap) lim.restore(snap);
      this.limiters.set(id, lim);
    }
    return lim;
  }

  private persistLimiter(id: ProviderId): void {
    setSetting(this.db, `limiter:${id}`, this.limiter(id).snapshot());
  }

  view(id: ProviderId): ProviderView {
    const s = this.stored(id);
    const preset = PROVIDERS[id];
    const key = this.apiKey(id);
    const state = this.limiter(id).state();
    const hasKey = typeof key === 'string';
    const model = s.model ?? '';
    return {
      id,
      needsKey: preset.needsKey,
      keyUrl: preset.keyUrl ?? null,
      oneClick: id === 'openrouter',
      hasKey,
      keyHint: hasKey ? (s.keyHint ?? null) : null,
      keyUnreadable: key === undefined,
      connectedVia: hasKey ? (s.connectedVia ?? 'manual') : null,
      model,
      baseUrl: this.baseUrl(id),
      defaultBaseUrl: this.defaultBaseUrl(id),
      limits: this.limits(id),
      defaultLimits: preset.limits,
      usage: {
        usedLastMinute: state.usedLastMinute,
        usedToday: state.usedToday,
        waitUntil: state.blockedUntil ? new Date(state.blockedUntil).toISOString() : null,
        reason: state.reason,
      },
      problem: s.problem ?? null,
      ready: (!preset.needsKey || hasKey) && model !== '' && !s.problem?.blocking,
    };
  }

  views(): ProviderView[] {
    return PROVIDER_IDS.map((id) => this.view(id));
  }

  /** Engine of the tutor, summaries and quizzes (Settings); defaults to TUTOR_ENGINE, else the offline mock. */
  assistantEngine(): AssistantEngine {
    const stored = getSetting<AssistantEngine>(this.db, 'assistant:engine');
    if (stored) return stored;
    const env = this.config.TUTOR_ENGINE;
    return isProviderId(env) ? env : 'mock';
  }

  setAssistantEngine(engine: AssistantEngine): void {
    setSetting(this.db, 'assistant:engine', engine);
  }

  assistant(): { engine: AssistantEngine; ready: boolean } {
    const engine = this.assistantEngine();
    return { engine, ready: engine === 'mock' || this.view(engine).ready };
  }

  /** Dashboard block for the providers a pipeline uses. */
  status(engines: string[]): PipelineProviderStatus[] {
    return [...new Set(engines)].filter(isProviderId).map((id) => {
      const v = this.view(id);
      return { id, model: v.model, ready: v.ready, limits: v.limits, usage: v.usage, problem: v.problem };
    });
  }

  update(id: ProviderId, patch: ProviderUpdate, via: 'manual' | 'oauth' = 'manual'): ProviderView {
    const next: StoredProvider = { ...this.stored(id) };
    if (patch.apiKey !== undefined) {
      if (patch.apiKey === null) {
        delete next.keyEnc;
        delete next.keyHint;
        delete next.connectedVia;
      } else {
        next.keyEnc = this.box.encrypt(patch.apiKey);
        next.keyHint = keyHint(patch.apiKey);
        next.connectedVia = via;
      }
    }
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.baseUrl !== undefined) {
      if (patch.baseUrl === null) delete next.baseUrl;
      else next.baseUrl = patch.baseUrl.replace(/\/+$/u, '');
    }
    if (patch.limits !== undefined) {
      if (patch.limits === null) delete next.limits;
      else next.limits = patch.limits;
    }
    // New settings deserve a fresh try: clear the last problem and any block after a 429.
    delete next.problem;
    this.save(id, next);
    const lim = this.limiter(id);
    lim.setLimits(next.limits ?? PROVIDERS[id].limits);
    lim.unblock();
    this.persistLimiter(id);
    return this.view(id);
  }

  client(id: ProviderId, model?: string): ProviderClient {
    const key = this.apiKey(id);
    if (PROVIDERS[id].needsKey && typeof key !== 'string') {
      throw new ProviderError('AUTH', key === undefined ? 'The stored key cannot be read; enter it again.' : 'No key.');
    }
    return createProviderClient({
      provider: id,
      model: model ?? this.stored(id).model ?? '',
      baseUrl: this.baseUrl(id),
      ...(typeof key === 'string' ? { apiKey: key } : {}),
      ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}),
    });
  }

  async models(id: ProviderId): Promise<ProviderModel[]> {
    return this.client(id, '').listModels();
  }

  /**
   * Checks the key and the model with a tiny real request, and picks a default model when none is chosen. Counts
   * toward the provider's limits like any request.
   */
  async test(id: ProviderId): Promise<ProviderTestResult> {
    let models: ProviderModel[] | undefined;
    try {
      models = await this.models(id);
      let model = this.stored(id).model ?? '';
      if (!model) {
        model = pickDefaultModel(id, models);
        if (model) this.save(id, { ...this.stored(id), model });
      }
      if (!model) {
        return {
          ok: false,
          models,
          error: { code: 'NO_MODEL', message: 'No suitable model found; pick one from the list.' },
        };
      }
      const started = Date.now();
      this.limiter(id).record();
      this.persistLimiter(id);
      const answer = await this.client(id, model).chat([{ role: 'user', content: 'Reply with the single word: OK' }], {
        temperature: 0,
      });
      this.reportSuccess(id);
      return { ok: true, model, models, latencyMs: Date.now() - started, sample: answer.text.trim().slice(0, 80) };
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError('UNKNOWN', (err as Error).message);
      this.reportError(id, e);
      return { ok: false, ...(models ? { models } : {}), error: { code: e.code, message: e.message } };
    }
  }

  /** Providers whose jobs must not be claimed now (not ready, or waiting for their limits). */
  blockedEngines(): ProviderId[] {
    return PROVIDER_IDS.filter((id) => !this.view(id).ready || this.limiter(id).waitMs() > 0);
  }

  /** Milliseconds until the first blocked-but-ready provider may run again (for the runner's next poll). */
  nextWakeMs(): number | null {
    const waits = PROVIDER_IDS.filter((id) => this.view(id).ready)
      .map((id) => this.limiter(id).waitMs())
      .filter((w) => w > 0);
    return waits.length ? Math.min(...waits) : null;
  }

  /**
   * Waits for the limiter (up to `maxWaitMs`) and counts the request. Longer waits throw RATE_LIMIT so the job goes
   * back to the queue instead of holding the runner.
   */
  async acquire(id: ProviderId, maxWaitMs: number, onWait?: () => void): Promise<void> {
    const lim = this.limiter(id);
    let wait = lim.waitMs();
    while (wait > 0) {
      if (wait > maxWaitMs) {
        const state = lim.state();
        throw new ProviderError(
          state.reason === 'rpd' ? 'QUOTA' : 'RATE_LIMIT',
          `Waiting for the ${state.reason === 'rpd' ? 'daily' : 'per-minute'} limit of ${id}.`,
          0,
          wait,
        );
      }
      onWait?.();
      await sleep(Math.min(wait, 5_000));
      wait = lim.waitMs();
    }
    lim.record();
    this.persistLimiter(id);
  }

  reportSuccess(id: ProviderId): void {
    const s = this.stored(id);
    if (s.problem) {
      delete s.problem;
      this.save(id, s);
    }
  }

  /**
   * Records a provider failure. Rejected keys and unknown models stop the provider until its settings change
   * (jobs wait instead of failing one by one); rate limits and outages block it for a while; a bad answer is a
   * normal job failure (retried up to the attempt limit).
   */
  reportError(id: ProviderId, err: ProviderError): ErrorOutcome {
    const blocking = err.code === 'AUTH' || err.code === 'NOT_FOUND';
    const codes: Partial<Record<ProviderError['code'], ProviderProblemCode>> = {
      AUTH: 'AUTH',
      NOT_FOUND: 'NOT_FOUND',
      NETWORK: 'NETWORK',
      QUOTA: 'QUOTA',
      RATE_LIMIT: 'RATE_LIMIT',
    };
    // Our own limiter's wait (status 0) is expected, not a problem worth showing.
    if (err.status !== 0 || !['RATE_LIMIT', 'QUOTA'].includes(err.code)) {
      this.save(id, {
        ...this.stored(id),
        problem: {
          code: codes[err.code] ?? 'OTHER',
          message: err.message.slice(0, 300),
          at: new Date().toISOString(),
          blocking,
        },
      });
    }
    if (blocking) return 'requeue';
    if (['RATE_LIMIT', 'QUOTA', 'OVERLOADED', 'NETWORK'].includes(err.code)) {
      this.limiter(id).block(err.retryAfterMs ?? 30_000);
      this.persistLimiter(id);
      return 'requeue';
    }
    return 'fail';
  }
}
