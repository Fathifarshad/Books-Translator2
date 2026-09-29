import { ProviderError, pickDefaultModel } from '@dozabaneh/ai';
import { API_PREFIX, isProviderId, type ProviderId, ProviderUpdateSchema } from '@dozabaneh/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app';
import { authorizeUrl, exchangeCode, OAuthFlows } from '../settings/oauth';
import { httpError } from './errors';

const providerOf = (id: string): ProviderId => {
  if (!isProviderId(id)) throw httpError(404, 'PROVIDER_NOT_FOUND');
  return id;
};

const providerFailure = (err: unknown) => {
  if (err instanceof ProviderError) return httpError(502, `PROVIDER_${err.code}`, { message: err.message });
  return err;
};

/** Settings → «موتور هوش مصنوعی»: free providers, keys (write-only) and the one-click OpenRouter connection. */
export async function settingsRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const { providers } = ctx;
  const flows = new OAuthFlows();
  const base = `${API_PREFIX}/settings/providers`;

  const originOf = (req: FastifyRequest) => `${req.protocol}://${req.headers.host ?? `${req.hostname}`}`;
  /** Only back to our own web app (configured origins, or the origin this request came through). */
  const safeReturn = (req: FastifyRequest, raw: unknown): string => {
    const own = originOf(req);
    if (typeof raw === 'string') {
      try {
        const url = new URL(raw, own);
        if (url.origin === own || ctx.config.webOrigins.includes(url.origin)) return url.toString();
      } catch {
        // fall through
      }
    }
    return `${own}/settings`;
  };
  const withParam = (url: string, key: string, value: string) => {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  };

  app.get(base, async () => ({ providers: providers.views() }));

  app.put<{ Params: { id: string } }>(`${base}/:id`, async (req) => {
    const id = providerOf(req.params.id);
    const patch = ProviderUpdateSchema.parse(req.body ?? {});
    const view = providers.update(id, patch);
    ctx.runner.kick();
    return view;
  });

  app.post<{ Params: { id: string } }>(`${base}/:id/test`, async (req) => {
    const id = providerOf(req.params.id);
    const result = await providers.test(id);
    if (result.ok) ctx.runner.kick();
    return { ...result, provider: providers.view(id) };
  });

  app.get<{ Params: { id: string } }>(`${base}/:id/models`, async (req) => {
    const id = providerOf(req.params.id);
    try {
      return { models: await providers.models(id) };
    } catch (err) {
      throw providerFailure(err);
    }
  });

  // One-click connection: the page navigates here; we send the browser to OpenRouter's «Authorize» page.
  app.get<{ Querystring: { return?: string } }>(`${base}/openrouter/connect`, async (req, reply) => {
    const returnTo = safeReturn(req, req.query.return);
    const { state, challenge } = flows.begin(returnTo);
    const callback = `${originOf(req)}${base}/openrouter/callback/${state}`;
    return reply.redirect(authorizeUrl(ctx.config.OPENROUTER_AUTH_URL, callback, challenge));
  });

  app.get<{ Params: { state: string }; Querystring: { code?: string } }>(
    `${base}/openrouter/callback/:state`,
    async (req, reply) => {
      const pending = flows.take(req.params.state);
      if (!pending) return reply.redirect(withParam(safeReturn(req, undefined), 'connect_error', 'EXPIRED'));
      const code = req.query.code;
      if (!code) return reply.redirect(withParam(pending.returnTo, 'connect_error', 'DENIED'));
      try {
        const key = await exchangeCode(providers.baseUrl('openrouter'), code, pending.verifier);
        const view = providers.update('openrouter', { apiKey: key }, 'oauth');
        if (!view.model) {
          // Pick a free model right away; the settings page can change it.
          const model = await providers
            .models('openrouter')
            .then((list) => pickDefaultModel('openrouter', list))
            .catch(() => '');
          if (model) providers.update('openrouter', { model });
        }
        ctx.runner.kick();
        return reply.redirect(withParam(pending.returnTo, 'connected', 'openrouter'));
      } catch (err) {
        req.log.warn({ code: err instanceof ProviderError ? err.code : 'UNKNOWN' }, 'openrouter connect failed');
        const reason = err instanceof ProviderError ? err.code : 'UNKNOWN';
        return reply.redirect(withParam(pending.returnTo, 'connect_error', reason));
      }
    },
  );
}
