import { describe, expect, it } from 'vitest';
import { BudgetSchema, budgetStatus, DEFAULT_RATES, tokensOf, usdOf } from './cost';

describe('cost estimate (ADR-043)', () => {
  it('counts tokens per segment and per call', () => {
    expect(tokensOf(DEFAULT_RATES.translate, 60, 1)).toEqual({ in: 11_940, out: 3_660 });
    expect(tokensOf(DEFAULT_RATES.brief, 0, 2)).toEqual({ in: 12_000, out: 2_400 });
  });

  it('prices tokens per million', () => {
    // Sonnet-class list price: $2 in / $10 out per million tokens.
    expect(usdOf({ in: 1_000_000, out: 500_000 }, { input: 2, output: 10 })).toBe(7);
    expect(usdOf({ in: 0, out: 0 }, { input: 2, output: 10 })).toBe(0);
  });
});

describe('spending cap', () => {
  const now = new Date(2026, 9, 29, 15, 30);

  it('defaults to no ceiling and never blocks', () => {
    const budget = BudgetSchema.parse({});
    expect(budget).toEqual({ dailyUsd: null, monthlyUsd: null });
    expect(budgetStatus(budget, 999, 9_999, now)).toMatchObject({ blocked: false, reason: null, resetsAt: null });
  });

  it('blocks at the daily cap until midnight', () => {
    const s = budgetStatus({ dailyUsd: 1, monthlyUsd: null }, 1, 1, now);
    expect(s).toMatchObject({ blocked: true, reason: 'daily' });
    expect(new Date(s.resetsAt as string).getTime()).toBe(new Date(2026, 9, 30, 0, 0).getTime());
  });

  it('stays open below the cap', () => {
    expect(budgetStatus({ dailyUsd: 1, monthlyUsd: 20 }, 0.99, 5, now).blocked).toBe(false);
  });

  it('a reached monthly cap wins over the daily one', () => {
    const s = budgetStatus({ dailyUsd: 1, monthlyUsd: 20 }, 2, 20, now);
    expect(s.reason).toBe('monthly');
    expect(s.resetsAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('rejects a negative ceiling', () => {
    expect(() => BudgetSchema.parse({ dailyUsd: -1 })).toThrow();
  });
});
