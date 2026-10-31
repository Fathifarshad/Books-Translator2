import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mockOutput } from '@dozabaneh/ai';
import type { AgentBatch, PipelineStatus } from '@dozabaneh/shared';
import PDFDocument from 'pdfkit';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig, repoRoot } from './config';
import { pipelineCtx } from './jobs/runner';
import { agentNext, agentStatus, agentSubmit } from './pipeline/agent';

/**
 * ADR-038: a book whose text is one long chapter must still translate in parallel. The chunks of a chapter used to
 * wait for each other, so such a book offered exactly one batch at a time — one Claude Code batch per round trip,
 * one provider request at a time, weeks for a textbook. These tests pin both halves of the fix: independent
 * chunks, and a runner that keeps several of them busy at once.
 */
const PARAGRAPH =
  'The anaesthetist watches the patient while the operation goes on, and writes down what the machines report. ' +
  'Every measurement has a meaning, and the meaning changes with the drug that was given a moment earlier. ' +
  'A careful record makes the difference between a quiet recovery and a long night in the ward afterwards.';

/** One chapter, no sections: 24 dense pages (~11,000 words), which is several translate chunks. */
function oneChapterPdf(pages = 24): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));
  doc.outline.addItem('Chapter 1: Anaesthesia in One Long Chapter');
  doc.font('Times-Bold').fontSize(18).text('Anaesthesia in One Long Chapter', { align: 'center' });
  doc.moveDown(1);
  for (let p = 0; p < pages; p++) {
    if (p > 0) doc.addPage({ size: 'A4', margin: 50 });
    for (let i = 0; i < 6; i++) {
      doc.font('Times-Roman').fontSize(10).text(`${PARAGRAPH} ${PARAGRAPH}`, { width: 495, align: 'left' });
      doc.moveDown(0.6);
    }
  }
  doc.end();
  return done;
}

const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-parallel-'));
const config = readConfig({
  LOG_LEVEL: 'silent',
  DATA_DIR: dataDir,
  AUTO_SEED: '0',
  OCR: '0',
  AGENT_MAX_PENDING: '40',
  WORKER_CONCURRENCY: '3',
  // Long enough that two jobs really do overlap in the test below.
  MOCK_LATENCY_MS: '150',
});
const app = await buildApp(config, { startRunner: false });

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const ctx = () => pipelineCtx(app.ctx);
const count = (sql: string): number => (app.ctx.db.$client.prepare(sql).get() as { n: number }).n;
const statusOf = async (id: string): Promise<PipelineStatus> =>
  (await app.inject({ url: `/api/v1/books/${id}/pipeline?lang=fa` })).json();

/** Uploads refuse the same file twice (DUPLICATE_BOOK), so each test gets its own length. */
async function ingestOneChapterBook(pages: number): Promise<string> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const pdf = await oneChapterPdf(pages);
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), `one-chapter-${pages}.pdf`);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/books`, { method: 'POST', body });
  const bookId = ((await res.json()) as { bookId: string }).bookId;
  await app.ctx.runner.drain();
  const confirm = await app.inject({
    method: 'PATCH',
    url: `/api/v1/books/${bookId}/structure`,
    payload: { op: 'confirm' },
  });
  expect(confirm.statusCode).toBe(200);
  return bookId;
}

const start = (bookId: string, engines: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/books/${bookId}/pipeline/start`,
    payload: { lang: 'fa', settings: { engines, autoApproveGlossary: true } },
  });

describe('a book that is one long chapter', () => {
  it('offers Claude Code many batches at once instead of one at a time', async () => {
    const bookId = await ingestOneChapterBook(24);
    const estimate = (
      await app.inject({ method: 'POST', url: `/api/v1/books/${bookId}/pipeline/estimate`, payload: { lang: 'fa' } })
    ).json();
    expect(estimate.batches.translate).toBeGreaterThan(2);

    const res = await start(bookId, { brief: 'mock', glossary: 'mock', translate: 'agent', edit: 'agent' });
    expect(res.statusCode).toBe(200);
    // brief and glossary run in-process; the translate chunks become agent batches.
    await app.ctx.runner.drain();

    const open = agentStatus(ctx()).books.find((b) => b.bookId === bookId);
    expect(open?.byTask.translate?.pending).toBe(estimate.batches.translate);
    expect(open?.pending).toBeGreaterThan(2);
    // No translate chunk waits for another one.
    expect(count(`SELECT COUNT(*) n FROM jobs WHERE stage = 'translate' AND depends_on IS NOT NULL`)).toBe(0);
    // An edit unit still waits for the chunks of its own section.
    expect(count(`SELECT COUNT(*) n FROM jobs WHERE stage = 'edit' AND depends_on IS NOT NULL`)).toBeGreaterThan(0);

    // The fake agent works through them; the book finishes.
    for (let i = 0; i < 400; i++) {
      const next = agentNext(ctx());
      if (!next) break;
      const batch = JSON.parse(readFileSync(resolve(repoRoot(), next.batchPath), 'utf8')) as AgentBatch;
      const resultPath = resolve(repoRoot(), next.resultPath);
      writeFileSync(
        resultPath,
        JSON.stringify({ schemaVersion: 1, batchId: batch.batchId, ...mockOutput(batch) }),
        'utf8',
      );
      const outcome = agentSubmit(ctx(), resultPath);
      expect(outcome.ok, outcome.report).toBe(true);
      await app.ctx.runner.drain();
    }
    const status = await statusOf(bookId);
    expect(status.counter.total).toBeGreaterThan(0);
    // Everything is translated and edited; what is left sits in the review queue, as it does for any engine.
    expect(status.counter.done + status.flagged).toBe(status.counter.total);
    expect(status.state).toBe('done');
  }, 180_000);

  it('runs several chunks side by side (WORKER_CONCURRENCY)', async () => {
    const bookId = await ingestOneChapterBook(20);
    expect((await start(bookId, { brief: 'mock', glossary: 'mock', translate: 'mock', edit: 'mock' })).statusCode).toBe(
      200,
    );

    let peak = 0;
    const draining = app.ctx.runner.drain();
    let settled = false;
    void draining.then(() => {
      settled = true;
    });
    while (!settled) {
      peak = Math.max(peak, count(`SELECT COUNT(*) n FROM jobs WHERE status = 'running'`));
      await new Promise((r) => setTimeout(r, 10));
    }
    await draining;

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(config.WORKER_CONCURRENCY);
    const status = await statusOf(bookId);
    expect(status.counter.done + status.flagged).toBe(status.counter.total);
  }, 180_000);
});

describe('«توقف موقت»', () => {
  it('leaves a job that a dead process left running alone instead of bringing it back', async () => {
    const bookId = await ingestOneChapterBook(14);
    expect((await start(bookId, { brief: 'mock', glossary: 'mock', translate: 'mock', edit: 'mock' })).statusCode).toBe(
      200,
    );
    await app.ctx.runner.drain();
    // A crash in the middle of a run: the job stays 'running' with a lease nobody renews.
    app.ctx.db.$client
      .prepare(
        `UPDATE jobs SET status = 'running', lease_until = '2020-01-01T00:00:00.000Z'
          WHERE book_id = ? AND stage = 'translate' LIMIT 1`,
      )
      .run(bookId);
    expect(
      (await app.inject({ method: 'POST', url: `/api/v1/books/${bookId}/pipeline/pause`, payload: { lang: 'fa' } }))
        .statusCode,
    ).toBe(200);

    await app.ctx.runner.drain();
    const revived = count(
      `SELECT COUNT(*) n FROM jobs WHERE book_id = '${bookId}' AND stage = 'translate' AND status IN ('queued', 'running')`,
    );
    expect(revived).toBe(1); // the stale one, untouched — not claimed, not re-queued
    expect((await statusOf(bookId)).state).toBe('paused');
  }, 180_000);
});

describe('switching the engine while a book is half-way through', () => {
  it('moves the work that is still queued and withdraws the open Claude Code batches', async () => {
    const bookId = await ingestOneChapterBook(16);
    expect(
      (await start(bookId, { brief: 'mock', glossary: 'mock', translate: 'agent', edit: 'agent' })).statusCode,
    ).toBe(200);
    await app.ctx.runner.drain();
    const before = agentStatus(ctx()).books.find((b) => b.bookId === bookId);
    expect(before?.pending).toBeGreaterThan(1);

    // The user gives up on one engine and picks another: the queued jobs must follow, without cancelling the run.
    expect((await start(bookId, { brief: 'mock', glossary: 'mock', translate: 'mock', edit: 'mock' })).statusCode).toBe(
      200,
    );
    expect(agentStatus(ctx()).books.find((b) => b.bookId === bookId)).toBeUndefined();
    expect(count(`SELECT COUNT(*) n FROM jobs WHERE status = 'awaiting_agent' AND book_id = '${bookId}'`)).toBe(0);
    expect(
      count(`SELECT COUNT(*) n FROM jobs WHERE engine = 'agent' AND status = 'queued' AND book_id = '${bookId}'`),
    ).toBe(0);

    await app.ctx.runner.drain();
    const status = await statusOf(bookId);
    expect(status.counter.total).toBeGreaterThan(0);
    expect(status.counter.done + status.flagged).toBe(status.counter.total);
  }, 180_000);
});
