/**
 * Typed provider failures, shared by every client (OpenAI-compatible HTTP providers and the Claude Code CLI).
 * Lives in its own module so a client can throw them without importing the client factory it is registered in.
 */
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
