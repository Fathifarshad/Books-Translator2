import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { isLocalRequest, readerMay } from './access';
import { buildApp } from './app';
import { readConfig } from './config';
import { serveWeb } from './static';

/** Access from other devices: owner on this computer, password + read-only reader through a tunnel. */
const dataDir = mkdtempSync(join(tmpdir(), 'dozabaneh-access-'));
const app = await buildApp(readConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }), { startRunner: false });
afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** A request as it arrives through a tunnel (Cloudflare adds these headers). */
const remote = (extra: Record<string, string> = {}) => ({
  host: 'calm-river.trycloudflare.com',
  'cf-connecting-ip': '203.0.113.7',
  'x-forwarded-for': '203.0.113.7',
  'x-forwarded-proto': 'https',
  ...extra,
});

describe('who is asking', () => {
  it('treats localhost without proxy headers as this computer', () => {
    const ip = '127.0.0.1';
    expect(isLocalRequest({ ip, headers: { host: 'localhost:5173' } })).toBe(true);
    expect(isLocalRequest({ ip: '::1', headers: { host: '127.0.0.1:8787' } })).toBe(true);
    expect(isLocalRequest({ ip, headers: { host: 'localhost:5173', 'x-forwarded-for': '1.2.3.4' } })).toBe(false);
    expect(isLocalRequest({ ip, headers: { host: 'calm-river.trycloudflare.com' } })).toBe(false);
    expect(isLocalRequest({ ip, headers: { host: 'evil.example' } })).toBe(false);
    // A device on the Wi-Fi cannot become the owner by faking the Host header.
    expect(isLocalRequest({ ip: '192.168.1.23', headers: { host: 'localhost:8787' } })).toBe(false);
  });

  it('lets readers read and use the assistant only', () => {
    expect(readerMay('GET', '/api/v1/books/bk_1/bundle')).toBe(true);
    expect(readerMay('POST', '/api/v1/assist/tutor')).toBe(true);
    expect(readerMay('GET', '/api/v1/settings/providers')).toBe(true);
    expect(readerMay('GET', '/api/v1/settings/access')).toBe(false);
    expect(readerMay('GET', '/api/v1/settings/providers/openrouter/connect')).toBe(false);
    expect(readerMay('POST', '/api/v1/books')).toBe(false);
    expect(readerMay('PATCH', '/api/v1/segments/sg_1/translation')).toBe(false);
    expect(readerMay('DELETE', '/api/v1/books/bk_1')).toBe(false);
  });
});

describe('remote access', () => {
  it('is off until the owner sets a password', async () => {
    const res = await app.inject({ url: '/api/v1/books', headers: remote() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('REMOTE_DISABLED');
    expect((await app.inject({ url: '/api/v1/books' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/health', headers: remote() })).statusCode).toBe(200);
  });

  it('only the owner can set the password', async () => {
    const denied = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/access',
      headers: remote(),
      payload: { password: 'hijack-123' },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PUT', url: '/api/v1/settings/access', payload: { password: 'secret-42' } });
    expect(ok.json()).toEqual({ passwordSet: true, publicUrl: null });
    expect(
      (await app.inject({ method: 'PUT', url: '/api/v1/settings/access', payload: { password: '123' } })).statusCode,
    ).toBe(400);
  });

  it('asks remote devices to sign in, and a session reads but cannot change anything', async () => {
    const anon = await app.inject({ url: '/api/v1/books', headers: remote() });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error.code).toBe('AUTH_REQUIRED');

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: remote(),
      payload: { password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: remote(),
      payload: { password: 'secret-42' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/^dz_session=v1\.\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
    const session = remote({ cookie: cookie.split(';')[0] as string });

    expect((await app.inject({ url: '/api/v1/auth/me', headers: session })).json()).toMatchObject({
      role: 'reader',
      local: false,
    });
    expect((await app.inject({ url: '/api/v1/books', headers: session })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/books/bk_sample/bundle', headers: session })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/books/bk_sample/export/offline', headers: session })).statusCode).toBe(
      200,
    );
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/books/bk_sample', headers: session });
    expect(del.statusCode).toBe(403);
    expect(del.json().error.code).toBe('READ_ONLY');
    expect((await app.inject({ url: '/api/v1/settings/access', headers: session })).statusCode).toBe(403);

    // A forged or stale cookie is not a session; a new password signs everyone out.
    const forged = remote({ cookie: 'dz_session=v1.99999999999999.AAAA' });
    expect((await app.inject({ url: '/api/v1/books', headers: forged })).statusCode).toBe(401);
    await app.inject({ method: 'PUT', url: '/api/v1/settings/access', payload: { password: 'another-42' } });
    expect((await app.inject({ url: '/api/v1/books', headers: session })).statusCode).toBe(401);
  });

  it('refuses changes posted by a web page from another site (CSRF)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/books/bk_sample',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BAD_ORIGIN');
    const same = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/assistant',
      headers: { origin: 'http://localhost:5173' },
      payload: { engine: 'mock' },
    });
    expect(same.statusCode).toBe(200);
  });

  it('treats a device on the Wi-Fi as remote even when it fakes the Host header', async () => {
    const res = await app.inject({
      url: '/api/v1/books',
      remoteAddress: '192.168.1.23',
      headers: { host: 'localhost' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('slows down password guessing', async () => {
    const guess = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: remote({ 'cf-connecting-ip': '198.51.100.9' }),
        payload: { password: 'guess' },
      });
    for (let i = 0; i < 10; i++) expect((await guess()).statusCode).toBe(401);
    expect((await guess()).statusCode).toBe(429);
  });

  it('remembers the public link written by `pnpm share`', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings/access/public-url',
      payload: { url: 'https://calm-river.trycloudflare.com' },
    });
    expect(put.json()).toEqual({ publicUrl: 'https://calm-river.trycloudflare.com' });
    expect((await app.inject({ url: '/api/v1/settings/access' })).json().publicUrl).toBe(
      'https://calm-river.trycloudflare.com',
    );
  });
});

describe('serving the web app', () => {
  it('serves files, falls back to index.html and never leaves the folder', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'dozabaneh-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(dist, 'assets', 'app-123.js'), 'console.log(1)');
    writeFileSync(join(dataDir, 'secret.txt'), 'nope');
    const web = Fastify();
    expect(serveWeb(web, dist)).toBe(true);
    const js = await web.inject({ url: '/assets/app-123.js' });
    expect(js.headers['content-type']).toContain('text/javascript');
    expect(js.headers['cache-control']).toContain('immutable');
    const route = await web.inject({ url: '/books/bk_1/read' });
    expect(route.body).toContain('<title>app</title>');
    const outside = await web.inject({ url: '/../../../../etc/passwd' });
    expect(outside.body).toContain('<title>app</title>');
    const encoded = await web.inject({ url: '/%2e%2e/%2e%2e/secret.txt' });
    expect(encoded.body).not.toContain('nope');
    expect((await web.inject({ url: '/api/v1/unknown' })).statusCode).toBe(404);
    await web.close();
    rmSync(dist, { recursive: true, force: true });
  });
});
