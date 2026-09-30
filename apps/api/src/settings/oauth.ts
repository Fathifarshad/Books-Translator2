import { createHash, randomBytes } from 'node:crypto';
import { ProviderError } from '@dozabaneh/ai';

/**
 * One-click connection to OpenRouter (OAuth PKCE): the browser goes to OpenRouter's authorization page, the user
 * clicks «Authorize», OpenRouter sends the browser back with a one-time code, and the server exchanges it (with the
 * verifier only the server knows) for an API key. The user never copies or sees a key.
 */
const TTL_MS = 10 * 60_000;

const base64url = (b: Buffer) => b.toString('base64url');

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

interface Pending {
  verifier: string;
  returnTo: string;
  at: number;
}

/** Pending authorizations, keyed by a random state; single use, expire after 10 minutes. */
export class OAuthFlows {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly now: () => number = Date.now) {}

  begin(returnTo: string): { state: string; challenge: string } {
    this.prune();
    const { verifier, challenge } = pkcePair();
    const state = base64url(randomBytes(16));
    this.pending.set(state, { verifier, returnTo, at: this.now() });
    return { state, challenge };
  }

  take(state: string): Pending | null {
    this.prune();
    const p = this.pending.get(state) ?? null;
    this.pending.delete(state);
    return p;
  }

  private prune(): void {
    const limit = this.now() - TTL_MS;
    for (const [k, v] of this.pending) if (v.at < limit) this.pending.delete(k);
  }
}

export function authorizeUrl(authUrl: string, callbackUrl: string, challenge: string): string {
  const url = new URL(authUrl);
  url.searchParams.set('callback_url', callbackUrl);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** POST {apiBase}/auth/keys → { key }. */
export async function exchangeCode(
  apiBase: string,
  code: string,
  verifier: string,
  doFetch: typeof fetch = fetch,
): Promise<string> {
  let res: Response;
  try {
    res = await doFetch(`${apiBase.replace(/\/+$/u, '')}/auth/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ProviderError('NETWORK', `Cannot reach OpenRouter: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new ProviderError(
      res.status === 400 || res.status === 403 ? 'AUTH' : 'UNKNOWN',
      `Key exchange failed (${res.status}): ${detail}`,
      res.status,
    );
  }
  const data = (await res.json().catch(() => null)) as { key?: unknown } | null;
  if (typeof data?.key !== 'string' || data.key.length < 8) {
    throw new ProviderError('BAD_RESPONSE', 'OpenRouter returned no key.');
  }
  return data.key;
}
