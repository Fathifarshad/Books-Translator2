/**
 * Request limiter for free tiers: requests per minute and per day (rolling windows), plus a block after a 429 until
 * the provider's `retry-after`. The scheduler asks `waitMs()` before starting a request and never busy-waits.
 */
export interface Limits {
  rpm: number;
  rpd: number;
}

export interface LimiterState {
  usedLastMinute: number;
  usedToday: number;
  limits: Limits;
  blockedUntil: number | null;
  reason: 'rpm' | 'rpd' | 'blocked' | null;
}

export interface LimiterSnapshot {
  starts: number[];
  blockedUntil: number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export class RateLimiter {
  private starts: number[] = [];
  private blockedUntil = 0;

  constructor(
    private limits: Limits,
    private readonly now: () => number = Date.now,
  ) {}

  setLimits(limits: Limits): void {
    this.limits = limits;
  }

  private prune(t: number): void {
    const since = t - DAY;
    let i = 0;
    while (i < this.starts.length && (this.starts[i] as number) <= since) i++;
    if (i) this.starts.splice(0, i);
  }

  /** Milliseconds until the next request may start (0 = now). */
  waitMs(): number {
    const t = this.now();
    this.prune(t);
    if (this.blockedUntil > t) return this.blockedUntil - t;
    if (this.starts.length >= this.limits.rpd)
      return (this.starts[this.starts.length - this.limits.rpd] as number) + DAY - t;
    const lastMinute = this.starts.filter((s) => s > t - MINUTE);
    if (lastMinute.length >= this.limits.rpm)
      return (lastMinute[lastMinute.length - this.limits.rpm] as number) + MINUTE - t;
    return 0;
  }

  /** Call right before sending a request. */
  record(): void {
    this.starts.push(this.now());
  }

  /** After a 429: nothing is sent before `ms` from now. */
  block(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
  }

  /** Lifts a block (after the user changed the provider's settings). */
  unblock(): void {
    this.blockedUntil = 0;
  }

  /** Persistable state, so a restart does not forget today's requests (at most `max` recent starts). */
  snapshot(max = 2000): LimiterSnapshot {
    this.prune(this.now());
    return { starts: this.starts.slice(-max), blockedUntil: this.blockedUntil };
  }

  restore(s: LimiterSnapshot): void {
    this.starts = [...s.starts].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    this.blockedUntil = Number.isFinite(s.blockedUntil) ? s.blockedUntil : 0;
    this.prune(this.now());
  }

  state(): LimiterState {
    const t = this.now();
    this.prune(t);
    const wait = this.waitMs();
    const usedLastMinute = this.starts.filter((s) => s > t - MINUTE).length;
    return {
      usedLastMinute,
      usedToday: this.starts.length,
      limits: this.limits,
      blockedUntil: wait > 0 ? t + wait : null,
      reason:
        wait <= 0 ? null : this.blockedUntil > t ? 'blocked' : this.starts.length >= this.limits.rpd ? 'rpd' : 'rpm',
    };
  }
}
