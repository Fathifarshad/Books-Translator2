import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { API_PREFIX } from '@dozabaneh/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db/client';
import { getSetting, setSetting } from './settings/store';

/**
 * Access from other devices (a student's phone over a tunnel, SPEC §16 «remote access»). Requests from this computer
 * (localhost, no proxy headers) are the owner and need nothing. Anything else needs the access password; a remote
 * login is a **reader**: it can read books, download them and use the tutor, but not change anything. Without a
 * password, remote access is off.
 */
export type Role = 'owner' | 'reader';

interface StoredPassword {
  salt: string;
  hash: string;
  /** HMAC key of session tokens; replaced when the password changes (signs everyone out). */
  signing: string;
}

const KEY = 'access:password';
const COOKIE = 'dz_session';
const SESSION_DAYS = 30;
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'cf-connecting-ip', 'cf-ray', 'x-real-ip'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/u;

/**
 * This computer: the connection comes from the loopback interface, the Host header is localhost, and no tunnel or
 * proxy header is present. (A device on the Wi-Fi cannot pass by faking the Host header: its address is not
 * loopback; a tunnel runs locally but always adds its forwarding headers.)
 */
export function isLocalRequest(req: Pick<FastifyRequest, 'headers' | 'ip'>): boolean {
  if (!LOOPBACK.test(req.ip)) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/u, '');
  return LOCAL_HOSTS.has(host);
}

export function clientIp(req: Pick<FastifyRequest, 'headers' | 'ip'>): string {
  const cf = req.headers['cf-connecting-ip'];
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  return (Array.isArray(cf) ? cf[0] : cf) ?? first ?? req.ip;
}

function cookieValue(req: Pick<FastifyRequest, 'headers'>, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const hashPassword = (password: string, salt: string) =>
  scryptSync(password.normalize('NFC'), Buffer.from(salt, 'base64'), 32).toString('base64');

export class AccessControl {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  private stored(): StoredPassword | undefined {
    return getSetting<StoredPassword>(this.db, KEY);
  }

  passwordSet(): boolean {
    return Boolean(this.stored());
  }

  /** Sets (or with null removes) the access password; every remote session ends. */
  setPassword(password: string | null): void {
    if (password === null) {
      this.db.$client.prepare('DELETE FROM app_settings WHERE key = ?').run(KEY);
      return;
    }
    const salt = randomBytes(16).toString('base64');
    setSetting(this.db, KEY, {
      salt,
      hash: hashPassword(password, salt),
      signing: randomBytes(32).toString('base64'),
    } satisfies StoredPassword);
  }

  /** Too many failed logins from one address in 10 minutes. */
  private limited(ip: string): boolean {
    const since = this.now() - 10 * 60_000;
    const recent = (this.attempts.get(ip) ?? []).filter((t) => t > since);
    this.attempts.set(ip, recent);
    return recent.length >= 10;
  }

  /** A session token when the password is right; 'limited' after too many failures. */
  login(password: string, ip: string): string | null | 'limited' {
    const s = this.stored();
    if (!s) return null;
    if (this.limited(ip)) return 'limited';
    const ok = timingSafeEqual(Buffer.from(hashPassword(password, s.salt), 'base64'), Buffer.from(s.hash, 'base64'));
    if (!ok) {
      this.attempts.set(ip, [...(this.attempts.get(ip) ?? []), this.now()]);
      return null;
    }
    const exp = this.now() + SESSION_DAYS * 86_400_000;
    return `v1.${exp}.${this.sign(`v1.${exp}`, s)}`;
  }

  private sign(payload: string, s: StoredPassword): string {
    return createHmac('sha256', Buffer.from(s.signing, 'base64')).update(payload).digest('base64url');
  }

  private validToken(token: string | undefined): boolean {
    const s = this.stored();
    if (!s || !token) return false;
    const [v, exp, mac] = token.split('.');
    if (v !== 'v1' || !exp || !mac || Number(exp) < this.now()) return false;
    const expected = Buffer.from(this.sign(`v1.${exp}`, s));
    const given = Buffer.from(mac);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  roleOf(req: Pick<FastifyRequest, 'headers' | 'ip'>): Role | null {
    if (isLocalRequest(req)) return 'owner';
    return this.validToken(cookieValue(req, COOKIE)) ? 'reader' : null;
  }

  sessionCookie(token: string, secure: boolean): string {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure ? '; Secure' : ''}`;
  }

  clearCookie(): string {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  /** The public link of the running tunnel (written by `pnpm share`), shown in Settings. */
  publicUrl(): string | null {
    return getSetting<string>(this.db, 'access:publicUrl') ?? null;
  }

  setPublicUrl(url: string | null): void {
    if (url === null) this.db.$client.prepare(`DELETE FROM app_settings WHERE key = 'access:publicUrl'`).run();
    else setSetting(this.db, 'access:publicUrl', url);
  }
}

const OPEN = [`${API_PREFIX}/health`, `${API_PREFIX}/auth/`];

/** What a remote reader may do: read (GET), use the assistant, and sign out. Settings stay with the owner. */
export function readerMay(method: string, path: string): boolean {
  if (path.startsWith(`${API_PREFIX}/settings/`))
    return method === 'GET' && path === `${API_PREFIX}/settings/providers`;
  if (method === 'GET' || method === 'HEAD') return true;
  return method === 'POST' && path.startsWith(`${API_PREFIX}/assist/`);
}

/**
 * onRequest hook for /api: owner from this computer, reader with a session, otherwise 401/403. Changes also need
 * a same-site Origin (when the browser sends one): a web page elsewhere cannot post to the local app (CSRF).
 */
export function accessHook(access: AccessControl, webOrigins: string[] = []) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith(`${API_PREFIX}/`)) return;
    const error = (status: number, code: string) =>
      reply.status(status).send({ error: { code, message: code, details: {} } });
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      const host = req.headers.host ?? '';
      const own = [`http://${host}`, `https://${host}`, ...webOrigins];
      if (!own.includes(origin)) return error(403, 'BAD_ORIGIN');
    }
    if (OPEN.some((p) => path === p || (p.endsWith('/') && path.startsWith(p)))) return;
    const role = access.roleOf(req);
    if (role === 'owner') return;
    if (!access.passwordSet()) return error(403, 'REMOTE_DISABLED');
    if (!role) return error(401, 'AUTH_REQUIRED');
    if (!readerMay(req.method, path)) return error(403, 'READ_ONLY');
  };
}
