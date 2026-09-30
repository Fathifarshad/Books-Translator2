import type { PipelineProviderStatus, PipelineStatus } from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, ProgressBar } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtNum, fmtPct } from '../../lib/format';
import { ProblemLine, UsageLine } from '../settings/EnginesSection';
import { AgentHint } from './AgentHint';
import { pipelineKey, targetOf, useBookLiveUpdates, usePipeline } from './live';

const STEPPER = ['brief', 'glossary', 'glossary_review', 'translate', 'edit', 'qa', 'done'] as const;

/** Pipeline dashboard «پردازش» (SPEC §13.3): stages, per-chapter progress, agent batches, errors and live log. */
export function PipelinePage() {
  const { t } = useTranslation();
  const { bookId = '' } = useParams();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['book', bookId], queryFn: () => api.book(bookId), enabled: Boolean(bookId) });
  const book = detail.data?.book;
  const lang = book ? targetOf(book) : undefined;
  const pipeline = usePipeline(bookId, lang);
  useBookLiveUpdates(bookId);
  useDoneNotification(pipeline.data, book?.titles[book.sourceLang] ?? '');

  const action = useMutation({
    mutationFn: (a: 'pause' | 'resume' | 'cancel') => api.pipelineAction(bookId, a, lang as string),
    onSuccess: (data) => queryClient.setQueryData(pipelineKey(bookId, lang as string), data),
  });
  const retry = useMutation({
    mutationFn: (jobId: string) => api.retryJob(bookId, jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pipeline', bookId] }),
  });

  if (detail.isError || pipeline.isError) {
    return (
      <main id="main" className="mx-auto max-w-2xl px-5 py-10">
        <p role="alert">{t('app.serverDown')}</p>
      </main>
    );
  }
  const p = pipeline.data;
  const running = p?.state === 'running' || p?.state === 'waiting_glossary_review';

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-5xl px-5 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <Icon name="back" size={16} />
        {t('reader.backToLibrary')}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-muted">{t('pipeline.title')}</p>
          <h1 className="text-2xl font-bold" data-testid="pipeline-title">
            {book ? <LangText lang={book.sourceLang}>{book.titles[book.sourceLang] ?? ''}</LangText> : t('app.loading')}
          </h1>
        </div>
        {p ? (
          <span className="rounded-full bg-accent-soft px-3 py-1 text-sm text-accent" data-testid="pipeline-state">
            {t(`pipeline.states.${p.state}`)}
          </span>
        ) : null}
        <div className="ms-auto flex flex-wrap gap-2">
          {p?.state === 'paused' ? (
            <Button
              variant="primary"
              icon="forward"
              onClick={() => action.mutate('resume')}
              disabled={action.isPending}
            >
              {t('pipeline.resume')}
            </Button>
          ) : running ? (
            <Button icon="stop" onClick={() => action.mutate('pause')} disabled={action.isPending}>
              {t('pipeline.pause')}
            </Button>
          ) : null}
          {running || p?.state === 'paused' ? <CancelButton onConfirm={() => action.mutate('cancel')} /> : null}
          {p?.state === 'idle' || p?.state === 'cancelled' ? (
            <Link
              to={`/books/${bookId}/setup`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
            >
              {t('pipeline.setup')}
            </Link>
          ) : null}
        </div>
      </div>

      {!p ? (
        <p className="mt-8 text-muted">{t('app.loading')}</p>
      ) : (
        <>
          <nav className="mt-5 flex flex-wrap gap-2 text-sm">
            <Link
              to={`/books/${bookId}/read`}
              className="rounded-lg border border-border px-3 py-1.5 hover:border-accent/60 hover:text-accent"
            >
              {t('pipeline.openReader')}
            </Link>
            <Link
              to={`/books/${bookId}/glossary`}
              className="rounded-lg border border-border px-3 py-1.5 hover:border-accent/60 hover:text-accent"
            >
              {t('pipeline.openGlossary')}
            </Link>
            <Link
              to={`/books/${bookId}/review`}
              className="rounded-lg border border-border px-3 py-1.5 hover:border-accent/60 hover:text-accent"
              data-testid="open-review"
            >
              {t('pipeline.openReview')}
              {p.flagged ? (
                <span className="ms-1.5 rounded-full bg-warning/15 px-1.5 text-xs text-warning">
                  {fmtNum(p.flagged)}
                </span>
              ) : null}
            </Link>
          </nav>

          <Stepper status={p} />

          {p.agent.pending > 0 && p.state !== 'paused' ? <AgentHint count={p.agent.pending} className="mt-5" /> : null}
          {p.providers.length ? <ProvidersPanel providers={p.providers} /> : null}

          <section className="mt-5 rounded-2xl border border-border bg-surface p-5" data-testid="pipeline-counter">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <p className="text-3xl font-bold">{fmtPct(p.counter.total ? p.counter.done / p.counter.total : 0)}</p>
              <p className="text-sm text-muted">
                {t('pipeline.counter', { done: fmtNum(p.counter.done), total: fmtNum(p.counter.total) })}
              </p>
              {p.flagged ? (
                <Link to={`/books/${bookId}/review`} className="ms-auto text-sm text-warning underline">
                  {t('pipeline.flagged', { count: fmtNum(p.flagged) })}
                </Link>
              ) : null}
            </div>
            <ProgressBar value={p.counter.total ? p.counter.done / p.counter.total : 0} label={t('pipeline.title')} />
            <p className="mt-3 text-xs text-muted">
              {t('pipeline.engineLine', {
                engine: t(`setup.engines.${p.settings.engines.translate}`),
                profile: t(`setup.profiles.${p.settings.profile}`),
              })}
            </p>
          </section>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <section className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="mb-3 font-bold">{t('pipeline.chapters')}</h2>
              <ul className="space-y-3">
                {p.chapters.map((c) => (
                  <li key={c.nodeId}>
                    <div className="mb-1 flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {c.title.tgt ? (
                          <LangText lang={p.lang}>{c.title.tgt}</LangText>
                        ) : (
                          <LangText lang={book?.sourceLang ?? 'en'}>{c.title.src}</LangText>
                        )}
                      </span>
                      <span className="text-xs text-muted">
                        {t('pipeline.stageProgress', { done: fmtNum(c.done), total: fmtNum(c.total) })}
                      </span>
                      {c.flagged ? <span className="text-xs text-warning">⚑ {fmtNum(c.flagged)}</span> : null}
                    </div>
                    <ProgressBar value={c.total ? c.done / c.total : 0} label={c.title.tgt ?? c.title.src} />
                  </li>
                ))}
              </ul>
            </section>

            <div className="space-y-5">
              {usesAgent(p) ? (
                <section className="rounded-2xl border border-border bg-surface p-5" data-testid="agent-batches">
                  <h2 className="mb-3 font-bold">{t('pipeline.batches')}</h2>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(['pending', 'leased', 'imported', 'rejected'] as const).map((k) => (
                      <div key={k} className="rounded-xl bg-panel px-3 py-2">
                        <dt className="text-xs text-muted">{t(`pipeline.batchCounts.${k}`)}</dt>
                        <dd className="text-lg font-bold">{fmtNum(p.agent[k])}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              <section className="rounded-2xl border border-border bg-surface p-5">
                <h2 className="mb-3 font-bold">{t('pipeline.errors')}</h2>
                {p.errors.length === 0 ? (
                  <p className="text-sm text-muted">{t('pipeline.noErrors')}</p>
                ) : (
                  <ul className="space-y-2">
                    {p.errors.map((e) => (
                      <li
                        key={e.jobId}
                        className="flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm"
                      >
                        <span className="font-medium">{t(`pipeline.stages.${e.stage}`)}</span>
                        <span dir="auto" className="min-w-0 flex-1 truncate text-danger">
                          {e.error}
                        </span>
                        <Button
                          className="px-2 py-1 text-xs"
                          onClick={() => retry.mutate(e.jobId)}
                          disabled={retry.isPending}
                        >
                          {t('pipeline.retry')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>

          <details className="mt-5 rounded-2xl border border-border bg-surface p-5" data-testid="pipeline-log">
            <summary className="cursor-pointer font-bold">{t('pipeline.log')}</summary>
            <ol className="mt-3 max-h-72 space-y-1 overflow-y-auto font-mono text-xs" dir="ltr">
              {[...p.log].reverse().map((entry) => (
                <li
                  key={`${entry.at}-${entry.message}`}
                  className={
                    entry.level === 'error' ? 'text-danger' : entry.level === 'warn' ? 'text-warning' : 'text-muted'
                  }
                >
                  {entry.at.slice(11, 19)} {entry.message}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </main>
  );
}

function Stepper({ status }: { status: PipelineStatus }) {
  const { t } = useTranslation();
  const current = STEPPER.indexOf(status.stage);
  const counts: Partial<Record<(typeof STEPPER)[number], { done: number; total: number }>> = {
    brief: status.stages.brief,
    glossary: status.stages.glossary,
    translate: status.stages.translate,
    edit: status.stages.edit,
    qa: status.stages.qa,
  };
  return (
    <ol className="mt-5 flex flex-wrap gap-2 text-xs" aria-label={t('pipeline.title')} data-testid="pipeline-stepper">
      {STEPPER.map((s, i) => {
        if (s === 'edit' && status.settings.profile === 'economy') return null;
        const c = counts[s];
        return (
          <li
            key={s}
            aria-current={i === current ? 'step' : undefined}
            className={`rounded-full border px-3 py-1 ${
              i < current || status.stage === 'done'
                ? 'border-success/40 text-success'
                : i === current
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-muted'
            }`}
          >
            {t(`pipeline.stages.${s}`)}
            {c && c.total > 0
              ? ` · ${t('pipeline.stageProgress', { done: fmtNum(c.done), total: fmtNum(c.total) })}`
              : ''}
          </li>
        );
      })}
    </ol>
  );
}

function CancelButton({ onConfirm }: { onConfirm: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger asChild>
        <Button icon="close">{t('pipeline.cancel')}</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <AlertDialog.Content className="fixed inset-x-3 top-[20dvh] z-50 mx-auto max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-popover)]">
          <AlertDialog.Title className="text-lg font-bold">{t('pipeline.cancel')}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted">
            {t('pipeline.cancelConfirm')}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button>{t('app.cancel')}</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="primary" className="bg-danger hover:bg-danger" onClick={onConfirm}>
                {t('pipeline.cancel')}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Browser notification when a book finishes (only if the user already granted permission). */
function useDoneNotification(status: PipelineStatus | undefined, title: string): void {
  const { t } = useTranslation();
  const previous = useRef(status?.state);
  useEffect(() => {
    const was = previous.current;
    previous.current = status?.state;
    if (!status || was === undefined || was === 'done' || status.state !== 'done') return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(t('pipeline.doneNotification', { title }));
    }
  }, [status, title, t]);
}

/** The Claude Code batch counters matter only when a task runs on the agent (or batches exist). */
function usesAgent(p: PipelineStatus): boolean {
  return Object.values(p.settings.engines).includes('agent') || Object.values(p.agent).some((n) => n > 0);
}

/** Free providers used by this book: model, today's quota use, waits and problems (with a way to fix them). */
function ProvidersPanel({ providers }: { providers: PipelineProviderStatus[] }) {
  const { t } = useTranslation();
  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-5" data-testid="pipeline-providers">
      <h2 className="font-bold">{t('pipeline.providers.title')}</h2>
      <ul className="mt-2 flex flex-col gap-3">
        {providers.map((p) => (
          <li key={p.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <bdi className="font-medium">{t(`engines.names.${p.id}`)}</bdi>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${p.ready ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}
              >
                {t(p.ready ? 'engines.status.ready' : 'engines.status.problem')}
              </span>
              {!p.ready || p.problem ? (
                <Link to="/settings?tab=engines" className="ms-auto text-accent underline underline-offset-4">
                  {t('pipeline.providers.fix')}
                </Link>
              ) : null}
            </div>
            <UsageLine view={p} />
            {p.problem ? <ProblemLine problem={p.problem} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
