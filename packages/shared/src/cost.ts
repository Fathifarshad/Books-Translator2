import { z } from 'zod';
import type { ModelCost } from './providers';

/**
 * What a book will cost before anyone presses «شروع ترجمه», and a ceiling that stops the spending (SPEC §9.10,
 * ADR-043).
 *
 * Two different things are being counted and they must not be confused: **tokens**, which every engine spends,
 * and **dollars**, which only a pay-as-you-go model spends. A local model and a model covered by a subscription
 * cost no money and still have a limit — the computer's time, or the plan's weekly allowance — so the estimate
 * always reports tokens and reports money only where money is actually charged.
 */

/** How many tokens a stage spends, per unit of work. Measured from the user's own finished jobs when there are
 *  enough of them, otherwise the built-in defaults below. */
export interface StageRates {
  /** Tokens for each segment the stage handles. */
  inPerSegment: number;
  outPerSegment: number;
  /** Tokens every call costs whatever it carries: the task prompt, the style guide, the JSON schema. */
  inPerCall: number;
  outPerCall: number;
}

/**
 * Measured on a real chunk of the owner's medical textbook with Claude Code (60 items, ~600 source words:
 * 11,923 input and 3,684 output tokens per call). They are a starting point only — as soon as a book has
 * finished jobs of its own, its own numbers are used instead.
 */
export const DEFAULT_RATES: Record<'brief' | 'glossary' | 'translate' | 'edit', StageRates> = {
  // A brief and a glossary batch carry no segments: what they cost is the call itself.
  brief: { inPerSegment: 0, outPerSegment: 0, inPerCall: 6_000, outPerCall: 1_200 },
  glossary: { inPerSegment: 0, outPerSegment: 0, inPerCall: 4_500, outPerCall: 1_800 },
  // 11,923 in and 3,684 out for 60 segments, prompt and glossary included — so per segment, not per call.
  translate: { inPerSegment: 199, outPerSegment: 61, inPerCall: 0, outPerCall: 0 },
  // An edit call carries the source and the draft of every item, so its input runs higher.
  edit: { inPerSegment: 260, outPerSegment: 65, inPerCall: 0, outPerCall: 0 },
};

export type CostStage = keyof typeof DEFAULT_RATES;
export const COST_STAGES: CostStage[] = ['brief', 'glossary', 'translate', 'edit'];

/** US dollars per million tokens, as the provider lists them. */
export interface ModelPrice {
  input: number;
  output: number;
}

export interface Tokens {
  in: number;
  out: number;
}

/** What one engine will spend on the work routed to it. */
export interface EngineEstimate {
  engine: string;
  model: string;
  /** Free tier, pay-as-you-go, a local model, or a subscription that is already paid for. */
  cost: ModelCost;
  calls: number;
  tokens: Tokens;
  /** Dollars, or null when this engine is not charged per token (the estimate says so instead of «$0»). */
  usd: number | null;
  /** The price used, when there is one. */
  price?: ModelPrice;
}

export interface CostEstimate {
  /** `measured` when the numbers come from this library's own finished jobs. */
  basis: 'measured' | 'default';
  /** Jobs the rates were measured from; 0 with the defaults. */
  samples: number;
  tokens: Tokens;
  /** Total dollars across the engines that charge per token; null when none of them do. */
  usd: number | null;
  perEngine: EngineEstimate[];
}

export const tokensOf = (rates: StageRates, segments: number, calls: number): Tokens => ({
  in: Math.round(rates.inPerSegment * segments + rates.inPerCall * calls),
  out: Math.round(rates.outPerSegment * segments + rates.outPerCall * calls),
});

/** Dollars for a number of tokens at a listed price. */
export const usdOf = (tokens: Tokens, price: ModelPrice): number =>
  (tokens.in * price.input + tokens.out * price.output) / 1_000_000;

// ── The ceiling ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A spending cap, in dollars. It applies to the engines that charge per token; a local model, a free tier and a
 * subscription are never stopped by it, because they spend no money to stop.
 */
export const BudgetSchema = z.object({
  /** Null = no ceiling. */
  dailyUsd: z.number().min(0).max(10_000).nullable().default(null),
  monthlyUsd: z.number().min(0).max(100_000).nullable().default(null),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const NO_BUDGET: Budget = { dailyUsd: null, monthlyUsd: null };

export interface BudgetStatus extends Budget {
  spentToday: number;
  spentMonth: number;
  /** True when a cap is reached: paid engines wait instead of spending more. */
  blocked: boolean;
  /** Which cap stopped it. */
  reason: 'daily' | 'monthly' | null;
  /** When the blocking window ends (ISO), so the dashboard can say when work resumes. */
  resetsAt: string | null;
}

export function budgetStatus(budget: Budget, spentToday: number, spentMonth: number, now = new Date()): BudgetStatus {
  const overDaily = budget.dailyUsd !== null && spentToday >= budget.dailyUsd;
  const overMonthly = budget.monthlyUsd !== null && spentMonth >= budget.monthlyUsd;
  const reason = overMonthly ? 'monthly' : overDaily ? 'daily' : null;
  const resets = (): string | null => {
    if (reason === 'daily') {
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      return next.toISOString();
    }
    if (reason === 'monthly') {
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    }
    return null;
  };
  return {
    ...budget,
    spentToday,
    spentMonth,
    blocked: reason !== null,
    reason,
    resetsAt: resets(),
  };
}
