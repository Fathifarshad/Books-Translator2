import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { fmtNum } from '../../lib/format';

const STEPS = ['upload', 'extract', 'review', 'settings', 'glossary', 'translate'] as const;

/** Add-book wizard placeholder: the upload → extraction → structure-review flow arrives in Phase 2. */
export function AddBookPage() {
  const { t } = useTranslation();
  return (
    <main id="main" className="mx-auto min-h-dvh max-w-2xl px-5 py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <Icon name="back" size={16} />
        {t('reader.backToLibrary')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t('setup.addBookTitle')}</h1>
      <p className="mt-2 text-sm text-muted">{t('library.addBookHint')}</p>
      <div
        aria-disabled="true"
        className="mt-6 flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-panel p-10 text-center text-muted"
      >
        <Icon name="upload" size={32} />
        <p>{t('upload.drop')}</p>
      </div>
      <p className="mt-4 rounded-xl bg-accent-soft/60 px-4 py-3 text-sm">{t('setup.comingSoon')}</p>
      <ol className="mt-6 space-y-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-panel text-xs text-muted">
              {fmtNum(i + 1)}
            </span>
            {t(`setup.steps.${s}`)}
          </li>
        ))}
      </ol>
    </main>
  );
}
