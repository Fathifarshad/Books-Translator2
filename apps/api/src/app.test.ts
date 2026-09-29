import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BookBundle } from '@dozabaneh/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { jobs } from './db/schema';
import { claimNext, enqueue } from './jobs/queue';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/pdf/', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-api-'));
const config = readConfig({
  LOG_LEVEL: 'silent',
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_DIR: dataDir,
  MAX_UPLOAD_MB: '1',
});
const app = await buildApp(config, { startRunner: false });
let base = '';

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function upload(file: string, name = file): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(`${FIXTURES}${file}`)], { type: 'application/pdf' }), name);
  return fetch(`${base}/api/v1/books`, { method: 'POST', body: form });
}

async function bundleOf(id: string): Promise<BookBundle> {
  return (await app.inject({ url: `/api/v1/books/${id}/bundle` })).json();
}

describe('health & config', () => {
  it('reports status, version and configured engines', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      name: 'Dozabaneh',
      engines: { default: 'agent', tutor: 'local' },
    });
  });

  it('allows the configured web origin only', async () => {
    const ok = await app.inject({ url: '/api/v1/health', headers: { origin: 'http://localhost:5173' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await app.inject({ url: '/api/v1/health', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects invalid engines and splits origins', () => {
    expect(() => readConfig({ ENGINE_DEFAULT: 'gpt' })).toThrow();
    expect(readConfig({ WEB_ORIGIN: 'http://a, http://b' }).webOrigins).toEqual(['http://a', 'http://b']);
  });
});

describe('sample book (seeded)', () => {
  it('is in the library with its counter', async () => {
    const res = await app.inject({ url: '/api/v1/books' });
    const sample = res.json().books.find((b: { book: { id: string } }) => b.book.id === 'bk_sample');
    expect(sample.counter.total).toBeGreaterThan(40);
    expect(sample.counter.done).toBe(sample.counter.total - 4);
  });

  it('serves bundle, TOC and section payloads', async () => {
    const bundle = await bundleOf('bk_sample');
    expect(bundle.nodes.length).toBe(12);
    expect(bundle.translations.length).toBeGreaterThan(40);
    const toc = (await app.inject({ url: '/api/v1/books/bk_sample/toc?lang=fa' })).json().toc;
    expect(toc.find((e: { id: string }) => e.id === 'nd_sample_ch1').title.tgt).toBe('الگوریتم چیست؟');
    const section = (await app.inject({ url: '/api/v1/books/bk_sample/nodes/nd_sample_ch1-speed' })).json();
    expect(section.pageLabels).toEqual({ from: '9', to: '11' });
    expect((await app.inject({ url: '/api/v1/books/bk_sample/nodes/nope' })).statusCode).toBe(404);
  });

  it('searches both languages with FTS5 and Persian normalization', async () => {
    const fa = (
      await app.inject({ url: `/api/v1/books/bk_sample/search?q=${encodeURIComponent('جست وجوی دودویی')}` })
    ).json();
    expect(fa.groups[0].nodeId).toBe('nd_sample_ch1-speed');
    const en = (await app.inject({ url: '/api/v1/books/bk_sample/search?q=BINARY&sides=source' })).json();
    expect(en.total).toBeGreaterThan(0);
    expect(en.groups.every((g: { hits: { side: string }[] }) => g.hits.every((h) => h.side === 'source'))).toBe(true);
    const none = (await app.inject({ url: '/api/v1/books/bk_sample/search?q=a' })).json();
    expect(none.total).toBe(0);
  });
});

describe('upload → ingestion → structure review', () => {
  let bookId = '';

  it('accepts a PDF, queues ingestion and reports progress through the job', async () => {
    const res = await upload('outline-book.pdf');
    expect(res.status).toBe(201);
    bookId = ((await res.json()) as { bookId: string }).bookId;
    expect((await app.inject({ url: `/api/v1/books/${bookId}` })).json().book.status).toBe('uploaded');
    const events: string[] = [];
    const off = app.ctx.bus.subscribe(bookId, (e) =>
      events.push(e.type === 'progress' ? `p${e.done}` : `${e.type}:${'status' in e ? e.status : ''}`),
    );
    await app.ctx.runner.drain();
    off();
    expect(events).toContain('p7');
    expect(events.at(-1)).toBe('job:succeeded');
    const book = (await app.inject({ url: `/api/v1/books/${bookId}` })).json().book;
    expect(book).toMatchObject({
      status: 'structure_review',
      titles: { en: 'Small Machines' },
      authors: ['Fixture Author'],
      pageCount: 7,
    });
    expect(book.pageLabels.slice(0, 3)).toEqual(['i', 'ii', '1']);
  });

  it('stores the structure and the extraction report', async () => {
    const bundle = await bundleOf(bookId);
    expect(bundle.nodes.map((n) => n.kind)).toEqual([
      'front',
      'front',
      'chapter',
      'chapter_intro',
      'section',
      'section',
      'chapter',
      'back',
    ]);
    expect(bundle.nodes.filter((n) => n.skip)).toHaveLength(3);
    const report = (await app.inject({ url: `/api/v1/books/${bookId}/report` })).json().report;
    expect(report.stats.suspectedBreaks).toBe(0);
    expect(report.stats.mergedContinuations).toBe(2);
  });

  it('finds source text of an uploaded book', async () => {
    const r = (await app.inject({ url: `/api/v1/books/${bookId}/search?q=fulcrum&sides=source` })).json();
    expect(r.total).toBeGreaterThan(0);
  });

  it('edits the structure without changing segment ids, then confirms it', async () => {
    const before = await bundleOf(bookId);
    const section = before.nodes.find((n) => n.kind === 'section') as { id: string };
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/structure`,
      payload: { op: 'rename', nodeId: section.id, title: 'Levers, revisited' },
    });
    expect(renamed.statusCode).toBe(200);
    const merged = await app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/structure`,
      payload: { op: 'merge', nodeId: section.id, with: 'next' },
    });
    const after: BookBundle = merged.json().bundle;
    expect(after.nodes).toHaveLength(before.nodes.length - 1);
    expect(new Set(after.segments.map((s) => s.id))).toEqual(new Set(before.segments.map((s) => s.id)));
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/structure`,
      payload: { op: 'promote', nodeId: 'nope' },
    });
    expect(bad.statusCode).toBe(404);
    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/structure`,
      payload: { op: 'dance' },
    });
    expect(invalid.statusCode).toBe(400);
    const confirm = await app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/structure`,
      payload: { op: 'confirm' },
    });
    expect(confirm.json().status).toBe('ready_to_translate');
  });

  it('offers the existing book for a duplicate upload', async () => {
    const res = await upload('outline-book.pdf', 'copy.pdf');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: unknown }).error).toMatchObject({
      code: 'DUPLICATE_BOOK',
      details: { bookId },
    });
  });

  it('serves the original PDF with range requests', async () => {
    const res = await app.inject({ url: `/api/v1/books/${bookId}/file`, headers: { range: 'bytes=0-4' } });
    expect(res.statusCode).toBe(206);
    expect(res.body).toBe('%PDF-');
    expect(res.headers['content-range']).toMatch(/^bytes 0-4\/\d+$/);
  });

  it('deletes a book with its files', async () => {
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/books/${bookId}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ url: `/api/v1/books/${bookId}` })).statusCode).toBe(404);
  });
});

describe('upload validation', () => {
  it('rejects files without the %PDF- magic bytes', async () => {
    const form = new FormData();
    form.append('file', new Blob(['hello, not a pdf']), 'fake.pdf');
    const res = await fetch(`${base}/api/v1/books`, { method: 'POST', body: form });
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_A_PDF');
  });

  it('rejects files over MAX_UPLOAD_MB', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1.2 * 1024 * 1024)])]),
      'big.pdf',
    );
    const res = await fetch(`${base}/api/v1/books`, { method: 'POST', body: form });
    expect(res.status).toBe(413);
  });

  it('marks a broken PDF as failed without retrying forever', async () => {
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.4\nthis is not really a pdf\n']), 'broken.pdf');
    const res = await fetch(`${base}/api/v1/books`, { method: 'POST', body: form });
    const { bookId } = (await res.json()) as { bookId: string };
    await app.ctx.runner.drain();
    const book = (await app.inject({ url: `/api/v1/books/${bookId}` })).json();
    expect(book.book.status).toBe('failed');
    expect(book.ingest.status).toBe('failed');
  });
});

describe('job queue', () => {
  it('re-claims a running job whose lease expired (crash recovery)', () => {
    const { db } = app.ctx;
    const id = enqueue(db, { bookId: 'bk_sample', stage: 'brief' });
    db.update(jobs).set({ status: 'running', leaseUntil: '2000-01-01T00:00:00.000Z' }).where(eq(jobs.id, id)).run();
    const claimed = claimNext(db, ['brief']);
    expect(claimed?.id).toBe(id);
    expect(claimed?.attempts).toBe(1);
    expect(claimNext(db, ['brief'])).toBeUndefined();
  });
});

describe('server-sent events', () => {
  it('streams with SSE headers and an initial snapshot', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/v1/books/bk_sample/events`, {
      signal: ctrl.signal,
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const reader = res.body?.getReader();
    let text = '';
    while (reader && !text.includes('event: book')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('"status":"ready"');
    ctrl.abort();
  });
});
