import { LANGUAGES } from '@dozabaneh/text';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { languageName } from '../../lib/format';
import { DisplaySettingsForm } from './DisplaySettingsForm';

/** Settings «تنظیمات» (SPEC §13.7). Engine keys and connection tests arrive with the API engines (Phase 4). */
export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <main id="main" className="mx-auto min-h-dvh max-w-2xl px-5 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <Icon name="back" size={16} />
        {t('reader.backToLibrary')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t('settings.title')}</h1>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-4 text-lg font-bold">{t('settings.display')}</h2>
        <DisplaySettingsForm />
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-2 text-lg font-bold">{t('settings.engines')}</h2>
        <p className="text-sm leading-7 text-muted">{t('settings.engineInfo')}</p>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-2 text-lg font-bold">{t('settings.languages')}</h2>
        <p className="mb-2 text-sm text-muted">{t('settings.installedLanguages')}</p>
        <ul className="flex flex-wrap gap-2">
          {Object.keys(LANGUAGES).map((code) => (
            <li key={code} className="rounded-full border border-border px-3 py-1 text-sm">
              {languageName(code)}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
