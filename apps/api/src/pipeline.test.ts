import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockOutput } from '@dozabaneh/ai';
import { needsTranslation } from '@dozabaneh/core';
import type { AgentBatch, BookBundle, PipelineStatus } from '@dozabaneh/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig, repoRoot } from './config';
import { pipelineCtx } from './jobs/runner';
import { agentNext, agentRelease, agentStatus, agentSubmit } from './pipeline/agent';

/**
 * Phase 3 integration: the full pipeline on synthetic fixtures — with the mock engine in-process, and in agent mode
 * driven by a fake agent that writes result files and calls submit (SPEC §18), including restart and re-submit.
 */
const FIXTURES = fileURLToPath(new URL('../../../fixtures/pdf/', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-pipeline-'));
// OCR off: the scanned fixture stays unreadable here (OCR itself is tested in packages/pdf).
const config = readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir, AUTO_SEED: '0', AGENT_MAX_PENDING: '5', OCR: '0' });
let app = await buildApp(config, { startRunner: false });

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function ingestFixture(file: string): Promise<string> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const body = new FormData();
  body.append('file', new Blob([readFileSync(join(FIXTURES, file))], { type: 'application/pdf' }), file);
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

const bundleOf = async (id: string): Promise<BookBundle> =>
  (await app.inject({ url: `/api/v1/books/${id}/bundle` })).json();
const statusOf = async (id: string): Promise<PipelineStatus> =>
  (await app.inject({ url: `/api/v1/books/${id}/pipeline?lang=fa` })).json();
const ctx = () => pipelineCtx(app.ctx);

/** The fake agent: lease → read the batch → write a (mock) result → submit. */
function processOne(
  opts: { mutate?: (result: Record<string, unknown>) => void } = {},
): ReturnType<typeof agentSubmit> | null {
  const next = agentNext(ctx());
  if (!next) return null;
  const batch = JSON.parse(readFileSync(resolve(repoRoot(), next.batchPath), 'utf8')) as AgentBatch;
  expect(next.resultPath).toBe(batch.resultPath);
  const result: Record<string, unknown> = { schemaVersion: 1, batchId: batch.batchId, ...mockOutput(batch) };
  opts.mutate?.(result);
  const resultPath = resolve(repoRoot(), next.resultPath);
  writeFileSync(resultPath, JSON.stringify(result), 'utf8');
  return agentSubmit(ctx(), resultPath);
}

function processAll(limit = 200): number {
  let n = 0;
  while (n < limit) {
    const outcome = processOne();
    if (!outcome) break;
    expect(outcome.ok, outcome.report).toBe(true);
    n++;
  }
  return n;
}

function expectOneTranslationPerSegment(bundle: BookBundle): void {
  const skipped = new Set(bundle.nodes.filter((n) => n.skip).map((n) => n.id));
  const work = bundle.segments.filter((s) => needsTranslation(s) && !skipped.has(s.nodeId));
  expect(work.length).toBeGreaterThan(5);
  for (const s of work) {
    const rows = bundle.translations.filter((t) => t.segmentId === s.id && t.lang === 'fa');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text.trim().length, s.src).toBeGreaterThan(0);
    expect(['final', 'flagged', 'user_edited']).toContain(rows[0]?.status);
  }
}

async function approveFlagged(bookId: string): Promise<number> {
  const queue = (await app.inject({ url: `/api/v1/books/${bookId}/review?lang=fa` })).json() as {
    items: { segmentId: string }[];
  };
  for (const item of queue.items) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/segments/${item.segmentId}/review`,
      payload: { lang: 'fa', action: 'approve' },
    });
    expect(res.statusCode).toBe(200);
  }
  return queue.items.length;
}

describe('pipeline with the mock engine', () => {
  let bookId = '';

  it('translates a fixture book end to end', async () => {
    bookId = await ingestFixture('outline-book.pdf');
    const estimate = (
      await app.inject({ method: 'POST', url: `/api/v1/books/${bookId}/pipeline/estimate`, payload: { lang: 'fa' } })
    ).json();
    expect(estimate.batches.brief).toBe(1);
    expect(estimate.batches.translate).toBeGreaterThan(0);

    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${bookId}/pipeline/start`,
      payload: {
        lang: 'fa',
        settings: {
          engines: { brief: 'mock', glossary: 'mock', translate: 'mock', edit: 'mock' },
          autoApproveGlossary: true,
        },
      },
    });
    expect(start.statusCode).toBe(200);
    await app.ctx.runner.drain();

    const status = await statusOf(bookId);
    expect(status.state).toBe('done');
    expect(status.errors).toEqual([]);
    expect(status.stages.translate.done).toBe(status.stages.translate.total);
    const bundle = await bundleOf(bookId);
    expectOneTranslationPerSegment(bundle);
    expect(bundle.book.brief?.fa).toBeTruthy();
    expect(bundle.book.titles.fa).toBeTruthy();
    expect(bundle.glossary.length).toBeGreaterThan(0);
    expect(bundle.book.status).toBe('ready');

    await approveFlagged(bookId);
    const after = await statusOf(bookId);
    expect(after.counter.done).toBe(after.counter.total);
    expect(after.flagged).toBe(0);
  });

  it('applies post-processing to imported text (Persian digits, no Latin punctuation)', async () => {
    const bundle = await bundleOf(bookId);
    const texts = bundle.translations.filter((t) => t.lang === 'fa').map((t) => t.text);
    expect(texts.join(' ')).not.toMatch(/[يك]/u);
    const heading = bundle.segments.find((s) => s.type === 'heading' && /\d/.test(s.src));
    const t = bundle.translations.find((x) => x.segmentId === heading?.id);
    expect(t?.text).toMatch(/[۰-۹]/u);
  });

  it('keeps user edits through re-runs and offers the engine result as a suggestion', async () => {
    const bundle = await bundleOf(bookId);
    const translated = new Set(
      bundle.translations.filter((t) => t.lang === 'fa' && t.status === 'final').map((t) => t.segmentId),
    );
    const seg = bundle.segments.find((s) => s.type === 'paragraph' && translated.has(s.id)) as { id: string };
    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/v1/segments/${seg.id}/translation`,
      payload: { lang: 'fa', text: 'ترجمه‌ی ویرایش‌شده‌ی من.' },
    });
    expect(edited.json().translation.status).toBe('user_edited');
    const rerun = await app.inject({
      method: 'POST',
      url: `/api/v1/segments/${seg.id}/review`,
      payload: { lang: 'fa', action: 'rerun' },
    });
    expect(rerun.statusCode).toBe(200);
    await app.ctx.runner.drain();
    const after = (await bundleOf(bookId)).translations.find((t) => t.segmentId === seg.id);
    expect(after?.text).toBe('ترجمه‌ی ویرایش‌شده‌ی من.');
    expect(after?.status).toBe('user_edited');
    const all = (await app.inject({ url: `/api/v1/books/${bookId}/review?lang=fa&filter=all` })).json() as {
      items: { segmentId: string; suggestion: string | null }[];
    };
    expect(all.items.find((i) => i.segmentId === seg.id)?.suggestion).toBeTruthy();
    const revisions = (await app.inject({ url: `/api/v1/segments/${seg.id}/revisions?lang=fa` })).json().revisions;
    expect(revisions[0]).toMatchObject({ actor: 'user', after: 'ترجمه‌ی ویرایش‌شده‌ی من.' });
    // Undo = an edit back to the previous text.
    const undo = await app.inject({
      method: 'PATCH',
      url: `/api/v1/segments/${seg.id}/translation`,
      payload: { lang: 'fa', text: revisions[0].before, reason: 'undo' },
    });
    expect(undo.json().translation.text).toBe(revisions[0].before);
  });

  it('manages the glossary', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${bookId}/glossary`,
      payload: { lang: 'fa', src: 'counterweight arm', tgt: 'بازوی وزنه', kind: 'term' },
    });
    expect(created.statusCode).toBe(201);
    const term = created.json().term;
    const dup = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${bookId}/glossary`,
      payload: { lang: 'fa', src: 'Counterweight Arm', tgt: 'x' },
    });
    expect(dup.statusCode).toBe(409);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/glossary/${term.id}`,
      payload: { tgt: 'بازوی وزنه‌ی تعادل' },
    });
    expect(patched.json().changedEquivalent).toBe(true);
    const applied = await app.inject({ method: 'POST', url: `/api/v1/books/${bookId}/glossary/${term.id}/apply` });
    expect(applied.statusCode).toBe(200);
    await app.ctx.runner.drain();
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/books/${bookId}/glossary/${term.id}` });
    expect(del.statusCode).toBe(204);
  });
});

describe('pipeline in agent mode (fake agent + submit)', () => {
  let bookId = '';

  it('writes the brief batch and waits for the agent', async () => {
    bookId = await ingestFixture('no-outline.pdf');
    await app.inject({ method: 'POST', url: `/api/v1/books/${bookId}/pipeline/start`, payload: { lang: 'fa' } });
    await app.ctx.runner.drain();
    const status = agentStatus(ctx());
    expect(status.books.find((b) => b.bookId === bookId)?.byTask.brief?.pending).toBe(1);
    const pipeline = await statusOf(bookId);
    expect(pipeline.agent.pending).toBe(1);
    expect(pipeline.stage).toBe('brief');
  });

  it('rejects malformed results with actionable messages and accepts the fix', () => {
    const bad = processOne({
      mutate: (r) => {
        r.brief = 'short English text';
      },
    });
    expect(bad?.ok).toBe(false);
    expect(bad?.report).toContain('target_script');
    expect(bad?.report).toContain('fix:');
    // The same batch stays leased for the agent; a corrected result is accepted.
    const leased = agentStatus(ctx()).books.find((b) => b.bookId === bookId);
    expect(leased?.leased).toBe(1);
    const released = agentRelease(ctx(), (bad?.batchId as string) ?? '');
    expect(released).toBe(true);
    const good = processOne();
    expect(good?.ok, good?.report).toBe(true);
  });

  it('treats a second submit of the same result as a no-op', () => {
    const next = agentNext(ctx());
    expect(next).not.toBeNull();
    const batch = JSON.parse(readFileSync(resolve(repoRoot(), next?.batchPath ?? ''), 'utf8')) as AgentBatch;
    const path = resolve(repoRoot(), next?.resultPath ?? '');
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, batchId: batch.batchId, ...mockOutput(batch) }));
    const first = agentSubmit(ctx(), path);
    expect(first.ok).toBe(true);
    expect(first.alreadyImported).toBeUndefined();
    const second = agentSubmit(ctx(), path);
    expect(second.ok).toBe(true);
    expect(second.alreadyImported).toBe(true);
  });

  it('waits for the glossary review, then creates translation batches', async () => {
    processAll();
    let status = await statusOf(bookId);
    expect(status.state).toBe('waiting_glossary_review');
    const glossary = (await app.inject({ url: `/api/v1/books/${bookId}/glossary?lang=fa` })).json().terms as {
      status: string;
    }[];
    expect(glossary.length).toBeGreaterThan(0);
    expect(glossary.every((t) => t.status === 'proposed')).toBe(true);
    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${bookId}/glossary/approve`,
      payload: { lang: 'fa' },
    });
    expect(approve.json().approved).toBe(glossary.length);
    status = await statusOf(bookId);
    expect(status.state).toBe('running');
    expect(status.agent.pending).toBeGreaterThan(0);
    // AGENT_MAX_PENDING caps the open batches.
    expect(status.agent.pending + status.agent.leased).toBeLessThanOrEqual(5);
  });

  it('resumes after the API restarts mid-run and finishes', async () => {
    const one = processOne();
    expect(one?.ok).toBe(true);
    // A leased batch whose agent disappears goes back to the pool after the lease expires.
    const leased = agentNext(ctx());
    expect(leased).not.toBeNull();
    await app.close();
    app = await buildApp(config, { startRunner: false });
    app.ctx.db.$client
      .prepare(`UPDATE agent_batches SET lease_until = '2000-01-01T00:00:00.000Z' WHERE status = 'leased'`)
      .run();
    processAll();
    const status = await statusOf(bookId);
    expect(status.state).toBe('done');
    expect(status.errors).toEqual([]);
    expectOneTranslationPerSegment(await bundleOf(bookId));
    await approveFlagged(bookId);
    const done = await statusOf(bookId);
    expect(done.counter.done).toBe(done.counter.total);
  });

  it('moves a section to the front of the queue on request', async () => {
    const other = await ingestFixture('two-column.pdf');
    await app.inject({
      method: 'POST',
      url: `/api/v1/books/${other}/pipeline/start`,
      payload: {
        lang: 'fa',
        settings: {
          autoApproveGlossary: true,
          engines: { brief: 'mock', glossary: 'mock', translate: 'agent', edit: 'agent' },
        },
      },
    });
    await app.ctx.runner.drain();
    const bundle = await bundleOf(other);
    const last = [...bundle.nodes]
      .reverse()
      .find((n) => bundle.segments.some((s) => s.nodeId === n.id && needsTranslation(s)));
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${other}/priority`,
      payload: { nodeId: last?.id, lang: 'fa' },
    });
    expect(res.statusCode).toBe(200);
    const next = agentNext(ctx(), { bookId: other });
    expect(next?.task).toBe('translate');
    const pause = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${other}/pipeline/pause`,
      payload: { lang: 'fa' },
    });
    expect(pause.json().state).toBe('paused');
    expect(agentNext(ctx(), { bookId: other })).toBeNull();
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${other}/pipeline/cancel`,
      payload: { lang: 'fa' },
    });
    expect(cancel.json().state).toBe('cancelled');
    expect((await bundleOf(other)).book.status).toBe('ready_to_translate');
  });
});

describe('cross-process notifications', () => {
  it('forwards events written by the agent CLI to SSE subscribers', async () => {
    const { dbNotifier, NotificationPoller } = await import('./pipeline/notify');
    const seen: unknown[] = [];
    const poller = new NotificationPoller(app.ctx.db, app.ctx.bus);
    poller.start(60_000);
    const off = app.ctx.bus.subscribe('bk_x', (e) => seen.push(e));
    dbNotifier(app.ctx.db)('bk_x', { type: 'pipeline', lang: 'fa' });
    poller.tick();
    poller.tick();
    off();
    poller.stop();
    expect(seen).toEqual([{ type: 'pipeline', lang: 'fa' }]);
  });
});

describe('glossary PATCH', () => {
  it('only changes the fields it sends', async () => {
    const books = (await app.inject({ url: '/api/v1/books' })).json().books as { book: { id: string } }[];
    const id = books[0]?.book.id as string;
    const created = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/books/${id}/glossary`,
        payload: {
          lang: 'fa',
          src: 'Ada Byron',
          tgt: 'آدا بایرون',
          kind: 'person',
          parenthetical: 'always',
          alternatives: ['ایدا بایرن'],
          status: 'proposed',
        },
      })
    ).json().term;
    const patched = (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${id}/glossary/${created.id}`,
        payload: { src: 'Ada Lovelace' },
      })
    ).json().term;
    expect(patched).toMatchObject({
      src: 'Ada Lovelace',
      kind: 'person',
      parenthetical: 'always',
      alternatives: ['ایدا بایرن'],
      status: 'proposed',
    });
  });
});

describe('books with nothing to translate', () => {
  it('refuses to start instead of finishing at 0% (scanned PDF without OCR)', async () => {
    const bookId = await ingestFixture('scanned.pdf');
    const report = (await app.inject({ url: `/api/v1/books/${bookId}/report` })).json();
    expect(report.report.stats.pagesWithoutText).toBe(7);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${bookId}/pipeline/start`,
      payload: {
        lang: 'fa',
        settings: { engines: { brief: 'mock', glossary: 'mock', translate: 'mock', edit: 'mock' } },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOTHING_TO_TRANSLATE');
  });
});
