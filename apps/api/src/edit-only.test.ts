import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockOutput } from '@dozabaneh/ai';
import type { AgentBatch, BookBundle, PipelineStatus } from '@dozabaneh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig, repoRoot } from './config';
import { pipelineCtx } from './jobs/runner';
import { agentNext, agentSubmit } from './pipeline/agent';

/**
 * ADR-045: a book written in Persian is edited, not translated. The fixtures are English PDFs, so the test uploads
 * one as a Persian book and replaces its text with original Persian sentences (with deliberate errors) before the
 * run — the pipeline only sees the database.
 */
const FIXTURES = fileURLToPath(new URL('../../../fixtures/pdf/', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-edit-only-'));
const config = readConfig({
  LOG_LEVEL: 'silent',
  DATA_DIR: dataDir,
  AUTO_SEED: '0',
  AGENT_MAX_PENDING: '50',
  OCR: '0',
});
const app = await buildApp(config, { startRunner: false });

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const ctx = () => pipelineCtx(app.ctx);
const statusOf = async (id: string): Promise<PipelineStatus> =>
  (await app.inject({ url: `/api/v1/books/${id}/pipeline?lang=fa` })).json();
const bundleOf = async (id: string): Promise<BookBundle> =>
  (await app.inject({ url: `/api/v1/books/${id}/bundle` })).json();

/** Original sample sentences; «می شود» (missing ZWNJ) and «موثر» (missing hamza) are the errors to correct. */
const PERSIAN = 'این روش ساده می شود و در عمل موثر است.';

async function uploadPersianBook(): Promise<string> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const body = new FormData();
  const file = 'outline-book.pdf';
  body.append('file', new Blob([readFileSync(join(FIXTURES, file))], { type: 'application/pdf' }), file);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/books?sourceLang=fa&targetLang=fa`, {
    method: 'POST',
    body,
  });
  expect(res.status).toBe(201);
  const bookId = ((await res.json()) as { bookId: string }).bookId;
  await app.ctx.runner.drain();
  app.ctx.db.$client
    .prepare(
      `UPDATE segments SET src = CASE type WHEN 'heading' THEN 'فصل نمونه ' || ord ELSE ? || ' ' || ord END
        WHERE book_id = ? AND translatable = 1`,
    )
    .run(PERSIAN, bookId);
  const confirm = await app.inject({
    method: 'PATCH',
    url: `/api/v1/books/${bookId}/structure`,
    payload: { op: 'confirm' },
  });
  expect(confirm.statusCode).toBe(200);
  return bookId;
}

describe('edit-only books (ADR-045)', () => {
  let bookId = '';

  it('rejects an unknown language on upload', async () => {
    if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const body = new FormData();
    body.append('file', new Blob([readFileSync(join(FIXTURES, 'outline-book.pdf'))]), 'x.pdf');
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/books?sourceLang=xx`, { method: 'POST', body });
    expect(res.status).toBe(400);
  });

  it('stores the language of the book and edits it in its own language', async () => {
    bookId = await uploadPersianBook();
    const bundle = await bundleOf(bookId);
    expect(bundle.book.sourceLang).toBe('fa');
    expect(bundle.book.targetLangs).toEqual(['fa']);

    const estimate = (
      await app.inject({ method: 'POST', url: `/api/v1/books/${bookId}/pipeline/estimate`, payload: { lang: 'fa' } })
    ).json();
    expect(estimate.batches).toMatchObject({ brief: 0, glossary: 0, translate: 0 });
    expect(estimate.batches.edit).toBeGreaterThan(0);
  });

  it('skips brief, glossary and translation, and sends the copy-editing prompt to the editor', async () => {
    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${bookId}/pipeline/start`,
      // Even the economy profile edits: for an edit-only book the edit pass is the work.
      payload: { lang: 'fa', settings: { profile: 'economy', engines: { edit: 'agent' } } },
    });
    expect(start.statusCode).toBe(200);
    const status = await statusOf(bookId);
    expect(status.stage).toBe('edit');
    const stages = app.ctx.db.$client
      .prepare('SELECT DISTINCT stage FROM jobs WHERE book_id = ? AND stage IN (?, ?, ?, ?)')
      .all(bookId, 'brief', 'glossary', 'translate', 'edit') as { stage: string }[];
    expect(stages.map((s) => s.stage)).toEqual(['edit']);

    // The original is the draft: the reader shows it in the edited column until the edit arrives.
    const before = await bundleOf(bookId);
    const drafted = before.translations.filter((t) => t.lang === 'fa');
    expect(drafted.length).toBeGreaterThan(5);
    expect(drafted.every((t) => t.status === 'drafted')).toBe(true);
    expect(drafted.some((t) => t.text.startsWith(PERSIAN))).toBe(true);

    // The fake agent corrects both errors and explains one of them.
    let batches = 0;
    for (;;) {
      const next = agentNext(ctx());
      if (!next) break;
      const batch = JSON.parse(readFileSync(resolve(repoRoot(), next.batchPath), 'utf8')) as AgentBatch;
      expect(batch.task).toBe('edit');
      expect(batch.promptRefs[0]).toBe('prompts/copyedit.md');
      const output = mockOutput(batch) as { items: { tgt: string; changes: unknown[] }[] };
      for (const item of output.items) {
        if (!item.tgt.startsWith(PERSIAN)) continue;
        item.tgt = item.tgt.replace('می شود', 'می‌شود').replace('موثر', 'مؤثر');
        item.changes = [{ type: 'spacing', before: 'می شود', after: 'می‌شود', reason: 'نیم‌فاصله در فعل' }];
      }
      const resultPath = resolve(repoRoot(), next.resultPath);
      writeFileSync(resultPath, JSON.stringify({ schemaVersion: 1, batchId: batch.batchId, ...output }), 'utf8');
      const outcome = agentSubmit(ctx(), resultPath);
      expect(outcome.ok, outcome.report).toBe(true);
      batches++;
    }
    expect(batches).toBeGreaterThan(0);
    const after = await bundleOf(bookId);
    const edited = after.translations.filter((t) => t.lang === 'fa' && t.text.includes('مؤثر'));
    expect(edited.length).toBeGreaterThan(0);
    expect(edited.every((t) => t.text.includes('می‌شود'))).toBe(true);
    // Nothing is flagged as «untranslated» in a book that is not a translation.
    expect(after.translations.flatMap((t) => t.flags).some((f) => f.code === 'untranslated')).toBe(false);
  });

  it('exports the errata list as CSV, Markdown and Word', async () => {
    const csv = await app.inject({ url: `/api/v1/books/${bookId}/export/errata?format=csv` });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/-errata\.csv"$/);
    expect(csv.body.startsWith('\u{FEFF}')).toBe(true);
    const lines = csv.body.trim().split('\r\n');
    expect(lines.length).toBeGreaterThan(2);
    expect(csv.body).toContain('نیم‌فاصله در فعل');
    expect(csv.body).toContain('مؤثر');

    const md = await app.inject({ url: `/api/v1/books/${bookId}/export/errata?format=markdown` });
    expect(md.statusCode).toBe(200);
    expect(md.body).toMatch(/^# /);
    expect(md.body).toContain('| می شود | می‌شود |');

    const word = await app.inject({ url: `/api/v1/books/${bookId}/export/errata` });
    expect(word.statusCode).toBe(200);
    expect(word.headers['content-type']).toContain('wordprocessingml');
    expect(word.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
