import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, ProgressBar } from '../../components/ui';
import { booksKey, bundleKey, useBookBundle } from '../../data/books';
import { api, type ExtractionReport, subscribeBookEvents } from '../../lib/api';
import { fmtNum, fmtPct } from '../../lib/format';
import { targetOf, usePipeline } from '../pipeline/live';
import { StructureEditor } from './StructureEditor';
import { TranslationSetup } from './TranslationSetup';

const STEPS = ['upload', 'extract', 'review', 'settings', 'glossary', 'translate'] as const;

/** Add-book wizard steps 2–3: live extraction progress, report, structure review (SPEC §13.2). */
export function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { bookId = '' } = useParams();
  const detail = useQuery({ queryKey: ['book', bookId], queryFn: () => api.book(bookId), enabled: Boolean(bookId) });
  const [progress, setProgress] = useState<{ done: number; total: number; ocrPages?: number } | null>(null);
  const status = detail.data?.book.status;
  const reviewing =
    status === 'structure_review' || status === 'ready_to_translate' || status === 'ready' || status === 'translating';
  const report = useQuery({ queryKey: ['report', bookId], queryFn: () => api.report(bookId), enabled: reviewing });
  const bundle = useBookBundle(reviewing ? bookId : undefined);

  // Live progress over SSE; refetch the book when its status changes.
  useEffect(() => {
    if (!bookId) return;
    return subscribeBookEvents(bookId, (e) => {
      if (e.type === 'progress') setProgress({ done: e.done, total: e.total, ocrPages: e.ocrPages ?? 0 });
      if (e.type === 'book' || e.type === 'job') {
        void queryClient.invalidateQueries({ queryKey: ['book', bookId] });
        void queryClient.invalidateQueries({ queryKey: booksKey });
      }
    });
  }, [bookId, queryClient]);

  const confirmed = status === 'ready_to_translate' || status === 'ready' || status === 'translating';
  const pipeline = usePipeline(bookId, confirmed && detail.data ? targetOf(detail.data.book) : undefined);
  const stage = pipeline.data?.stage;
  const step = !reviewing
    ? 1
    : !confirmed
      ? 2
      : !pipeline.data || pipeline.data.state === 'idle' || pipeline.data.state === 'cancelled'
        ? 3
        : stage === 'brief' || stage === 'glossary' || stage === 'glossary_review'
          ? 4
          : 5;
  const confirm = async () => {
    await api.structure(bookId, { op: 'confirm' });
    await queryClient.invalidateQueries({ queryKey: ['book', bookId] });
    await queryClient.invalidateQueries({ queryKey: booksKey });
    await queryClient.invalidateQueries({ queryKey: bundleKey(bookId) });
  };

  if (detail.isError) {
    return (
      <main id="main" className="mx-auto max-w-2xl px-5 py-10">
        <p role="alert">{t('app.serverDown')}</p>
      </main>
    );
  }

  const book = detail.data?.book;
  const p = progress ?? detail.data?.ingest?.progress ?? null;
  return (
    <main id="main" className="mx-auto min-h-dvh max-w-4xl px-5 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <Icon name="back" size={16} />
        {t('reader.backToLibrary')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold" data-testid="setup-title">
        {book ? <LangText lang={book.sourceLang}>{book.titles[book.sourceLang] ?? ''}</LangText> : t('app.loading')}
      </h1>

      <ol className="mt-4 flex flex-wrap gap-2 text-xs" aria-label={t('setup.structureReview')}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={`rounded-full border px-3 py-1 ${
              i < step
                ? 'border-success/40 text-success'
                : i === step
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-muted'
            }`}
          >
            {fmtNum(i + 1)}. {t(`setup.steps.${s}`)}
          </li>
        ))}
      </ol>

      {status === 'uploaded' || status === 'ingesting' ? (
        <section
          className="mt-8 rounded-2xl border border-border bg-surface p-6"
          role="status"
          data-testid="extract-progress"
        >
          <p className="mb-3">
            {p ? t('setup.extracting', { page: fmtNum(p.done), total: fmtNum(p.total) }) : t('setup.waiting')}
          </p>
          {progress?.ocrPages ? (
            <p className="mb-3 text-sm text-muted" data-testid="ocr-progress">
              {t('setup.ocrProgress', { count: fmtNum(progress.ocrPages) })}
            </p>
          ) : null}
          <ProgressBar value={p ? p.done / Math.max(1, p.total) : 0} label={t('setup.steps.extract')} />
        </section>
      ) : null}

      {status === 'failed' ? (
        <p role="alert" className="mt-8 rounded-xl bg-danger-soft px-4 py-3 text-danger">
          {t('setup.failed', { reason: detail.data?.error ?? '' })}
        </p>
      ) : null}

      {confirmed && book && bundle.data ? <TranslationSetup book={book} bundle={bundle.data} /> : null}

      {reviewing && report.data?.report ? <ReportCard report={report.data.report} /> : null}

      {reviewing && bundle.data ? (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{t('setup.structureReview')}</h2>
            <div className="ms-auto flex gap-2">
              <Button icon="book" onClick={() => navigate(`/books/${bookId}/read`)} data-testid="read-source">
                {t('setup.readSource')}
              </Button>
              {status === 'structure_review' ? (
                <Button variant="primary" icon="check" onClick={() => void confirm()} data-testid="confirm-structure">
                  {t('setup.confirmStructure')}
                </Button>
              ) : null}
            </div>
          </div>
          {confirmed ? (
            <details className="rounded-2xl border border-border bg-surface px-4 py-3">
              <summary className="cursor-pointer text-sm">{t('setup.confirmed')}</summary>
              <p className="my-3 text-sm text-muted">{t('setup.structureHint')}</p>
              <StructureEditor bundle={bundle.data} />
            </details>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted">{t('setup.structureHint')}</p>
              <StructureEditor bundle={bundle.data} />
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}

function ReportCard({ report }: { report: ExtractionReport }) {
  const { t } = useTranslation();
  const s = report.stats;
  const items: [string, number][] = [
    ['pages', s.pages],
    ...(s.ocrPages ? ([['ocrPages', s.ocrPages]] as [string, number][]) : []),
    ['words', s.words],
    ['chapters', s.chapters],
    ['sections', s.sections],
    ['segments', s.segments],
    ['removed', s.removedHeaderFooterLines],
    ['merged', s.mergedContinuations],
    ['dehyphenated', s.dehyphenated],
    ['suspected', s.suspectedBreaks],
  ];
  const scanned = report.warnings.find((w) => w.code === 'pages_without_text');
  const ocrMissing = report.warnings.some((w) => w.code === 'ocr_unavailable');
  // Mostly unreadable: nothing useful to translate until the scan is made readable.
  const unreadable = scanned && (scanned.pages?.length ?? 0) >= s.pages * 0.5;
  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-5" data-testid="report">
      <h2 className="text-lg font-bold">{t('setup.report')}</h2>
      <p className="mt-1 text-sm text-muted">{t(`setup.source.${report.structureSource}`)}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-panel px-3 py-2">
            <dt className="text-xs text-muted">{t(`setup.stats.${k}`)}</dt>
            <dd className="text-lg font-bold">{fmtNum(v)}</dd>
          </div>
        ))}
      </dl>
      {unreadable ? (
        <div
          role="alert"
          className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
          data-testid="unreadable"
        >
          <p className="font-bold">{t('setup.unreadableTitle')}</p>
          <p className="mt-1 leading-7">{t(ocrMissing ? 'setup.unreadableNoOcr' : 'setup.unreadableHint')}</p>
        </div>
      ) : null}
      <ul className="mt-4 space-y-1 text-sm">
        {s.ocrPages ? <li className="text-warning">⚠ {t('setup.ocrWarning', { count: fmtNum(s.ocrPages) })}</li> : null}
        {scanned ? (
          <li className="text-warning">⚠ {t('setup.scannedWarning', { count: fmtNum(scanned.pages?.length ?? 0) })}</li>
        ) : null}
        {s.suspectedBreakRatio > 0.01 ? (
          <li className="text-warning">⚠ {t('setup.suspectedWarning', { percent: fmtPct(s.suspectedBreakRatio) })}</li>
        ) : null}
        {!scanned && !s.ocrPages && s.suspectedBreakRatio <= 0.01 ? (
          <li className="text-success">✓ {t('setup.noWarnings')}</li>
        ) : null}
      </ul>
    </section>
  );
}
