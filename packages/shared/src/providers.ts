import { z } from 'zod';

/**
 * Free AI providers (Phase 4): Google Gemini (free tier), Ollama (local) and OpenRouter (free models, one-click
 * connect). Shared by the API (settings, runner) and the web app (settings page, wizard, dashboard).
 */
export const PROVIDER_IDS = ['gemini', 'ollama', 'openrouter'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(id: string): id is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

export const ProviderLimitsSchema = z.object({
  rpm: z.number().int().min(1).max(1000),
  rpd: z.number().int().min(1).max(1_000_000),
});
export type ProviderLimits = z.infer<typeof ProviderLimitsSchema>;

/** PUT /settings/providers/:id — omitted fields stay as they are; `null` resets to the default (or removes the key). */
export const ProviderUpdateSchema = z.object({
  apiKey: z.string().trim().min(8).max(500).nullable().optional(),
  model: z.string().trim().max(200).optional(),
  baseUrl: z.url().max(300).nullable().optional(),
  limits: ProviderLimitsSchema.nullable().optional(),
});
export type ProviderUpdate = z.infer<typeof ProviderUpdateSchema>;

export type ProviderProblemCode = 'AUTH' | 'NOT_FOUND' | 'NETWORK' | 'QUOTA' | 'RATE_LIMIT' | 'OTHER';

export interface ProviderProblem {
  code: ProviderProblemCode;
  message: string;
  at: string;
  /** Blocking problems (rejected key, unknown model) stop the provider until its settings change. */
  blocking: boolean;
}

export interface ProviderUsage {
  usedLastMinute: number;
  usedToday: number;
  /** ISO time when the next request may start (null = now). */
  waitUntil: string | null;
  reason: 'rpm' | 'rpd' | 'blocked' | null;
}

/** What the settings page, the wizard and the dashboard know about a provider (never the key itself). */
export interface ProviderView {
  id: ProviderId;
  needsKey: boolean;
  /** Where the user creates a key (opened in a new tab). */
  keyUrl: string | null;
  /** One-click connection (OAuth PKCE) is available. */
  oneClick: boolean;
  hasKey: boolean;
  /** Last characters of the stored key, e.g. «…x7Qa». */
  keyHint: string | null;
  /** A key is stored but cannot be decrypted (APP_SECRET changed): enter it again. */
  keyUnreadable: boolean;
  connectedVia: 'oauth' | 'manual' | null;
  model: string;
  baseUrl: string;
  defaultBaseUrl: string;
  limits: ProviderLimits;
  defaultLimits: ProviderLimits;
  usage: ProviderUsage;
  problem: ProviderProblem | null;
  /** Key (when needed) and model are set and nothing blocking is reported: jobs can run. */
  ready: boolean;
}

export interface ProviderModelInfo {
  id: string;
  free?: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  model?: string;
  models?: ProviderModelInfo[];
  latencyMs?: number;
  /** A short sample answer from the model (proves the model runs). */
  sample?: string;
  error?: { code: string; message: string };
}
