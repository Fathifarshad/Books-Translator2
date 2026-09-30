import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBookIndex } from '@dozabaneh/core';
import type { BookBundle } from '@dozabaneh/shared';
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';
import { buildOfflineBook, buildOfflineHtml } from './export/offline';
import { exportFileName } from './routes/export';

/** «نسخه‌ی آفلاین»: one self-contained HTML reader for phones. */
const embedded = (html: string, id: string) =>
  JSON.parse(
    (new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html) ?? [])[1] ?? '',
  );

describe('offline book', () => {
  it('contains every readable section with source and translation, the glossary and the UI strings', () => {
    const html = buildOfflineHtml(sampleBook, 'fa', new Date('2026-09-30T00:00:00Z'));
    const book = embedded(html, 'book');
    const index = createBookIndex(sampleBook);
    expect(book.order).toHaveLength(index.readingOrder.length);
    expect(Object.keys(book.sections)).toHaveLength(index.readingOrder.length);
    expect(book.lang).toEqual({ src: 'en', tgt: 'fa', srcDir: 'ltr', tgtDir: 'rtl' });
    expect(book.glossary.length).toBeGreaterThan(0);
    const rows = Object.values(book.sections).flatMap((s) => (s as { rows: string[][] }).rows);
    expect(rows.some((r) => r[2] && /[آ-ی]/u.test(r[2]))).toBe(true);
    expect(embedded(html, 'strings').toc).toBeTruthy();
    expect(html).toMatch(/^<!doctype html>\n<html lang="fa" dir="rtl">/);
  });

  it('works without network: no external resources, strict CSP, fonts embedded', () => {
    const html = buildOfflineHtml(sampleBook, 'fa');
    expect(html).toContain(`default-src 'none'`);
    expect(html).toContain('data:font/woff2;base64,');
    const withoutBook = html.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '');
    expect(withoutBook).not.toMatch(/(src|href)=["']?https?:/);
    expect(withoutBook).not.toMatch(/@import|url\(https?:/);
  });

  it('never lets book text escape into markup', () => {
    const evil: BookBundle = structuredClone(sampleBook);
    const seg = evil.segments.find((s) => s.type === 'paragraph') as BookBundle['segments'][number];
    seg.src = '</script><script>alert(1)</script> *<img src=x onerror=alert(2)>*';
    const tr = evil.translations.find((t) => t.segmentId === seg.id);
    if (tr) tr.text = '<svg onload=alert(3)>';
    evil.book.titles.fa = '</title><script>alert(4)</script>';
    const html = buildOfflineHtml(evil, 'fa');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg onload');
    const book = buildOfflineBook(evil, 'fa');
    expect(JSON.stringify(book)).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });

  it('makes a safe file name', () => {
    expect(exportFileName("Rosen's: Emergency / Medicine?", 'bk')).toBe("Rosen's Emergency Medicine.html");
    expect(exportFileName('   ', 'bk_1')).toBe('bk_1.html');
    // Browsers save non-Latin names as «download»: Latin only, else the fallback.
    expect(exportFileName('گام‌به‌گام اندیشیدن', 'dozabaneh-bk_1')).toBe('dozabaneh-bk_1.html');
    expect(exportFileName('Café Über', 'bk')).toBe('Cafe Uber.html');
  });
});

describe('export route', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-export-'));
  const appPromise = buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }), { startRunner: false });
  afterAll(async () => {
    await (await appPromise).close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('downloads the offline reader of a book', async () => {
    const app = await appPromise;
    const res = await app.inject({ url: '/api/v1/books/bk_sample/export/offline?lang=fa' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Thinking in Steps.html"');
    expect(res.body).toContain('id="book"');
    expect((await app.inject({ url: '/api/v1/books/nope/export/offline' })).statusCode).toBe(404);
  });
});
