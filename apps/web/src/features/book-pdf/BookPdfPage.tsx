import {
  BOOK_FONTS,
  BOOK_PAGE_SIZES,
  type BookPdfOptions,
  BookPdfOptionsSchema,
  type BookPdfStatus,
  COVER_SOURCES,
  COVER_THEMES,
} from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { uiLocale } from '../../i18n';
import { ApiError, api, bookPdfFileUrl, coverImageUrl, coverPreviewUrl, exportUrl } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { targetOf, useBookLiveUpdates } from '../pipeline/live';

const statusKey = (bookId: string) => ['book-pdf', bookId] as const;
const field = 'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent/60';
const SWATCH: Record<(typeof COVER_THEMES)[number], string> = {
  navy: 'linear-gradient(135deg,#16264a,#0b1530)',
  emerald: 'linear-gradient(135deg,#0d4a45,#062b28)',
  burgundy: 'linear-gradient(135deg,#5a1628,#310a15)',
  ivory: 'linear-gradient(135deg,#f3ecdc,#e2d6bb)',
};

/**
 * Why the server could not answer. A plain «NOT_FOUND» is the router's own answer for an unknown address: the page is
 * newer than the server still running (the app was updated while open), which only a restart fixes.
 */
function failureKey(err: unknown): string {
  if (err instanceof ApiError && err.status === 404 && err.code === 'NOT_FOUND')
    return 'bookPdf.errors.SERVER_OUTDATED';
  if (err instanceof ApiError) return `bookPdf.errors.${err.code}`;
  return 'bookPdf.errors.NETWORK';
}

/** Delays a value so the cover preview is not reloaded on every keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * «کتاب PDF» (ADR-046): the translation — or the edited text — typeset as a real book on this computer: a cover
 * (made here or the owner's own image), title page, imprint, a table of contents with page numbers, figures and tables
 * with their labels in the target language, and the glossary. The build runs on the server as a job; this page sets
 * its options, follows it and hands over the file.
 */
export function BookPdfPage() {
  const { t } = useTranslation();
  const { bookId = '' } = useParams();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['book', bookId], queryFn: () => api.book(bookId), enabled: Boolean(bookId) });
  const book = detail.data?.book;
  const lang = book ? targetOf(book) : '';
  useBookLiveUpdates(bookId);

  const status = useQuery({
    queryKey: statusKey(bookId),
    queryFn: () => api.bookPdf(bookId, lang || undefined),
    enabled: Boolean(bookId && lang),
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 1500 : false),
  });
  const data = status.data;

  // The form starts from the last build's options (or the defaults with the preparer last used).
  const [options, setOptions] = useState<BookPdfOptions | null>(null);
  useEffect(() => {
    if (data && !options) setOptions(data.options);
  }, [data, options]);
  const o = options ?? BookPdfOptionsSchema.parse({});
  const set = <K extends keyof BookPdfOptions>(k: K, v: BookPdfOptions[K]) => setOptions({ ...o, [k]: v });
  const setPreparer = (k: keyof BookPdfOptions['preparer'], v: string) =>
    setOptions({ ...o, preparer: { ...o.preparer, [k]: v } });

  const put = (next: BookPdfStatus) => queryClient.setQueryData(statusKey(bookId), next);
  const start = useMutation({
    mutationFn: () => api.startBookPdf(bookId, { ...o, ...(lang ? { lang } : {}) }),
    onSuccess: put,
  });
  const [coverVersion, setCoverVersion] = useState(0);
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadCover(bookId, file),
    onSuccess: (next) => {
      put(next);
      setCoverVersion((v) => v + 1);
    },
  });
  const removeCover = useMutation({
    mutationFn: () => api.removeCover(bookId),
    onSuccess: (next) => {
      put(next);
      setCoverVersion((v) => v + 1);
    },
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  };

  const preview = useDebounced(
    coverPreviewUrl(bookId, {
      theme: o.theme,
      cover: o.cover,
      coverText: o.coverText,
      role: o.preparer.role || t('bookPdf.defaultRole'),
      name: o.preparer.name,
      title: o.preparer.title,
      v: coverVersion,
    }),
    500,
  );

  const running = data?.state === 'running';
  const percent = Math.round((data?.fraction ?? 0) * 100);
  const stepText =
    data?.step && running
      ? t(`bookPdf.steps.${data.step}`, { done: fmtNum(data.done), total: fmtNum(data.total) })
      : t('bookPdf.queued');
  const errorText = data?.error
    ? data.error === 'BUILD_FAILED'
      ? t('bookPdf.errors.BUILD_FAILED', { message: data.message ?? '' })
      : t(`bookPdf.errors.${data.error}`, { defaultValue: t('bookPdf.errors.generic') })
    : '';
  const sizeMb = data?.file ? fmtNum(Math.round((data.file.bytes / 1024 / 1024) * 10) / 10) : '';
  // Without the status there are no options to build from, so the button stays off — say why instead of nothing.
  const failure = status.isError ? status.error : start.isError ? start.error : null;
  const failureText = failure ? t(failureKey(failure), { defaultValue: t('bookPdf.errors.generic') }) : '';
  const outdated = status.isError && failureKey(status.error) === 'bookPdf.errors.SERVER_OUTDATED';

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-5xl px-5 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <Icon name="back" size={16} />
        {t('reader.backToLibrary')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t('bookPdf.title')}</h1>
      {book ? (
        <p className="mt-1 text-sm text-muted">
          <LangText lang={lang || book.sourceLang}>{book.titles[lang] ?? book.titles[book.sourceLang] ?? ''}</LangText>
        </p>
      ) : null}
      <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">{t('bookPdf.intro')}</p>

      {failureText ? (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
          data-testid="book-pdf-unavailable"
        >
          {failureText}
        </p>
      ) : null}

      {data && !data.browser ? (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {t('bookPdf.errors.BROWSER_NOT_FOUND')}{' '}
          <a href={exportUrl(bookId, 'print')} target="_blank" rel="noopener noreferrer" className="underline">
            {t('bookPdf.fallbackPrint')}
          </a>
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_17rem]">
        <fieldset className="flex min-w-0 flex-col gap-6" disabled={running}>
          {/* Cover */}
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-base font-bold">{t('bookPdf.coverTitle')}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {COVER_SOURCES.map((id) => (
                <Button
                  key={id}
                  variant="pill"
                  aria-pressed={o.cover === id}
                  onClick={() => set('cover', id)}
                  data-testid={`cover-${id}`}
                >
                  {t(`bookPdf.covers.${id}`)}
                </Button>
              ))}
            </div>

            {o.cover === 'designed' ? (
              <div className="mt-4 flex flex-col items-start gap-3">
                <p className="text-sm leading-7 text-muted">{t('bookPdf.studioHint')}</p>
                <Link
                  to={`/books/${bookId}/cover-studio`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent hover:opacity-90"
                  data-testid="open-cover-studio"
                >
                  <Icon name="palette" size={16} />
                  {t('bookPdf.openStudio')}
                </Link>
              </div>
            ) : null}

            {o.cover === 'generated' ? (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">{t('bookPdf.themesLabel')}</p>
                <div className="flex flex-wrap gap-3">
                  {COVER_THEMES.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => set('theme', id)}
                      aria-pressed={o.theme === id}
                      className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${
                        o.theme === id ? 'border-accent ring-2 ring-accent/30' : 'border-border'
                      }`}
                      data-testid={`theme-${id}`}
                    >
                      <span
                        className="inline-block size-6 rounded-md border border-black/10"
                        style={{ background: SWATCH[id] }}
                      />
                      {t(`bookPdf.themes.${id}`)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {o.cover === 'uploaded' ? (
              <div className="mt-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={onFile}
                    data-testid="cover-file"
                  />
                  <Button icon="upload" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                    {upload.isPending
                      ? t('bookPdf.uploading')
                      : data?.coverUploaded
                        ? t('bookPdf.replace')
                        : t('bookPdf.upload')}
                  </Button>
                  {data?.coverUploaded ? (
                    <Button variant="ghost" icon="trash" onClick={() => removeCover.mutate()}>
                      {t('bookPdf.remove')}
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs leading-6 text-muted">{t('bookPdf.uploadHint')}</p>
                {upload.isError ? (
                  <p role="alert" className="text-sm text-danger">
                    {t('bookPdf.uploadFailed')}
                  </p>
                ) : null}
                {data?.coverUploaded ? (
                  <img
                    src={coverImageUrl(bookId, coverVersion)}
                    alt=""
                    className="h-28 w-auto self-start rounded border border-border object-contain"
                  />
                ) : (
                  <p className="text-sm text-muted">{t('bookPdf.noCoverImage')}</p>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={o.coverText} onChange={(e) => set('coverText', e.target.checked)} />
                  {t('bookPdf.coverText')}
                </label>
              </div>
            ) : null}

            {o.cover !== 'none' ? (
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={o.backCover} onChange={(e) => set('backCover', e.target.checked)} />
                {t('bookPdf.backCover')}
              </label>
            ) : null}
          </section>

          {/* Preparer */}
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-base font-bold">{t('bookPdf.preparerTitle')}</h2>
            <p className="mt-1 text-xs leading-6 text-muted">{t('bookPdf.preparerHint')}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('bookPdf.preparerRole')}</span>
                <input
                  className={field}
                  value={o.preparer.role}
                  placeholder={t('bookPdf.defaultRole')}
                  onChange={(e) => setPreparer('role', e.target.value)}
                  data-testid="preparer-role"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('bookPdf.preparerName')}</span>
                <input
                  className={field}
                  value={o.preparer.name}
                  onChange={(e) => setPreparer('name', e.target.value)}
                  data-testid="preparer-name"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium">{t('bookPdf.preparerAbout')}</span>
                <input
                  className={field}
                  value={o.preparer.title}
                  onChange={(e) => setPreparer('title', e.target.value)}
                  data-testid="preparer-title"
                />
              </label>
            </div>
          </section>

          {/* Page, type and content */}
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-base font-bold">{t('bookPdf.layoutTitle')}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('bookPdf.pageSize')}</span>
                <select
                  className={field}
                  value={o.pageSize}
                  onChange={(e) => set('pageSize', e.target.value as BookPdfOptions['pageSize'])}
                  data-testid="page-size"
                >
                  {BOOK_PAGE_SIZES.map((id) => (
                    <option key={id} value={id}>
                      {t(`bookPdf.sizes.${id}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('bookPdf.font')}</span>
                <select
                  className={field}
                  value={o.font}
                  onChange={(e) => set('font', e.target.value as BookPdfOptions['font'])}
                  data-testid="book-font"
                >
                  {BOOK_FONTS.map((id) => (
                    <option key={id} value={id}>
                      {t(`bookPdf.fonts.${id}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-2.5 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1.5"
                  checked={o.figures}
                  disabled={data ? !data.sourcePdf : false}
                  onChange={(e) => set('figures', e.target.checked)}
                  data-testid="book-figures"
                />
                <span className="leading-7">
                  {data?.editOnly ? t('bookPdf.figuresEditOnly') : t('bookPdf.figures')}
                </span>
              </label>
              {data && !data.sourcePdf ? <p className="text-xs text-muted">{t('bookPdf.noSource')}</p> : null}
              {data && !data.editOnly ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={o.mode === 'bilingual'}
                    onChange={(e) => set('mode', e.target.checked ? 'bilingual' : 'target')}
                    data-testid="book-bilingual"
                  />
                  {t('bookPdf.bilingual')}
                </label>
              ) : null}
            </div>
          </section>
        </fieldset>

        {/* Preview and build */}
        <aside className="flex flex-col gap-4 md:sticky md:top-6 md:self-start">
          {o.cover !== 'none' && !outdated ? (
            <figure className="m-0">
              <iframe
                title={t('bookPdf.preview')}
                src={preview}
                className="aspect-[210/297] w-full rounded-lg border border-border bg-white shadow-sm"
                data-testid="cover-preview"
              />
              <figcaption className="mt-1 text-center text-xs text-muted">{t('bookPdf.preview')}</figcaption>
            </figure>
          ) : null}
          <Button
            variant="primary"
            icon="book"
            onClick={() => start.mutate()}
            disabled={running || start.isPending || !options || data?.browser === false}
            data-testid="book-pdf-build"
          >
            {data?.file ? t('bookPdf.rebuild') : t('bookPdf.build')}
          </Button>
        </aside>
      </div>

      {running ? (
        <div className="mt-6 rounded-xl border border-border bg-surface p-4" data-testid="book-pdf-progress">
          <div className="flex flex-wrap items-center gap-3">
            <span role="status" className="text-sm">
              {stepText}
            </span>
            <span className="ms-auto text-sm text-muted">{t('audio.percent', { percent: fmtNum(percent) })}</span>
          </div>
          <progress
            max={100}
            value={percent}
            className="mt-3 h-2 w-full overflow-hidden rounded-full accent-[var(--color-accent)]"
            aria-label={t('bookPdf.progress')}
          />
        </div>
      ) : null}

      {data?.state === 'failed' && errorText ? (
        <p role="alert" className="mt-6 text-sm text-danger" data-testid="book-pdf-error">
          {errorText}
        </p>
      ) : null}

      {data?.file && !running ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-4" data-testid="book-pdf-ready">
          <p className="text-sm">
            {t('bookPdf.ready', {
              pages: fmtNum(data.file.pages),
              size: t('bookPdf.megabytes', { size: sizeMb }),
            })}
          </p>
          {data.file.figures ? (
            <p className="mt-1 text-sm text-muted">
              {t('bookPdf.figuresReady', {
                figures: fmtNum(data.file.figures),
                translated: fmtNum(data.file.translatedFigures),
              })}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            {t('bookPdf.builtAt', {
              date: new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(data.file.builtAt),
              ),
            })}
          </p>
          <a
            href={bookPdfFileUrl(bookId, lang || undefined)}
            download
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
            data-testid="book-pdf-download"
          >
            <Icon name="download" size={16} />
            {t('bookPdf.download')}
          </a>
        </section>
      ) : null}
    </main>
  );
}
