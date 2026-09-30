import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Serves the built web app (apps/web/dist) from the API in share mode (`pnpm share`), so one address — also through
 * a tunnel — gives the app and its API. Unknown paths fall back to index.html (client-side routes).
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function serveWeb(app: FastifyInstance, distDir: string): boolean {
  const root = resolve(distDir);
  const index = join(root, 'index.html');
  if (!existsSync(index)) return false;
  app.setNotFoundHandler((req, reply) => {
    const path = decodeURIComponent((req.url.split('?')[0] ?? '/').replace(/\+/g, ' '));
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path.startsWith('/api/')) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND', details: {} } });
    }
    let file = resolve(root, `.${path}`);
    if (!(file === root || file.startsWith(root + sep))) file = index;
    if (!existsSync(file) || statSync(file).isDirectory()) file = index;
    const immutable = file.includes(`${sep}assets${sep}`);
    return reply
      .header('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
      .header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .header('X-Content-Type-Options', 'nosniff')
      .send(readFileSync(file));
  });
  return true;
}
