import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { accessKey, useAccess } from './access';

/** Other devices sign in with the access password; this computer passes straight through. */
export function AccessGate({ children }: { children: ReactNode }) {
  const access = useAccess();
  if (access.isLoading) return null;
  if (access.data && access.data.role === null) return <SignIn remoteDisabled={!access.data.passwordSet} />;
  return <>{children}</>;
}

function SignIn({ remoteDisabled }: { remoteDisabled: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) login.mutate();
  };
  const code = login.error instanceof ApiError ? login.error.code : login.error ? 'NETWORK' : null;
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10"
      data-testid="sign-in"
    >
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent text-on-accent">
        <Icon name="book" />
      </span>
      <h1 className="mt-4 text-center text-xl font-bold">{t('app.name')}</h1>
      {remoteDisabled ? (
        <p role="alert" className="mt-6 rounded-xl bg-panel px-4 py-3 text-sm leading-7 text-muted">
          {t('access.remoteDisabled')}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span>{t('access.password')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-base outline-none focus:border-accent/60"
              data-testid="access-password"
            />
          </label>
          <Button type="submit" variant="primary" disabled={!password || login.isPending} data-testid="sign-in-submit">
            {t('access.signIn')}
          </Button>
          {code ? (
            <p role="alert" className="text-sm text-danger">
              {t(
                code === 'BAD_PASSWORD'
                  ? 'access.badPassword'
                  : code === 'TOO_MANY_ATTEMPTS'
                    ? 'access.tooMany'
                    : 'app.serverDown',
              )}
            </p>
          ) : null}
          <p className="text-xs leading-6 text-muted">{t('access.readerHint')}</p>
        </form>
      )}
    </main>
  );
}

/** Fallback (e.g. access cleared on the computer): send the reader back to the sign-in screen. */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => queryClient.resetQueries({ queryKey: accessKey }),
  });
}
