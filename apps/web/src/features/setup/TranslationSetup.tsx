import {
  type BookBundle,
  type BookRecord,
  isProviderId,
  PIPELINE_ENGINES,
  PIPELINE_TASKS,
  type PipelineEngine,
  QUALITY_PROFILES,
  type TranslationSettings,
} from '@dozabaneh/shared';
import { getLanguage, LANGUAGES } from '@dozabaneh/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Button } from '../../components/ui';
import { booksKey } from '../../data/books';
import { ApiError, api } from '../../lib/api';
import { fmtNum, languageName } from '../../lib/format';
import { AgentHint } from '../pipeline/AgentHint';
import { glossaryKey, pipelineKey, targetOf, useBookLiveUpdates, usePipeline } from '../pipeline/live';
import { useProviders } from '../settings/engines';

type Settings = Omit<TranslationSettings, 'priorityNodeIds'> & { priorityNodeIds: string[] };

const DEFAULTS: Settings = {
  profile: 'balanced',
  engines: { brief: 'agent', glossary: 'agent', translate: 'agent', edit: 'agent' },
  ezafe: 'yeh',
  digits: 'native',
  parenthetical: 'first_in_chapter',
  autoApproveGlossary: false,
  priorityNodeIds: [],
};

/** Add-book wizard steps 4–6 (SPEC §13.2): translation settings → brief & glossary review → translation. */
export function TranslationSetup({ book, bundle }: { book: BookRecord; bundle: BookBundle }) {
  const { t } = useTranslation();
  const [lang, setLang] = useState(targetOf(book));
  const pipeline = usePipeline(book.id, lang);
  useBookLiveUpdates(book.id);
  const p = pipeline.data;
  if (!p) return null;

  if (p.state === 'idle' || p.state === 'cancelled') {
    return <SettingsStep book={book} bundle={bundle} lang={lang} setLang={setLang} initial={p.settings} />;
  }
  if (p.state === 'waiting_glossary_review') return <GlossaryStep book={book} lang={lang} />;
  const preparing = p.stage === 'brief' || p.stage === 'glossary';
  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-5" data-testid="translation-running">
      <h2 className="text-lg font-bold">{preparing ? t('setup.briefAndGlossary') : t('setup.steps.translate')}</h2>
      <p className="mt-2 text-sm" role="status">
        {preparing ? t('setup.preparing') : t('setup.running')}
      </p>
      {p.agent.pending > 0 ? <AgentHint count={p.agent.pending} className="mt-4" /> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={`/books/${book.id}/pipeline`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          data-testid="open-dashboard"
        >
          {t('setup.openDashboard')}
        </Link>
      </div>
    </section>
  );
}

function SettingsStep({
  book,
  bundle,
  lang,
  setLang,
  initial,
}: {
  book: BookRecord;
  bundle: BookBundle;
  lang: string;
  setLang: (l: string) => void;
  initial: TranslationSettings;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [s, setS] = useState<Settings>({ ...DEFAULTS, ...initial });
  useEffect(() => setS({ ...DEFAULTS, ...initial }), [initial]);
  const targets = Object.keys(LANGUAGES).filter((code) => code !== book.sourceLang);
  const chapters = useMemo(() => bundle.nodes.filter((n) => n.kind === 'chapter' && !n.skip), [bundle.nodes]);
  const titleOf = (headingId?: string, fallback?: string) =>
    bundle.segments.find((seg) => seg.id === headingId)?.src ?? fallback ?? '';
  const providers = useProviders().data?.providers;
  const readyProviders = (providers ?? []).filter((p) => p.ready).map((p) => p.id);
  // Untouched defaults (all Claude Code) switch to the first connected free provider.
  const firstReady = readyProviders[0];
  useEffect(() => {
    if (!firstReady) return;
    setS((x) =>
      PIPELINE_TASKS.every((k) => x.engines[k] === 'agent') &&
      PIPELINE_TASKS.every((k) => initial.engines[k] === 'agent')
        ? { ...x, engines: { brief: firstReady, glossary: firstReady, translate: firstReady, edit: firstReady } }
        : x,
    );
  }, [firstReady, initial]);
  const estimate = useQuery({
    queryKey: ['estimate', book.id, lang, s.profile, s.engines.translate, s.engines.edit],
    queryFn: () => api.estimate(book.id, lang, { profile: s.profile, engines: s.engines }),
  });
  const engineOptions = PIPELINE_ENGINES.map((engine) => {
    const offline = isProviderId(engine) && !readyProviders.includes(engine);
    return (
      <option key={engine} value={engine} disabled={offline}>
        {t(`setup.engines.${engine}`)}
        {offline ? ` ${t('setup.notConnected')}` : ''}
      </option>
    );
  });
  const start = useMutation({
    mutationFn: () => api.startPipeline(book.id, lang, s),
    onSuccess: (data) => {
      queryClient.setQueryData(pipelineKey(book.id, lang), data);
      void queryClient.invalidateQueries({ queryKey: ['book', book.id] });
      void queryClient.invalidateQueries({ queryKey: booksKey });
      if (typeof Notification !== 'undefined' && Notification.permission === 'default')
        void Notification.requestPermission();
    },
  });
  const setEngine = (task: (typeof PIPELINE_TASKS)[number], engine: PipelineEngine) =>
    setS((x) => ({ ...x, engines: { ...x.engines, [task]: engine } }));
  const e = estimate.data;
  const batches = e ? e.batches.brief + e.batches.glossary + e.batches.translate + e.batches.edit : 0;
  const field = 'rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/60';

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-5" data-testid="translation-settings">
      <h2 className="text-lg font-bold">{t('setup.translationSettings')}</h2>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t('setup.targetLanguage')}</span>
          <select
            value={lang}
            onChange={(ev) => setLang(ev.target.value)}
            className={field}
            data-testid="target-language"
          >
            {targets.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="mb-1.5 font-medium">{t('setup.qualityProfile')}</legend>
          {QUALITY_PROFILES.map((profile) => (
            <label key={profile} className="flex items-start gap-2">
              <input
                type="radio"
                name="profile"
                checked={s.profile === profile}
                onChange={() => setS((x) => ({ ...x, profile }))}
                className="mt-1.5"
              />
              <span>
                <span className="font-medium">{t(`setup.profiles.${profile}`)}</span>
                <span className="block text-xs text-muted">{t(`setup.profileHints.${profile}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2 text-sm md:col-span-2">
          <legend className="mb-1 font-medium">{t('setup.engine')}</legend>
          <p className="text-xs text-muted">{t('setup.engineHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PIPELINE_TASKS.map((task) => (
              <label key={task} className="flex items-center gap-2">
                <span className="w-24 shrink-0">{t(`setup.tasks.${task}`)}</span>
                <select
                  value={s.engines[task]}
                  onChange={(ev) => setEngine(task, ev.target.value as PipelineEngine)}
                  className={`${field} flex-1`}
                  data-testid={`engine-${task}`}
                >
                  {engineOptions}
                </select>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <span>{t('setup.allTasks')}</span>
              <select
                value={PIPELINE_TASKS.every((k) => s.engines[k] === s.engines.translate) ? s.engines.translate : ''}
                onChange={(ev) => {
                  const engine = ev.target.value as PipelineEngine;
                  if (engine)
                    setS((x) => ({
                      ...x,
                      engines: { brief: engine, glossary: engine, translate: engine, edit: engine },
                    }));
                }}
                className={field}
                data-testid="engine-all"
              >
                <option value="" disabled>
                  —
                </option>
                {engineOptions}
              </select>
            </label>
            <Link to="/settings?tab=engines" className="text-sm text-accent underline underline-offset-4">
              {t('setup.connectEngines')}
            </Link>
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t('setup.parenthetical')}</span>
          <select
            value={s.parenthetical}
            onChange={(ev) => setS((x) => ({ ...x, parenthetical: ev.target.value as Settings['parenthetical'] }))}
            className={field}
          >
            {(['first_in_chapter', 'always', 'never'] as const).map((o) => (
              <option key={o} value={o}>
                {t(`setup.parentheticalOptions.${o}`)}
              </option>
            ))}
          </select>
        </label>

        {getLanguage(lang).normalizer === 'fa' ? (
          <>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{t('setup.ezafe')}</span>
              <select
                value={s.ezafe}
                onChange={(ev) => setS((x) => ({ ...x, ezafe: ev.target.value as Settings['ezafe'] }))}
                className={field}
              >
                {(['yeh', 'hamza'] as const).map((o) => (
                  <option key={o} value={o}>
                    {t(`setup.ezafeOptions.${o}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{t('setup.digits')}</span>
              <select
                value={s.digits}
                onChange={(ev) => setS((x) => ({ ...x, digits: ev.target.value as Settings['digits'] }))}
                className={field}
              >
                {(['native', 'latin'] as const).map((o) => (
                  <option key={o} value={o}>
                    {t(`setup.digitsOptions.${o}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={s.autoApproveGlossary}
            onChange={(ev) => setS((x) => ({ ...x, autoApproveGlossary: ev.target.checked }))}
            data-testid="auto-approve"
          />
          {t('setup.autoApprove')}
        </label>

        {chapters.length > 1 ? (
          <fieldset className="text-sm md:col-span-2">
            <legend className="mb-1.5 font-medium">{t('setup.priorityChapters')}</legend>
            <div className="flex flex-wrap gap-2">
              {chapters.map((c) => {
                const on = s.priorityNodeIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setS((x) => ({
                          ...x,
                          priorityNodeIds: on
                            ? x.priorityNodeIds.filter((id) => id !== c.id)
                            : [...x.priorityNodeIds, c.id],
                        }))
                      }
                    />
                    <LangText lang={book.sourceLang}>{titleOf(c.headingSegmentId, c.title)}</LangText>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        {e ? (
          <p className="text-sm text-muted" data-testid="estimate">
            {t('setup.estimateLine', {
              segments: fmtNum(e.segments),
              words: fmtNum(e.words),
              batches: fmtNum(batches),
            })}
          </p>
        ) : null}
        <Button
          variant="primary"
          icon="sparkle"
          className="ms-auto"
          onClick={() => start.mutate()}
          disabled={start.isPending}
          data-testid="start-translation"
        >
          {t('setup.start')}
        </Button>
      </div>
      {start.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {start.error instanceof ApiError && start.error.code === 'PROVIDER_NOT_READY'
            ? t('setup.providerNotReady', {
                names: ((start.error.details.providers as string[] | undefined) ?? [])
                  .map((id) => t(`engines.names.${id}`))
                  .join(t('glossary.listSeparator')),
              })
            : t('setup.actionFailed')}
        </p>
      ) : null}
    </section>
  );
}

function GlossaryStep({ book, lang }: { book: BookRecord; lang: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const glossary = useQuery({ queryKey: glossaryKey(book.id, lang), queryFn: () => api.glossary(book.id, lang) });
  const [title, setTitle] = useState(book.titles[lang] ?? '');
  const [brief, setBrief] = useState(book.brief?.[lang] ?? '');
  const [saved, setSaved] = useState(false);
  const saveBrief = useMutation({
    mutationFn: () => api.patchBook(book.id, { titles: { [lang]: title.trim() }, brief: { [lang]: brief.trim() } }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['book', book.id] });
    },
  });
  const approve = useMutation({
    mutationFn: () => api.approveGlossary(book.id, lang),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pipeline', book.id] });
      void queryClient.invalidateQueries({ queryKey: ['glossary', book.id] });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, tgt }: { id: string; tgt: string }) => api.updateTerm(book.id, id, { tgt }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: glossaryKey(book.id, lang) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTerm(book.id, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: glossaryKey(book.id, lang) }),
  });
  const proposed = (glossary.data?.terms ?? []).filter((term) => term.status === 'proposed');
  const field = 'rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/60';

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-5" data-testid="glossary-step">
      <h2 className="text-lg font-bold">{t('setup.briefAndGlossary')}</h2>
      <p className="mt-1 text-sm text-muted">{t('setup.glossaryReview')}</p>

      <div className="mt-4 grid gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t('setup.translatedTitle')}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} lang={lang} dir="auto" className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t('setup.brief')}</span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            lang={lang}
            dir="auto"
            rows={5}
            className={`${field} leading-7`}
          />
        </label>
        <div className="flex items-center gap-3">
          <Button onClick={() => saveBrief.mutate()} disabled={saveBrief.isPending || !title.trim()}>
            {t('setup.saveBrief')}
          </Button>
          {saved ? (
            <span className="text-sm text-success" role="status">
              {t('setup.saved')}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <h3 className="font-bold">{t('glossary.title')}</h3>
        <span className="text-sm text-muted">{t('setup.proposedCount', { count: fmtNum(proposed.length) })}</span>
        <Link to={`/books/${book.id}/glossary`} className="ms-auto text-sm text-accent underline">
          {t('setup.openGlossary')}
        </Link>
      </div>
      {proposed.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('setup.noTerms')}</p>
      ) : (
        <ul
          className="mt-3 max-h-96 divide-y divide-border/70 overflow-y-auto rounded-xl border border-border"
          data-testid="proposed-terms"
        >
          {proposed.slice(0, 60).map((term) => (
            <li key={term.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="w-full shrink-0 font-medium sm:w-40 sm:font-normal">
                <LangText lang={term.srcLang}>{term.src}</LangText>
              </span>
              <input
                defaultValue={term.tgt}
                lang={lang}
                dir="auto"
                aria-label={t('glossary.target', { language: languageName(lang) })}
                className={`${field} min-w-32 flex-1`}
                onBlur={(e) => {
                  const tgt = e.target.value.trim();
                  if (tgt && tgt !== term.tgt) update.mutate({ id: term.id, tgt });
                }}
              />
              <span className="text-xs text-muted">{t(`glossary.kinds.${term.kind}`)}</span>
              <Button
                variant="ghost"
                icon="trash"
                className="px-2 py-1 text-xs"
                onClick={() => remove.mutate(term.id)}
                aria-label={t('glossary.delete')}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button onClick={() => approve.mutate()} disabled={approve.isPending} data-testid="skip-glossary-review">
          {t('setup.skipGlossaryReview')}
        </Button>
        <Button
          variant="primary"
          icon="check"
          onClick={() => approve.mutate()}
          disabled={approve.isPending}
          data-testid="approve-glossary"
        >
          {t('setup.approveAndContinue')}
        </Button>
      </div>
    </section>
  );
}
