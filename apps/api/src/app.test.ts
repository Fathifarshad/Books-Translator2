import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { readConfig } from './config';

const config = readConfig({ LOG_LEVEL: 'silent', WEB_ORIGIN: 'http://localhost:5173' });
const app = await buildApp(config);
afterAll(() => app.close());

describe('GET /api/v1/health', () => {
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
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns the JSON error envelope for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('config', () => {
  it('rejects invalid engines', () => {
    expect(() => readConfig({ ENGINE_DEFAULT: 'gpt' })).toThrow();
  });

  it('splits multiple origins', () => {
    expect(readConfig({ WEB_ORIGIN: 'http://a, http://b' }).webOrigins).toEqual(['http://a', 'http://b']);
  });
});
