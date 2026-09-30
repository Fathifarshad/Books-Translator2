import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog, DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, IconButton, ProgressBar } from '../../components/ui';
import { booksKey, useBooks } from '../../data/books';
import { api, type BookSummary, offlineExportUrl } from '../../lib/api';
import { fmtNum, fmtPct } from '../../lib/format';
import { useLibrary } from '../../stores/library';
import { useIsOwner } from '../auth/access';
import { useAssistantEngine } from '../settings/engines';

/** Library «کتابخانه» (SPEC §13.1), backed by the API. */
export function LibraryPage() {
  const { t } = useTranslation();
  const books = useBooks();
  const isOwner = useIsOwner();
  const assistant = useAssistantEngine();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false, staleTime: 30_000 });

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-panel">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-accent text-on-accent">
            <Icon name="book" />
          </span>
          <div>
            <p className="text-lg font-bold">{t('app.name')}</p>
            <p className="text-xs text-muted">{t('library.subtitle')}</p>
          </div>
          <div className="ms-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex" data-testid="api-status">
              <span className={`size-2 rounded-full ${health.isSuccess ? 'bg-success' : 'bg-border'}`} />
              {t('app.apiStatus', { status: health.isSuccess ? t('app.serverOnline') : t('app.serverOffline') })}
            </span>
            <Link
              to="/settings"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-row-hover hover:text-text"
            >
              <Icon name="settings" size={16} />
              {t('app.settings')}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{t('library.title')}</h1>
          {isOwner ? (
            <Link
              to="/books/new"
              className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
              data-testid="add-book"
            >
              <Icon name="plus" size={16} />
              {t('library.addBook')}
            </Link>
          ) : (
            <span
              className="ms-auto rounded-full bg-accent-soft px-3 py-1 text-xs text-accent"
              data-testid="reader-badge"
            >
              {t('access.readerBadge')}
            </span>
          )}
        </div>
        {isOwner && assistant === 'mock' ? (
          <p className="mb-6 rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
            {t('app.mockNotice')}{' '}
            <Link to="/settings?tab=engines" className="text-accent underline underline-offset-4">
              {t('setup.connectEngines')}
            </Link>
          </p>
        ) : null}
        {books.isError ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {t('app.serverDown')}
          </p>
        ) : books.isLoading ? (
          <p className="text-muted">{t('app.loading')}</p>
        ) : (books.data ?? []).length === 0 ? (
          <p className="text-muted">{t('library.empty')}</p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {(books.data ?? []).map((b) => (
              <li key={b.book.id}>
                <BookCard summary={b} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

const PROCESSING = new Set(['uploaded', 'ingesting']);

function BookCard({ summary }: { summary: BookSummary }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const progress = useLibrary((s) => s.progress[summary.book.id]);
  const { book, counter } = summary;
  const tgt = book.targetLangs[0] ?? book.sourceLang;
  const ratio = counter.total ? counter.done / counter.total : 0;
  const readRatio = (progress?.readNodeIds.length ?? 0) / Math.max(1, summary.readable);
  const resume = progress?.nodeId
    ? `/books/${book.id}/read/${progress.nodeId}${progress.segmentId ? `?seg=${progress.segmentId}` : ''}`
    : `/books/${book.id}/read`;
  const processing = PROCESSING.has(book.status);
  const reviewing = book.status === 'structure_review';

  const status =
    book.status === 'failed'
      ? t('library.status.failed')
      : processing
        ? book.status === 'uploaded'
          ? t('library.status.uploaded')
          : t('library.status.ingesting')
        : reviewing
          ? t('library.status.structureReview')
          : ratio >= 1
            ? t('library.status.ready')
            : ratio === 0 && book.status === 'ready_to_translate'
              ? t('library.status.readyToTranslate')
              : t('library.status.translating', { percent: fmtPct(ratio) });

  const sourceTitle = book.titles[book.sourceLang] ?? '';
  const targetTitle = book.titles[tgt];

  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface"
      data-testid="book-card"
      data-book-id={book.id}
    >
      <div className="relative flex aspect-[16/9] flex-col justify-end bg-gradient-to-br from-accent to-accent-hover p-5 text-on-accent">
        <div className="absolute top-3 start-3 end-3 flex items-center">
          {book.id === 'bk_sample' ? (
            <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px]">{t('library.sample')}</span>
          ) : null}
          <BookMenu summary={summary} />
        </div>
        {targetTitle ? (
          <p className="text-xl font-bold leading-9">
            <LangText lang={tgt}>{targetTitle}</LangText>
          </p>
        ) : null}
        <p className={targetTitle ? 'text-sm opacity-90' : 'line-clamp-3 text-xl font-bold leading-8'}>
          <LangText lang={book.sourceLang}>{sourceTitle}</LangText>
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        {book.authors.length || book.publisher ? (
          <p className="text-xs text-muted">
            <LangText lang={book.sourceLang}>
              {[book.authors.join(' & '), book.publisher, book.year ? String(book.year) : '']
                .filter(Boolean)
                .join(' · ')}
            </LangText>
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 ${book.status === 'failed' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'}`}
            data-testid="book-status"
          >
            {status}
          </span>
          {summary.agentPending ? (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning" data-testid="book-agent">
              {t('library.status.awaitingAgent', { count: fmtNum(summary.agentPending) })}
            </span>
          ) : null}
          {!processing && book.status !== 'failed' ? (
            <span className="rounded-full bg-panel px-2 py-0.5 text-muted">
              {t('library.readProgress', { percent: fmtPct(readRatio) })}
            </span>
          ) : null}
        </div>
        {!processing && book.status !== 'failed' ? (
          <ProgressBar value={readRatio} label={t('library.readProgress', { percent: fmtPct(readRatio) })} />
        ) : null}
        <div className="mt-auto flex gap-2 pt-2">
          {processing || reviewing || book.status === 'failed' ? (
            <Button
              variant={reviewing ? 'secondary' : 'primary'}
              className="flex-1"
              onClick={() => navigate(`/books/${book.id}/setup`)}
            >
              {processing ? t('library.process') : t('library.review')}
            </Button>
          ) : null}
          {book.status === 'translating' || (book.status === 'ready' && book.id !== 'bk_sample') ? (
            <Button
              className="flex-1"
              onClick={() => navigate(`/books/${book.id}/pipeline`)}
              data-testid="open-pipeline"
            >
              {t('library.pipeline')}
            </Button>
          ) : null}
          {!processing && book.status !== 'failed' ? (
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => navigate(resume)}
              data-testid="continue-reading"
            >
              {progress?.nodeId ? t('library.continueReading') : t('library.startReading')}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function BookMenu({ summary }: { summary: BookSummary }) {
  const { t } = useTranslation();
  const owner = useIsOwner();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.deleteBook(summary.book.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: booksKey }),
  });
  const item =
    'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-text outline-none data-[highlighted]:bg-row-hover';
  return (
    <>
      <DropdownMenu.Root dir="rtl">
        <DropdownMenu.Trigger asChild>
          <IconButton
            icon="more"
            label={t('app.more')}
            className="ms-auto text-on-accent hover:bg-black/20 hover:text-on-accent"
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 w-52 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-popover)]"
          >
            <DropdownMenu.Item className={item} asChild>
              <a href={offlineExportUrl(summary.book.id)} download data-testid="export-offline">
                <Icon name="download" size={16} />
                {t('library.exportOffline')}
              </a>
            </DropdownMenu.Item>
            {owner ? (
              <>
                <DropdownMenu.Item className={item} onSelect={() => navigate(`/books/${summary.book.id}/setup`)}>
                  <Icon name="sidebar" size={16} />
                  {t('library.review')}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={`${item} text-danger data-[highlighted]:bg-danger-soft`}
                  onSelect={() => setConfirm(true)}
                >
                  <Icon name="trash" size={16} />
                  {t('library.deleteBook')}
                </DropdownMenu.Item>
              </>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <AlertDialog.Content className="fixed inset-x-3 top-[20dvh] z-50 mx-auto max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-popover)]">
            <AlertDialog.Title className="text-lg font-bold">{t('library.deleteBook')}</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted">
              {t('library.deleteConfirm')}
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button>{t('app.cancel')}</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button variant="primary" className="bg-danger hover:bg-danger" onClick={() => remove.mutate()}>
                  {t('app.delete')}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
