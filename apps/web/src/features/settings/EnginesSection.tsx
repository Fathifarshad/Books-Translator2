import {
  ASSISTANT_ENGINES,
  type AssistantEngine,
  type ProviderId,
  type ProviderModelInfo,
  type ProviderTestResult,
  type ProviderUpdate,
  type ProviderView,
} from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ClipboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { uiLocale } from '../../i18n';
import { api, openRouterConnectUrl } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { providersKey, useProviders } from './engines';

const OLLAMA_DOWNLOAD = 'https://ollama.com/download';
const OLLAMA_LIBRARY = 'https://ollama.com/library';
/** Example only; the guide and the page point to the library for current model names. */
const OLLAMA_PULL_EXAMPLE = 'ollama pull aya-expanse';

const field = 'rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent/60';
const linkButton =
  'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover';

/** Settings → «موتور هوش مصنوعی»: connect Gemini (paste a key), OpenRouter (one click) or Ollama (local). */
export function EnginesSection() {
  const { t } = useTranslation();
  const providers = useProviders();
  const [params, setParams] = useSearchParams();
  const sectionRef = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Back from OpenRouter's «Authorize» page: show the outcome once and clean the URL.
  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('connect_error');
    if (!connected && !error) return;
    if (connected === 'openrouter') setNotice({ ok: true, text: t('engines.openrouter.connected') });
    else if (error)
      setNotice({
        ok: false,
        text: t(
          error === 'DENIED' || error === 'EXPIRED'
            ? `engines.openrouter.connectErrors.${error}`
            : 'engines.openrouter.connectErrors.other',
        ),
      });
    const next = new URLSearchParams(params);
    next.delete('connected');
    next.delete('connect_error');
    setParams(next, { replace: true });
    sectionRef.current?.scrollIntoView({ block: 'start' });
  }, [params, setParams, t]);

  const byId = (id: ProviderId) => providers.data?.providers.find((p) => p.id === id);

  return (
    <section
      ref={sectionRef}
      id="engines"
      className="mt-6 scroll-mt-4 rounded-2xl border border-border bg-surface p-5"
      data-testid="engines-section"
    >
      <h2 className="mb-2 text-lg font-bold">{t('engines.title')}</h2>
      <p className="text-sm leading-7 text-muted">{t('engines.intro')}</p>
      {notice ? (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`mt-3 rounded-xl px-4 py-3 text-sm ${notice.ok ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}
          data-testid="connect-notice"
        >
          {notice.text}
        </p>
      ) : null}

      {providers.isError ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {t('app.serverDown')}
        </p>
      ) : !providers.data ? (
        <p className="mt-4 text-sm text-muted">{t('app.loading')}</p>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          <GeminiCard view={byId('gemini') as ProviderView} />
          <OpenRouterCard view={byId('openrouter') as ProviderView} />
          <OllamaCard view={byId('ollama') as ProviderView} />
          <AssistantPicker />
        </div>
      )}
      <p className="mt-5 text-xs leading-6 text-muted">{t('settings.engineInfo')}</p>
    </section>
  );
}

/** Save + test through the API; keeps the settings list fresh. */
function useProviderActions(id: ProviderId) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: providersKey });
  const save = useMutation({
    mutationFn: (patch: ProviderUpdate) => api.updateProvider(id, patch),
    onSuccess: refresh,
  });
  const test = useMutation({ mutationFn: () => api.testProvider(id), onSettled: refresh });
  return { save, test };
}

function ProviderCard({ view, children }: { view: ProviderView; children: ReactNode }) {
  const { t } = useTranslation();
  const blocking = view.problem?.blocking;
  const state = view.ready ? 'ready' : blocking || view.keyUnreadable ? 'problem' : 'notConnected';
  return (
    <article className="rounded-xl border border-border bg-bg p-4" data-testid={`provider-${view.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold">
          <bdi>{t(`engines.names.${view.id}`)}</bdi>
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${state === 'ready' ? 'bg-accent-soft text-accent' : state === 'problem' ? 'bg-danger-soft text-danger' : 'bg-surface text-muted'}`}
          data-testid={`provider-${view.id}-status`}
        >
          {state === 'ready' ? <Icon name="check" size={12} className="me-1 inline" /> : null}
          {t(`engines.status.${state}`)}
        </span>
      </header>
      <p className="mt-1 text-xs text-muted">{t(`engines.taglines.${view.id}`)}</p>
      {view.ready || view.usage.usedToday > 0 ? <UsageLine view={view} /> : null}
      {view.keyUnreadable ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {t('engines.keyUnreadable')}
        </p>
      ) : null}
      {view.problem ? <ProblemLine problem={view.problem} /> : null}
      <div className="mt-3">{children}</div>
    </article>
  );
}

export function UsageLine({ view }: { view: Pick<ProviderView, 'model' | 'usage' | 'limits'> }) {
  const { t } = useTranslation();
  const time = view.usage.waitUntil
    ? new Intl.DateTimeFormat(uiLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(view.usage.waitUntil))
    : null;
  return (
    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {view.model ? (
        <span>
          {t('engines.modelLabel')}{' '}
          <bdi dir="ltr" className="font-mono">
            {view.model}
          </bdi>
        </span>
      ) : null}
      <span>{t('engines.usage', { used: fmtNum(view.usage.usedToday), limit: fmtNum(view.limits.rpd) })}</span>
      {time && view.usage.reason ? (
        <span className="text-warning">
          {t('engines.waitUntil', { reason: t(`engines.waitReasons.${view.usage.reason}`), time })}
        </span>
      ) : null}
    </p>
  );
}

export function ProblemLine({ problem }: { problem: NonNullable<ProviderView['problem']> }) {
  const { t } = useTranslation();
  const known = ['AUTH', 'NOT_FOUND', 'NETWORK', 'RATE_LIMIT', 'QUOTA'].includes(problem.code);
  return (
    <p role={problem.blocking ? 'alert' : undefined} className="mt-2 text-sm text-danger">
      {known ? t(`engines.errors.${problem.code}`) : t('engines.errors.OTHER', { message: problem.message })}
    </p>
  );
}

function TestOutcome({ result }: { result: ProviderTestResult | undefined }) {
  const { t } = useTranslation();
  if (!result) return null;
  if (result.ok)
    return (
      <p role="status" className="mt-2 text-sm text-accent" data-testid="test-ok">
        <Icon name="check" size={14} className="me-1 inline" />
        {t('engines.testOk', {
          model: result.model,
          seconds: fmtNum(Math.max(0.1, Math.round((result.latencyMs ?? 0) / 100) / 10)),
        })}
      </p>
    );
  const code = result.error?.code ?? 'OTHER';
  const known = ['AUTH', 'NOT_FOUND', 'NETWORK', 'RATE_LIMIT', 'QUOTA', 'NO_MODEL'].includes(code);
  return (
    <p role="alert" className="mt-2 text-sm text-danger" data-testid="test-error">
      {known ? t(`engines.errors.${code}`) : t('engines.errors.OTHER', { message: result.error?.message ?? '' })}
    </p>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent"
      >
        {fmtNum(n)}
      </span>
      <div className="min-w-0 flex-1 text-sm leading-7">{children}</div>
    </li>
  );
}

function ExternalLink({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        primary
          ? linkButton
          : 'inline-flex items-center gap-1 text-sm text-accent underline decoration-accent/40 underline-offset-4'
      }
    >
      {children}
      <Icon name="link" size={14} />
    </a>
  );
}

/** Gemini: open AI Studio → copy the key → paste here → saved and tested automatically. */
function GeminiCard({ view }: { view: ProviderView }) {
  const { t } = useTranslation();
  const { save, test } = useProviderActions('gemini');
  const [key, setKey] = useState('');
  const [pasteHint, setPasteHint] = useState(false);
  const inputId = useId();
  const busy = save.isPending || test.isPending;

  const saveAndTest = (value: string) => {
    const apiKey = value.trim();
    if (apiKey.length < 20) return;
    save.mutate(
      { apiKey },
      {
        onSuccess: () => {
          setKey('');
          test.mutate();
        },
      },
    );
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (text.trim().length >= 20) {
      e.preventDefault();
      setKey(text.trim());
      saveAndTest(text);
    }
  };
  const fromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setKey(text.trim());
      saveAndTest(text);
    } catch {
      setPasteHint(true);
      document.getElementById(inputId)?.focus();
    }
  };

  return (
    <ProviderCard view={view}>
      <ol className="flex flex-col gap-3">
        <Step n={1}>
          <p>{t('engines.gemini.step1')}</p>
          <div className="mt-2">
            <ExternalLink href={view.keyUrl ?? ''} primary>
              {t('engines.gemini.open')}
            </ExternalLink>
          </div>
        </Step>
        <Step n={2}>
          <label htmlFor={inputId}>{t('engines.gemini.step2')}</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id={inputId}
              type="password"
              // The key is Latin; the placeholder stays in the UI language and font.
              dir={key ? 'ltr' : undefined}
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onPaste={onPaste}
              placeholder={t('engines.keyPlaceholder')}
              className={`${field} min-w-0 basis-full sm:basis-0 sm:flex-1 ${key ? 'font-mono' : ''}`}
              data-testid="gemini-key"
            />
            <Button icon="copy" onClick={() => void fromClipboard()} disabled={busy}>
              {t('engines.pasteFromClipboard')}
            </Button>
            <Button
              variant="primary"
              onClick={() => saveAndTest(key)}
              disabled={busy || key.trim().length < 20}
              data-testid="gemini-save"
            >
              {busy ? t('engines.testing') : t('engines.saveAndTest')}
            </Button>
          </div>
          {pasteHint ? <p className="mt-1 text-xs text-muted">{t('engines.pasteHint')}</p> : null}
        </Step>
      </ol>
      {view.hasKey ? (
        <KeyRow view={view} onTest={() => test.mutate()} busy={busy} onRemove={() => save.mutate({ apiKey: null })} />
      ) : null}
      <TestOutcome result={test.data} />
      <p className="mt-3 text-xs leading-6 text-muted">{t('engines.gemini.privacy')}</p>
      {view.hasKey ? <Advanced view={view} /> : null}
    </ProviderCard>
  );
}

function KeyRow({
  view,
  onTest,
  onRemove,
  busy,
  removeLabel,
}: {
  view: ProviderView;
  onTest: () => void;
  onRemove: () => void;
  busy: boolean;
  removeLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">
        {t('engines.keyLabel')}{' '}
        <bdi dir="ltr" className="font-mono">
          {view.keyHint}
        </bdi>
        {view.connectedVia === 'oauth' ? ` · ${t('engines.viaOauth')}` : ''}
      </span>
      <Button onClick={onTest} disabled={busy} data-testid={`test-${view.id}`}>
        {busy ? t('engines.testing') : t('engines.test')}
      </Button>
      <Button variant="ghost" icon="trash" onClick={onRemove} disabled={busy}>
        {removeLabel ?? t('engines.removeKey')}
      </Button>
    </div>
  );
}

/** OpenRouter: one click → OpenRouter's «Authorize» page → back here with the key stored (OAuth PKCE). */
function OpenRouterCard({ view }: { view: ProviderView }) {
  const { t } = useTranslation();
  const { save, test } = useProviderActions('openrouter');
  const connect = () => {
    window.location.assign(openRouterConnectUrl(`${window.location.origin}/settings?tab=engines`));
  };
  return (
    <ProviderCard view={view}>
      <p className="text-sm leading-7">{t('engines.openrouter.explain')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" icon="link" onClick={connect} data-testid="openrouter-connect">
          {view.hasKey ? t('engines.openrouter.reconnect') : t('engines.openrouter.connect')}
        </Button>
      </div>
      {view.hasKey ? (
        <KeyRow
          view={view}
          onTest={() => test.mutate()}
          busy={save.isPending || test.isPending}
          onRemove={() => save.mutate({ apiKey: null })}
          removeLabel={t('engines.disconnect')}
        />
      ) : null}
      <TestOutcome result={test.data} />
      <p className="mt-3 text-xs leading-6 text-muted">{t('engines.openrouter.limits')}</p>
      {view.hasKey ? <Advanced view={view} freeOnly /> : null}
    </ProviderCard>
  );
}

/** Ollama: install, pull a model, detect it here, pick a model. No key. */
function OllamaCard({ view }: { view: ProviderView }) {
  const { t } = useTranslation();
  const { save, test } = useProviderActions('ollama');
  const models = useQuery({
    queryKey: ['provider-models', 'ollama', view.baseUrl],
    queryFn: () => api.providerModels('ollama'),
    retry: false,
    staleTime: 10_000,
  });
  const [copied, setCopied] = useState(false);
  const list = (models.data?.models ?? []).filter((m) => !/embed/iu.test(m.id));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(OLLAMA_PULL_EXAMPLE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Selecting the command by hand still works.
    }
  };

  return (
    <ProviderCard view={view}>
      <ol className="flex flex-col gap-3">
        <Step n={1}>
          <p>{t('engines.ollama.step1')}</p>
          <div className="mt-2">
            <ExternalLink href={OLLAMA_DOWNLOAD}>{t('engines.ollama.download')}</ExternalLink>
          </div>
        </Step>
        <Step n={2}>
          <p>
            {t('engines.ollama.step2')} <ExternalLink href={OLLAMA_LIBRARY}>{t('engines.ollama.library')}</ExternalLink>
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code dir="ltr" className="rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-sm">
              {OLLAMA_PULL_EXAMPLE}
            </code>
            <Button variant="ghost" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
              {copied ? t('engines.ollama.copied') : t('engines.ollama.copy')}
            </Button>
          </div>
        </Step>
        <Step n={3}>
          <p>{t('engines.ollama.step3')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button icon="history" onClick={() => void models.refetch()} disabled={models.isFetching}>
              {t('engines.ollama.recheck')}
            </Button>
            <span className={`text-sm ${models.isError ? 'text-danger' : 'text-muted'}`} data-testid="ollama-detect">
              {models.isError
                ? t('engines.ollama.notFound')
                : models.data
                  ? list.length
                    ? t('engines.ollama.found', { n: fmtNum(list.length) })
                    : t('engines.ollama.noModels')
                  : t('app.loading')}
            </span>
          </div>
          {list.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <ModelSelect
                value={view.model}
                models={list}
                onChange={(model) => save.mutate({ model }, { onSuccess: () => test.mutate() })}
                testId="ollama-model"
              />
              {view.model ? (
                <Button onClick={() => test.mutate()} disabled={test.isPending} data-testid="test-ollama">
                  {test.isPending ? t('engines.testing') : t('engines.test')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Step>
      </ol>
      <TestOutcome result={test.data} />
      <p className="mt-3 text-xs leading-6 text-muted">{t('engines.ollama.hint')}</p>
      <Advanced view={view} showModel={false} showBaseUrl />
    </ProviderCard>
  );
}

function ModelSelect({
  value,
  models,
  onChange,
  testId,
}: {
  value: string;
  models: ProviderModelInfo[];
  onChange: (model: string) => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const known = models.some((m) => m.id === value);
  return (
    <select
      aria-label={t('engines.chooseModel')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${field} max-w-full font-mono`}
      dir="ltr"
      data-testid={testId}
    >
      {!value ? <option value="">{t('engines.pickModel')}</option> : null}
      {value && !known ? <option value={value}>{value}</option> : null}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.id}
          {m.free ? ` ${t('engines.freeSuffix')}` : ''}
        </option>
      ))}
    </select>
  );
}

/** Model, request limits and (Ollama) the service address. */
function Advanced({
  view,
  freeOnly = false,
  showModel = true,
  showBaseUrl = false,
}: {
  view: ProviderView;
  freeOnly?: boolean;
  showModel?: boolean;
  showBaseUrl?: boolean;
}) {
  const { t } = useTranslation();
  const { save } = useProviderActions(view.id);
  const [open, setOpen] = useState(false);
  const [rpm, setRpm] = useState(view.limits.rpm);
  const [rpd, setRpd] = useState(view.limits.rpd);
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const models = useQuery({
    queryKey: ['provider-models', view.id, view.baseUrl],
    queryFn: () => api.providerModels(view.id),
    enabled: open && showModel,
    retry: false,
    staleTime: 60_000,
  });
  const list = (models.data?.models ?? []).filter((m) => !freeOnly || m.free);

  return (
    <details className="mt-3" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm text-muted hover:text-text">{t('engines.advanced')}</summary>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        {showModel ? (
          <div className="flex flex-col gap-1">
            <span>{t('engines.chooseModel')}</span>
            {list.length ? (
              <ModelSelect value={view.model} models={list} onChange={(model) => save.mutate({ model })} />
            ) : (
              <span className="text-xs text-muted">{models.isFetching ? t('app.loading') : view.model || '—'}</span>
            )}
          </div>
        ) : null}
        <fieldset className="flex flex-wrap items-end gap-3">
          <legend className="mb-1">{t('engines.limits')}</legend>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t('engines.rpm')}</span>
            <input
              type="number"
              min={1}
              value={rpm}
              onChange={(e) => setRpm(Number(e.target.value))}
              className={`${field} w-24`}
              dir="ltr"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t('engines.rpd')}</span>
            <input
              type="number"
              min={1}
              value={rpd}
              onChange={(e) => setRpd(Number(e.target.value))}
              className={`${field} w-28`}
              dir="ltr"
            />
          </label>
          <Button onClick={() => save.mutate({ limits: { rpm, rpd } })} disabled={save.isPending || rpm < 1 || rpd < 1}>
            {t('engines.save')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setRpm(view.defaultLimits.rpm);
              setRpd(view.defaultLimits.rpd);
              save.mutate({ limits: null });
            }}
          >
            {t('engines.resetDefaults')}
          </Button>
        </fieldset>
        {showBaseUrl ? (
          <label className="flex flex-col gap-1">
            <span>{t('engines.baseUrl')}</span>
            <div className="flex flex-wrap gap-2">
              <input
                type="url"
                dir="ltr"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className={`${field} min-w-0 flex-1 font-mono`}
              />
              <Button onClick={() => save.mutate({ baseUrl })} disabled={save.isPending}>
                {t('engines.save')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setBaseUrl(view.defaultBaseUrl);
                  save.mutate({ baseUrl: null });
                }}
              >
                {t('engines.resetDefaults')}
              </Button>
            </div>
          </label>
        ) : null}
      </div>
    </details>
  );
}

/** Which engine answers «بپرس از مدرس» and writes summaries and quizzes. */
function AssistantPicker() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useProviders();
  // Local choice so the radio follows the click at once (the server answer arrives a moment later).
  const [choice, setChoice] = useState<AssistantEngine | null>(null);
  const set = useMutation({
    mutationFn: api.setAssistant,
    onSettled: () => queryClient.invalidateQueries({ queryKey: providersKey }),
    onError: () => setChoice(null),
  });
  if (!data) return null;
  const readyOf = (id: string) => id === 'mock' || data.providers.find((p) => p.id === id)?.ready === true;
  return (
    <fieldset className="rounded-xl border border-border bg-bg p-4" data-testid="assistant-engine">
      <legend className="px-1 font-bold">{t('engines.assistant.title')}</legend>
      <p className="text-xs text-muted">{t('engines.assistant.hint')}</p>
      <div className="mt-2 flex flex-col gap-1.5 text-sm">
        {ASSISTANT_ENGINES.map((id) => (
          <label key={id} className={`flex items-center gap-2 ${readyOf(id) ? '' : 'text-muted'}`}>
            <input
              type="radio"
              name="assistant-engine"
              value={id}
              checked={(choice ?? data.assistant.engine) === id}
              disabled={!readyOf(id)}
              onChange={() => {
                setChoice(id);
                set.mutate(id);
              }}
            />
            <span>
              {id === 'mock' ? t('engines.assistant.mock') : <bdi>{t(`engines.names.${id}`)}</bdi>}
              {readyOf(id) ? '' : ` ${t('engines.assistant.notReady')}`}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
