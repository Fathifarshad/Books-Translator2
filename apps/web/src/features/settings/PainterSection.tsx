import {
  CLOUDFLARE_IMAGE_MODELS,
  PAINTER_ENGINES,
  type PainterTestResult,
  type PainterUpdate,
} from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtNum } from '../../lib/format';

const field = 'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent/60';
const LINKS = {
  signup: 'https://dash.cloudflare.com/sign-up',
  dashboard: 'https://dash.cloudflare.com/',
  tokens: 'https://dash.cloudflare.com/profile/api-tokens',
  comfy: 'https://github.com/comfyanonymous/ComfyUI',
  flux: 'https://huggingface.co/Comfy-Org/flux1-schnell',
};
export const painterKey = ['painter'] as const;

function Result({ result }: { result: PainterTestResult | undefined }) {
  const { t } = useTranslation();
  if (!result) return null;
  return result.ok ? (
    <p className="flex items-center gap-1.5 text-sm text-success" role="status" data-testid="painter-test-ok">
      <Icon name="check" size={15} />
      {t('painter.testOk', { ms: fmtNum(result.ms ?? 0) })}
    </p>
  ) : (
    <p className="text-sm text-danger" role="alert" data-testid="painter-test-error">
      {t(`painter.errors.${result.error ?? 'generic'}`, { defaultValue: t('painter.errors.generic') })}
    </p>
  );
}

/**
 * Settings → «تصویرسازی جلد» (ADR-048, stage 2): who draws the pictures of AI covers — Cloudflare Workers AI (free
 * daily allowance; account id and a token, kept encrypted on this computer) or a model on this computer through
 * ComfyUI. Each comes with the steps to set it up and a check that draws nothing.
 */
export function PainterSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const view = useQuery({ queryKey: painterKey, queryFn: api.painter, retry: false });
  const save = useMutation({
    mutationFn: (patch: PainterUpdate) => api.updatePainter(patch),
    onSuccess: (v) => queryClient.setQueryData(painterKey, v),
  });
  const testCf = useMutation({ mutationFn: () => api.testPainter('cloudflare') });
  const testComfy = useMutation({ mutationFn: () => api.testPainter('comfy') });
  const [account, setAccount] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [comfyUrl, setComfyUrl] = useState<string | null>(null);

  const data = view.data;
  if (!data) {
    return (
      <section id="painter" className="mt-6 scroll-mt-4 rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-2 text-lg font-bold">{t('painter.title')}</h2>
        <p className="text-sm text-muted">{view.isError ? t('app.serverDown') : t('app.loading')}</p>
      </section>
    );
  }
  const accountValue = account ?? data.cloudflare.accountId ?? '';
  const accountOk = /^[0-9a-f]{32}$/i.test(accountValue.trim());
  const checkpoints = testComfy.data?.checkpoints ?? (data.comfy.checkpoint ? [data.comfy.checkpoint] : []);

  return (
    <section
      id="painter"
      className="mt-6 scroll-mt-4 rounded-2xl border border-border bg-surface p-5"
      data-testid="painter-section"
    >
      <h2 className="mb-2 text-lg font-bold">{t('painter.title')}</h2>
      <p className="text-sm leading-7 text-muted">{t('painter.intro')}</p>

      <div role="radiogroup" aria-label={t('painter.engine')} className="mt-4 flex flex-wrap gap-2">
        {PAINTER_ENGINES.map((e) => (
          // biome-ignore lint/a11y/useSemanticElements: pill buttons as a radio group
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={data.engine === e}
            onClick={() => save.mutate({ engine: e })}
            className="rounded-full border border-border px-3.5 py-1 text-sm text-muted aria-checked:border-accent/60 aria-checked:bg-accent-soft aria-checked:text-accent"
            data-testid={`painter-engine-${e}`}
          >
            {t(`painter.engines.${e}`)}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4" data-testid="painter-cloudflare">
        <h3 className="font-bold">{t('painter.cloudflare.title')}</h3>
        <ol className="space-y-1.5 ps-5 text-sm leading-7 [list-style-type:persian]">
          <li>
            {t('painter.cloudflare.step1')}{' '}
            <a href={LINKS.signup} target="_blank" rel="noopener noreferrer" className="text-accent underline">
              dash.cloudflare.com/sign-up
            </a>
          </li>
          <li>
            {t('painter.cloudflare.step2')}{' '}
            <a href={LINKS.dashboard} target="_blank" rel="noopener noreferrer" className="text-accent underline">
              dash.cloudflare.com
            </a>
          </li>
          <li>
            {t('painter.cloudflare.step3')}{' '}
            <a href={LINKS.tokens} target="_blank" rel="noopener noreferrer" className="text-accent underline">
              {t('painter.cloudflare.tokensPage')}
            </a>
          </li>
          <li>{t('painter.cloudflare.step4')}</li>
        </ol>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('painter.cloudflare.account')}</span>
          <input
            dir="ltr"
            value={accountValue}
            onChange={(e) => setAccount(e.target.value)}
            className={`${field} font-mono`}
            placeholder="0123456789abcdef0123456789abcdef"
            data-testid="cf-account"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            {t('painter.cloudflare.token')}
            {data.cloudflare.hasToken ? (
              <span className="ms-2 text-xs text-muted">
                {t('painter.cloudflare.stored', { hint: data.cloudflare.tokenHint })}
              </span>
            ) : null}
          </span>
          <input
            dir="ltr"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className={`${field} font-mono`}
            data-testid="cf-token"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('painter.cloudflare.model')}</span>
          <select
            value={data.cloudflare.model}
            onChange={(e) =>
              save.mutate({ cloudflareModel: e.target.value as (typeof CLOUDFLARE_IMAGE_MODELS)[number] })
            }
            className={field}
            data-testid="cf-model"
          >
            {CLOUDFLARE_IMAGE_MODELS.map((m) => (
              <option key={m} value={m}>
                {t(`painter.cloudflare.models.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!accountOk || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  engine: 'cloudflare',
                  cloudflareAccountId: accountValue.trim(),
                  ...(token.trim() ? { cloudflareToken: token.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    setToken('');
                    testCf.mutate();
                  },
                },
              )
            }
            data-testid="cf-save"
          >
            {t('painter.saveAndTest')}
          </Button>
          {data.cloudflare.hasToken ? (
            <Button variant="ghost" onClick={() => save.mutate({ cloudflareToken: null })}>
              {t('painter.cloudflare.removeToken')}
            </Button>
          ) : null}
        </div>
        {!accountOk && accountValue ? (
          <p className="text-xs text-danger">{t('painter.cloudflare.accountFormat')}</p>
        ) : null}
        <Result result={testCf.data} />
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4" data-testid="painter-comfy">
        <h3 className="font-bold">{t('painter.comfy.title')}</h3>
        <p className="text-sm leading-7 text-muted">{t('painter.comfy.intro')}</p>
        <ol className="space-y-1.5 ps-5 text-sm leading-7 [list-style-type:persian]">
          <li>
            {t('painter.comfy.step1')}{' '}
            <a href={LINKS.comfy} target="_blank" rel="noopener noreferrer" className="text-accent underline">
              ComfyUI
            </a>
          </li>
          <li>
            {t('painter.comfy.step2')}{' '}
            <a href={LINKS.flux} target="_blank" rel="noopener noreferrer" className="text-accent underline">
              flux1-schnell
            </a>
          </li>
          <li>{t('painter.comfy.step3')}</li>
        </ol>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{t('painter.comfy.url')}</span>
          <input
            dir="ltr"
            value={comfyUrl ?? data.comfy.url}
            onChange={(e) => setComfyUrl(e.target.value)}
            className={`${field} font-mono`}
            data-testid="comfy-url"
          />
        </label>
        <div>
          <Button
            onClick={() =>
              save.mutate({ comfyUrl: (comfyUrl ?? data.comfy.url).trim() }, { onSuccess: () => testComfy.mutate() })
            }
            disabled={save.isPending || testComfy.isPending}
            data-testid="comfy-test"
          >
            {testComfy.isPending ? t('painter.testing') : t('painter.comfy.connect')}
          </Button>
        </div>
        {checkpoints.length ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('painter.comfy.checkpoint')}</span>
            <select
              value={data.comfy.checkpoint}
              onChange={(e) => save.mutate({ comfyCheckpoint: e.target.value })}
              className={field}
              dir="ltr"
              data-testid="comfy-checkpoint"
            >
              <option value="">—</option>
              {checkpoints.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Result result={testComfy.data} />
      </div>
    </section>
  );
}
