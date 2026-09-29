import { API_PREFIX, type BookBundle } from '@dozabaneh/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, ProgressBar } from '../../components/ui';
import { progressRatio, targetLangOf, useBookIndex, useBooks } from '../../data/books';
import { fmtPct } from '../../lib/format';
import { useLibrary } from '../../stores/library';

const API_URL = import.meta.env.VITE_API_URL ?? '';

function useApiHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}${API_PREFIX}/health`);
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { status: string; version: string };
    },
    retry: false,
    staleTime: 30_000,
  });
}

/** Library «کتابخانه» (SPEC §13.1). */
export function LibraryPage() {
  const { t } = useTranslation();
  const { data: books = [] } = useBooks();
  const health = useApiHealth();

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
          <Link
            to="/books/new"
            className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            <Icon name="plus" size={16} />
            {t('library.addBook')}
          </Link>
        </div>
        <p className="mb-6 rounded-xl border border-border bg-panel px-4 py-3 text-sm text-muted">
          {t('app.mockNotice')}
        </p>
        {books.length === 0 ? (
          <p className="text-muted">{t('library.empty')}</p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((b) => (
              <li key={b.book.id}>
                <BookCard bundle={b} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function BookCard({ bundle }: { bundle: BookBundle }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const index = useBookIndex(bundle);
  const progress = useLibrary((s) => s.progress[bundle.book.id]);
  if (!index) return null;
  const { book } = bundle;
  const tgt = targetLangOf(index);
  const { ratio } = progressRatio(index);
  const readRatio = (progress?.readNodeIds.length ?? 0) / Math.max(1, index.readingOrder.length);
  const resume = progress?.nodeId
    ? `/books/${book.id}/read/${progress.nodeId}${progress.segmentId ? `?seg=${progress.segmentId}` : ''}`
    : `/books/${book.id}/read`;

  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface"
      data-testid="book-card"
    >
      <div className="relative flex aspect-[16/9] flex-col justify-end bg-gradient-to-br from-accent to-accent-hover p-5 text-on-accent">
        <span className="absolute top-3 start-3 rounded-full bg-black/20 px-2 py-0.5 text-[11px]">
          {t('library.sample')}
        </span>
        <p className="text-xl font-bold leading-9">
          <LangText lang={tgt}>{book.titles[tgt] ?? ''}</LangText>
        </p>
        <p className="text-sm opacity-90">
          <LangText lang={book.sourceLang}>{book.titles[book.sourceLang] ?? ''}</LangText>
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <p className="text-xs text-muted">
          <LangText lang={book.sourceLang}>
            {[book.authors.join(' & '), book.publisher, book.year ? String(book.year) : ''].filter(Boolean).join(' · ')}
          </LangText>
        </p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">
            {ratio >= 1 ? t('library.status.ready') : t('library.status.translating', { percent: fmtPct(ratio) })}
          </span>
          <span className="rounded-full bg-panel px-2 py-0.5 text-muted">
            {t('library.readProgress', { percent: fmtPct(readRatio) })}
          </span>
        </div>
        <ProgressBar value={readRatio} label={t('library.readProgress', { percent: fmtPct(readRatio) })} />
        <div className="mt-auto flex gap-2 pt-2">
          <Button variant="primary" className="flex-1" onClick={() => navigate(resume)} data-testid="continue-reading">
            {progress?.nodeId ? t('library.continueReading') : t('library.startReading')}
          </Button>
        </div>
      </div>
    </article>
  );
}
