import {
  type Budget,
  type BudgetStatus,
  budgetStatus,
  COST_STAGES,
  type CostEstimate,
  type CostStage,
  DEFAULT_RATES,
  type EngineEstimate,
  isProviderId,
  type ModelPrice,
  modelCost,
  NO_BUDGET,
  type ProviderId,
  type StageRates,
  type Tokens,
  type TranslationSettings,
  tokensOf,
  usdOf,
} from '@dozabaneh/shared';
import type { Db } from '../db/client';
import { getSetting, setSetting } from '../settings/store';

/**
 * What a book will spend, and the ceiling that stops it (ADR-043).
 *
 * The rates come from the library's own finished jobs wherever there are enough of them — the owner's book, the
 * owner's engine, the owner's model — and fall back to figures measured on one real chunk only until then. An
 * estimate from somebody else's numbers would be a guess dressed up as a fact.
 */
const BUDGET_KEY = 'budget';
/** Below this many finished calls a stage's own numbers are noise; the defaults are steadier. */
const MIN_SAMPLES = 3;

interface StageRow {
  stage: CostStage;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  segments: number;
}

/** Tokens actually spent per stage, with the work each stage covered. */
function history(db: Db): StageRow[] {
  return db.$client
    .prepare(
      `SELECT stage,
              COUNT(*) AS calls,
              SUM(tokens_in) AS tokensIn,
              SUM(tokens_out) AS tokensOut,
              SUM(COALESCE(json_array_length(json_extract(scope, '$.segmentIds')), 0)) AS segments
         FROM jobs
        WHERE status = 'succeeded' AND tokens_in > 0
          AND stage IN ('brief', 'glossary', 'translate', 'edit')
        GROUP BY stage`,
    )
    .all() as StageRow[];
}

export interface MeasuredRates {
  rates: Record<CostStage, StageRates>;
  basis: 'measured' | 'default';
  samples: number;
}

/**
 * The rates to project with. A stage that carries segments (translate, edit) is measured per segment; one that
 * does not (brief, glossary) is measured per call. A stage without enough finished calls keeps its default.
 */
export function measureRates(db: Db): MeasuredRates {
  const rates = { ...DEFAULT_RATES } as Record<CostStage, StageRates>;
  let samples = 0;
  let measured = false;
  for (const row of history(db)) {
    if (row.calls < MIN_SAMPLES) continue;
    samples += row.calls;
    measured = true;
    if (row.segments > 0) {
      rates[row.stage] = {
        inPerSegment: row.tokensIn / row.segments,
        outPerSegment: row.tokensOut / row.segments,
        inPerCall: 0,
        outPerCall: 0,
      };
    } else {
      rates[row.stage] = {
        inPerSegment: 0,
        outPerSegment: 0,
        inPerCall: row.tokensIn / row.calls,
        outPerCall: row.tokensOut / row.calls,
      };
    }
  }
  return { rates, basis: measured ? 'measured' : 'default', samples };
}

/** Work per stage: how many calls, and how many segments those calls carry. */
export interface StageWork {
  calls: number;
  segments: number;
}

/** Where the chosen model and its listed price come from (the provider settings). */
export interface PriceSource {
  view(id: ProviderId): { model: string; price?: ModelPrice };
}

export function estimateCost(
  db: Db,
  providers: Partial<PriceSource> | undefined,
  settings: TranslationSettings,
  work: Record<CostStage, StageWork>,
): CostEstimate {
  const { rates, basis, samples } = measureRates(db);
  const byEngine = new Map<string, EngineEstimate>();
  const total: Tokens = { in: 0, out: 0 };

  for (const stage of COST_STAGES) {
    const { calls, segments } = work[stage];
    if (calls === 0 && segments === 0) continue;
    const engine = settings.engines[stage];
    const tokens = tokensOf(rates[stage], segments, calls);
    total.in += tokens.in;
    total.out += tokens.out;

    let entry = byEngine.get(engine);
    if (!entry) {
      const view = providers?.view && isProviderId(engine) ? providers.view(engine) : undefined;
      const model = view?.model ?? '';
      entry = {
        engine,
        model,
        cost: isProviderId(engine) ? modelCost(engine, model) : 'free',
        calls: 0,
        tokens: { in: 0, out: 0 },
        usd: null,
        ...(view?.price ? { price: view.price } : {}),
      };
      byEngine.set(engine, entry);
    }
    entry.calls += calls;
    entry.tokens.in += tokens.in;
    entry.tokens.out += tokens.out;
  }

  let usd: number | null = null;
  for (const entry of byEngine.values()) {
    // Only a pay-as-you-go model is charged per token; a free tier, a local model and a subscription are not.
    if (entry.cost !== 'paid' || !entry.price) continue;
    entry.usd = round(usdOf(entry.tokens, entry.price));
    usd = round((usd ?? 0) + entry.usd);
  }

  return { basis, samples, tokens: total, usd, perEngine: [...byEngine.values()] };
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Dollars a finished job cost, from the price its provider's chosen model is listed at. */
export function jobCostUsd(price: ModelPrice | undefined, tokens: Tokens): number {
  return price ? round(usdOf(tokens, price)) : 0;
}

// ── The ceiling ──────────────────────────────────────────────────────────────────────────────────────────────

export function getBudget(db: Db): Budget {
  return getSetting<Budget>(db, BUDGET_KEY) ?? NO_BUDGET;
}

export function setBudget(db: Db, budget: Budget): Budget {
  setSetting(db, BUDGET_KEY, budget);
  return budget;
}

/** Dollars already spent today and this month, from what the finished jobs recorded. */
export function spend(db: Db, now = new Date()): { today: number; month: number } {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sum = (since: Date): number => {
    const row = db.$client
      .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM jobs WHERE cost_usd > 0 AND finished_at >= ?`)
      .get(since.toISOString()) as { usd: number };
    return round(row.usd);
  };
  return { today: sum(startOfDay), month: sum(startOfMonth) };
}

export function budgetState(db: Db, now = new Date()): BudgetStatus {
  const { today, month } = spend(db, now);
  return budgetStatus(getBudget(db), today, month, now);
}
