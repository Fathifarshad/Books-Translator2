import { useQueryClient } from '@tanstack/react-query';
import { type DragEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../../components/Icon';
import { Button, ProgressBar } from '../../components/ui';
import { booksKey } from '../../data/books';
import { ApiError, uploadBook } from '../../lib/api';
import { fmtNum, fmtPct } from '../../lib/format';

const STEPS = ['upload', 'extract', 'review', 'settings', 'glossary', 'translate'] as const;
const KNOWN_ERRORS = new Set(['NOT_A_PDF', 'FILE_TOO_LARGE', 'NETWORK']);

/** Add-book wizard, step 1: drag & drop or pick a PDF, upload with progress (SPEC §13.2). */
export function AddBookPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);

  const send = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDuplicateOf(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError(t('upload.onlyPdf'));
      return;
    }
    setProgress(0);
    try {
      const { bookId } = await uploadBook(file, setProgress);
      await queryClient.invalidateQueries({ queryKey: booksKey });
      navigate(`/books/${bookId}/setup`);
    } catch (err) {
      setProgress(null);
      if (err instanceof ApiError && err.code === 'DUPLICATE_BOOK') {
        setDuplicateOf(String(err.details.bookId ?? ''));
        return;
      }
      const code = err instanceof ApiError && KNOWN_ERRORS.has(err.code) ? err.code : 'UNKNOWN';
      setError(t('upload.failed', { reason: t(`upload.errors.${code}`) }));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void send(e.dataTransfer.files[0]);
  };

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-2xl px-5 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <Icon name="back" size={16} />
        {t('reader.backToLibrary')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t('setup.addBookTitle')}</h1>
      <p className="mt-2 text-sm text-muted">{t('library.addBookHint')}</p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`mt-6 flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          over
            ? 'border-accent bg-accent-soft/60 text-accent'
            : 'border-border bg-panel text-muted hover:border-accent/60'
        }`}
        data-testid="dropzone"
      >
        <Icon name="upload" size={32} />
        <span>{over ? t('upload.dropActive') : t('upload.drop')}</span>
        <span className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent">
          {t('upload.choose')}
        </span>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => void send(e.target.files?.[0])}
          disabled={progress !== null}
          data-testid="file-input"
        />
      </label>

      {progress !== null ? (
        <div className="mt-4" role="status">
          <p className="mb-1.5 text-sm">{t('upload.uploading', { percent: fmtPct(progress) })}</p>
          <ProgressBar value={progress} label={t('upload.uploading', { percent: fmtPct(progress) })} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {duplicateOf ? (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-accent-soft/70 px-4 py-3 text-sm"
        >
          <span className="flex-1">{t('upload.duplicate')}</span>
          <Button variant="primary" onClick={() => navigate(`/books/${duplicateOf}/setup`)}>
            {t('upload.openExisting')}
          </Button>
        </div>
      ) : null}
      <p className="mt-4 text-xs text-muted">{t('upload.privacy')}</p>

      <ol className="mt-8 space-y-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <span
              className={`inline-flex size-7 items-center justify-center rounded-full text-xs ${i === 0 ? 'bg-accent text-on-accent' : 'bg-panel text-muted'}`}
            >
              {fmtNum(i + 1)}
            </span>
            {t(`setup.steps.${s}`)}
          </li>
        ))}
      </ol>
    </main>
  );
}
