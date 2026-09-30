import { API_PREFIX } from '@dozabaneh/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clientIp, isLocalRequest } from '../access';
import type { AppContext } from '../app';
import { httpError } from './errors';

const LoginBody = z.object({ password: z.string().min(1).max(200) });
const PasswordBody = z.object({ password: z.string().min(6).max(200).nullable() });
const PublicUrlBody = z.object({ url: z.url().max(300).nullable() });

/** Sign-in for other devices, and the owner's «دسترسی از موبایل» settings. */
export async function authRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { access } = ctx;
  const secure = (proto: string | string[] | undefined, protocol: string) =>
    protocol === 'https' || (Array.isArray(proto) ? proto[0] : proto) === 'https';

  app.get(`${API_PREFIX}/auth/me`, async (req) => ({
    role: access.roleOf(req),
    local: isLocalRequest(req),
    passwordSet: access.passwordSet(),
  }));

  app.post(`${API_PREFIX}/auth/login`, async (req, reply) => {
    const { password } = LoginBody.parse(req.body ?? {});
    if (!access.passwordSet()) throw httpError(403, 'REMOTE_DISABLED');
    const token = access.login(password, clientIp(req));
    if (token === 'limited') throw httpError(429, 'TOO_MANY_ATTEMPTS');
    if (!token) throw httpError(401, 'BAD_PASSWORD');
    reply.header('Set-Cookie', access.sessionCookie(token, secure(req.headers['x-forwarded-proto'], req.protocol)));
    return { role: 'reader' };
  });

  app.post(`${API_PREFIX}/auth/logout`, async (_req, reply) => {
    reply.header('Set-Cookie', access.clearCookie());
    return { ok: true };
  });

  // Owner only (the access hook lets remote readers see no /settings route but providers).
  app.get(`${API_PREFIX}/settings/access`, async () => ({
    passwordSet: access.passwordSet(),
    publicUrl: access.publicUrl(),
  }));

  app.put(`${API_PREFIX}/settings/access`, async (req) => {
    const { password } = PasswordBody.parse(req.body ?? {});
    access.setPassword(password);
    return { passwordSet: access.passwordSet(), publicUrl: access.publicUrl() };
  });

  app.put(`${API_PREFIX}/settings/access/public-url`, async (req) => {
    if (!isLocalRequest(req)) throw httpError(403, 'READ_ONLY');
    const { url } = PublicUrlBody.parse(req.body ?? {});
    access.setPublicUrl(url);
    return { publicUrl: access.publicUrl() };
  });
}
