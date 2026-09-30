import { LANGUAGES } from '@dozabaneh/text';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { languageName } from '../../lib/format';
import { useSignOut } from '../auth/AccessGate';
import { useIsOwner } from '../auth/access';
import { AccessSection } from './AccessSection';
import { DisplaySettingsForm } from './DisplaySettingsForm';
import { EnginesSection } from './EnginesSection';

/** Settings «تنظیمات» (SPEC §13.7): display, AI engines (free providers, keys stay on the server), languages. */
export function SettingsPage() {
  const { t } = useTranslation();
  const owner = useIsOwner();
  const signOut = useSignOut();
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

      {owner ? (
        <>
          <EnginesSection />
          <AccessSection />
        </>
      ) : (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <p className="text-sm text-muted">{t('access.readerHint')}</p>
          <Button className="mt-3" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            {t('access.signOut')}
          </Button>
        </section>
      )}

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
