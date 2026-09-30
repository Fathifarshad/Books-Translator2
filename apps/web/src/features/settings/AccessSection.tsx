import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';

const field = 'rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent/60';
const accessKey = ['settings', 'access'] as const;

/** Settings → «دسترسی از موبایل»: the offline file, and online access with a password through `pnpm share`. */
export function AccessSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // The public link appears once `pnpm share` has started the tunnel: refresh while the page is open.
  const access = useQuery({ queryKey: accessKey, queryFn: api.accessSettings, refetchInterval: 10_000 });
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: (value: string | null) => api.setAccessPassword(value),
    onSuccess: (data) => {
      queryClient.setQueryData(accessKey, data);
      setPassword('');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length >= 6) save.mutate(password);
  };
  const link = access.data?.publicUrl ?? null;
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // select by hand
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5" data-testid="access-section">
      <h2 className="mb-2 text-lg font-bold">{t('mobile.title')}</h2>
      <p className="text-sm leading-7 text-muted">{t('mobile.intro')}</p>

      <article className="mt-4 rounded-xl border border-border bg-bg p-4">
        <h3 className="font-bold">{t('mobile.offlineTitle')}</h3>
        <p className="mt-1 text-sm leading-7">{t('mobile.offlineSteps')}</p>
      </article>

      <article className="mt-4 rounded-xl border border-border bg-bg p-4">
        <h3 className="font-bold">{t('mobile.onlineTitle')}</h3>
        <p className="mt-1 text-sm leading-7 text-muted">{t('mobile.onlineIntro')}</p>
        <ol className="mt-3 flex list-inside list-decimal flex-col gap-3 text-sm leading-7">
          <li>
            {t('mobile.step1')}
            <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('mobile.passwordPlaceholder')}
                aria-label={t('access.password')}
                className={`${field} min-w-0 basis-full sm:basis-auto sm:flex-1`}
                data-testid="set-access-password"
              />
              <Button type="submit" variant="primary" disabled={password.length < 6 || save.isPending}>
                {access.data?.passwordSet ? t('mobile.changePassword') : t('mobile.setPassword')}
              </Button>
              {access.data?.passwordSet ? (
                <Button variant="ghost" icon="trash" onClick={() => save.mutate(null)} disabled={save.isPending}>
                  {t('mobile.turnOff')}
                </Button>
              ) : null}
            </form>
            <p className="mt-1 text-xs text-muted" data-testid="access-status">
              {access.data?.passwordSet ? t('mobile.passwordOn') : t('mobile.passwordOff')}
            </p>
          </li>
          <li>
            {t('mobile.step2')}
            <code dir="ltr" className="ms-1 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-xs">
              pnpm share
            </code>
            {link ? (
              <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="public-link">
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  className="break-all font-mono text-accent underline"
                >
                  {link}
                </a>
                <Button variant="ghost" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
                  {copied ? t('engines.ollama.copied') : t('mobile.copyLink')}
                </Button>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">{t('mobile.noLink')}</p>
            )}
          </li>
          <li>{t('mobile.step3')}</li>
        </ol>
        <p className="mt-3 flex gap-1.5 text-xs leading-6 text-muted">
          <Icon name="info" size={14} className="mt-1" />
          {t('mobile.readerRights')}
        </p>
      </article>
    </section>
  );
}
