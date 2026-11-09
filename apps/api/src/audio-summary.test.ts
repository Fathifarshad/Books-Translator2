import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { getBundle } from './db/repo';
import { bookDocument } from './export/document';
import { audioStatus, buildAudio, planSummaryAudio, summaryForSpeech } from './tts/audio';
import { audioControl, audioKey } from './tts/control';

/**
 * The summary recording (ADR-041, amended 2026-11-08). The summary task answers `{ markdown }`; the recording used to
 * read `summary`/`bullets`, found nothing in every chapter, and failed with «nothing to read aloud» after writing
 * every summary three times over. Here the assistant engine is a stand-in that answers the way the real task does.
 */
const calls = vi.hoisted(() => ({ count: 0 }));
const MARKDOWN = [
  '**ایده‌ی اصلی:** این فصل درباره‌ی پیام روشن است',
  '',
  '**نکته‌های کلیدی:**',
  '- مشتری قهرمان داستان است',
  '- برند راهنمای اوست.',
  '1. نقشه‌ای ساده بدهید',
  '',
  '**اصطلاحات کلیدی:** راهنما (Guide)، قهرمان (Hero)',
].join('\n');

vi.mock('./assist/task', async (original) => ({
  ...(await original<typeof import('./assist/task')>()),
  runAssistTask: vi.fn(async () => {
    calls.count += 1;
    return { markdown: MARKDOWN, engine: 'openrouter', model: 'stand-in' };
  }),
}));

const FAKE_PIPER = fileURLToPath(new URL('./testing/fake-piper.mjs', import.meta.url));

describe('a summary, said out loud', () => {
  it('drops bullet and heading marks and ends every line, so a bullet is a sentence of its own', () => {
    const said = summaryForSpeech(`## عنوان\n${MARKDOWN}\n---\n> نقل قول`).split('\n');
    expect(said).toContain('مشتری قهرمان داستان است.');
    expect(said).toContain('برند راهنمای اوست.');
    expect(said).toContain('نقشه‌ای ساده بدهید.');
    expect(said).toContain('عنوان.');
    expect(said).toContain('نقل قول.');
    // A label that already ends in a colon is left as it is; the bold is `speechText`'s business.
    expect(said).toContain('**نکته‌های کلیدی:**');
    expect(said.some((l) => /^[-*+>#]\s|^\d+\.\s|^-{3,}$/u.test(l))).toBe(false);
  });
});

describe('recording the summary', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-summary-'));
  const appPromise = buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }), { startRunner: false });
  /** An assistant engine that is connected; the calls themselves go to the stand-in above. */
  const providers = { assistant: () => ({ engine: 'openrouter', ready: true }) } as never;
  afterAll(async () => {
    await (await appPromise).close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    calls.count = 0;
  });

  it('reads what the summary task returns, and keeps each summary for the next time', async () => {
    const app = await appPromise;
    const bundle = getBundle(app.ctx.db, 'bk_sample');
    if (!bundle) throw new Error('sample book missing');
    const doc = bookDocument(bundle, 'fa');
    const cacheFile = join(dataDir, 'summaries.json');
    const seen: [number, number][] = [];

    const plan = await planSummaryAudio(doc, providers, 'openrouter', {
      cacheFile,
      onChapter: (done, total) => {
        seen.push([done, total]);
      },
    });
    expect(plan.length).toBeGreaterThan(0);
    expect(calls.count).toBe(plan.length);
    const text = plan[0]?.text ?? '';
    expect(text).toContain('مشتری قهرمان داستان است.');
    expect(text).not.toMatch(/^- /mu);
    // Told before each chapter and once at the end, so the page never sits at «0 of 0».
    expect(seen[0]).toEqual([0, plan.length]);
    expect(seen.at(-1)).toEqual([plan.length, plan.length]);
    expect(existsSync(cacheFile)).toBe(true);
    expect(Object.keys(JSON.parse(readFileSync(cacheFile, 'utf8')) as object)).toHaveLength(plan.length);

    // A second recording (a retry, another format) does not ask the assistant again.
    const again = await planSummaryAudio(doc, providers, 'openrouter', { cacheFile });
    expect(calls.count).toBe(plan.length);
    expect(again.map((t) => t.text)).toEqual(plan.map((t) => t.text));
  });

  it('records the summary end to end, reporting the summaries first and the voice after', async () => {
    const app = await appPromise;
    app.ctx.tts.update({ source: 'piper', binPath: FAKE_PIPER, voicePath: 'fa.onnx' });
    const steps: { step: string; fraction: number }[] = [];
    const manifest = await buildAudio(
      { db: app.ctx.db, config: app.ctx.config, tts: app.ctx.tts, providers },
      {
        bookId: 'bk_sample',
        lang: 'fa',
        kind: 'summary',
        onProgress: (_done, _total, fraction, step) => steps.push({ step, fraction }),
      },
    );
    expect(manifest.tracks.length).toBeGreaterThan(0);
    expect(steps[0]?.step).toBe('summary');
    expect(steps.at(-1)).toEqual({ step: 'record', fraction: 1 });
    const firstRecord = steps.findIndex((s) => s.step === 'record');
    expect(steps.slice(firstRecord).every((s) => s.step === 'record')).toBe(true);
    // Progress never goes backwards between the two steps.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]?.fraction ?? 0).toBeGreaterThanOrEqual((steps[i - 1]?.fraction ?? 0) - 1e-9);
    }
    expect(audioStatus({ ...app.ctx, providers }, 'bk_sample', 'fa', 'summary')).toMatchObject({
      state: 'done',
      step: null,
    });
  });

  it('stops while the summaries are being written when the recording is given up', async () => {
    const app = await appPromise;
    const key = audioKey('bk_sample', 'fa', 'summary');
    const build = buildAudio(
      { db: app.ctx.db, config: app.ctx.config, tts: app.ctx.tts, providers },
      {
        bookId: 'bk_sample',
        lang: 'fa',
        kind: 'summary',
        onProgress: (_done, _total, _fraction, step) => {
          if (step === 'summary') audioControl.cancel(key);
        },
      },
    );
    await expect(build).rejects.toThrow(/^cancelled$/u);
  });

  it('does not try three times what cannot work until a setting changes', async () => {
    const app = await appPromise;
    // The app's own assistant is the offline mock, which writes no summary: the same answer every time.
    app.ctx.db.$client
      .prepare(
        `INSERT INTO jobs (id, book_id, stage, status, target_lang, scope, priority, attempts, created_at)
         VALUES ('job_empty', 'bk_sample', 'audio', 'queued', 'fa', '{"kind":"summary"}', 100, 0, '2099-01-01T00:00:00Z')`,
      )
      .run();
    await app.ctx.runner.drain();
    const row = app.ctx.db.$client.prepare("SELECT status, attempts, error FROM jobs WHERE id = 'job_empty'").get() as {
      status: string;
      attempts: number;
      error: string;
    };
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(row.error).toMatch(/assistant engine/u);
  });
});
