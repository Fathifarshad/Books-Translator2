import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RATES, TranslationSettingsSchema } from '@dozabaneh/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { budgetState, estimateCost, measureRates, setBudget, spend } from './pipeline/cost';

/** ADR-043: the estimate before «شروع ترجمه», the dollars a job recorded, and the ceiling that stops paid engines. */
const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-cost-'));
const config = readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir, AUTO_SEED: '0' });
const app = await buildApp(config, { startRunner: false });
const db = app.ctx.db;

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let n = 0;
/** A finished job, without a book behind it: only the numbers matter here. */
function job(
  stage: string,
  tokensIn: number,
  tokensOut: number,
  segments: number,
  costUsd = 0,
  finishedAt = new Date(),
) {
  db.$client.pragma('foreign_keys = OFF');
  db.$client
    .prepare(
      `INSERT INTO jobs (id, book_id, stage, scope, engine, status, tokens_in, tokens_out, cost_usd, created_at, finished_at)
       VALUES (?, 'none', ?, ?, 'openrouter', 'succeeded', ?, ?, ?, ?, ?)`,
    )
    .run(
      `job-${++n}`,
      stage,
      JSON.stringify({ segmentIds: Array.from({ length: segments }, (_, i) => `s${i}`) }),
      tokensIn,
      tokensOut,
      costUsd,
      finishedAt.toISOString(),
      finishedAt.toISOString(),
    );
  db.$client.pragma('foreign_keys = ON');
}

const work = {
  brief: { calls: 1, segments: 0 },
  glossary: { calls: 2, segments: 0 },
  translate: { calls: 10, segments: 600 },
  edit: { calls: 0, segments: 0 },
};

beforeEach(() => {
  db.$client.prepare('DELETE FROM jobs').run();
  setBudget(db, { dailyUsd: null, monthlyUsd: null });
});

describe('estimate', () => {
  it('uses the built-in rates until there is history, and counts no dollars on a subscription', () => {
    const settings = TranslationSettingsSchema.parse({ engines: { translate: 'claude_code' } });
    const est = estimateCost(db, undefined, settings, work);
    expect(est.basis).toBe('default');
    expect(est.tokens.in).toBe(
      DEFAULT_RATES.brief.inPerCall + 2 * DEFAULT_RATES.glossary.inPerCall + 600 * DEFAULT_RATES.translate.inPerSegment,
    );
    expect(est.usd).toBeNull();
    expect(est.perEngine.find((e) => e.engine === 'claude_code')?.cost).toBe('subscription');
  });

  it('prices a pay-as-you-go model at its listed price', () => {
    const settings = TranslationSettingsSchema.parse({
      engines: { brief: 'openrouter', glossary: 'openrouter', translate: 'openrouter', edit: 'openrouter' },
    });
    const prices = { view: () => ({ model: 'anthropic/claude-sonnet-5.5', price: { input: 2, output: 10 } }) };
    const est = estimateCost(db, prices, settings, work);
    const t = est.tokens;
    expect(est.usd).toBeCloseTo((t.in * 2 + t.out * 10) / 1_000_000, 3);
    expect(est.perEngine).toHaveLength(1);
  });

  it('learns from finished jobs once there are enough of them', () => {
    for (let i = 0; i < 3; i++) job('translate', 3_000, 1_000, 10);
    const m = measureRates(db);
    expect(m.basis).toBe('measured');
    expect(m.samples).toBe(3);
    expect(m.rates.translate.inPerSegment).toBe(300);
    expect(m.rates.edit).toEqual(DEFAULT_RATES.edit);
  });

  it('is part of the pipeline estimate the setup page shows', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/books/missing/pipeline/estimate',
      payload: { lang: 'fa' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('spending cap', () => {
  it('sums what the jobs recorded today and this month', () => {
    const now = new Date();
    job('translate', 1, 1, 1, 0.4, now);
    job('translate', 1, 1, 1, 0.35, now);
    expect(spend(db, now).today).toBeCloseTo(0.75, 4);
  });

  it('is saved and reported through the settings route', async () => {
    job('translate', 1, 1, 1, 1.5);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/budget',
      payload: { dailyUsd: 1, monthlyUsd: null },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ dailyUsd: 1, blocked: true, reason: 'daily' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/settings/budget' })).json().spentToday).toBe(1.5);
    expect(budgetState(db).blocked).toBe(true);
  });

  it('refuses a negative ceiling', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/settings/budget', payload: { dailyUsd: -2 } });
    expect(res.statusCode).toBe(400);
  });

  it('never stops an engine that is not charged per token', () => {
    job('translate', 1, 1, 1, 5);
    setBudget(db, { dailyUsd: 1, monthlyUsd: null });
    expect(app.ctx.providers.isPaid('claude_code')).toBe(false);
    expect(app.ctx.providers.isPaid('ollama')).toBe(false);
    expect(app.ctx.providers.usdOf('claude_code', { tokensIn: 1_000_000, tokensOut: 1_000_000 })).toBe(0);
  });
});
