import { TTS_SOURCES, type TtsSource, type TtsUpdate } from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { UI_LANG } from '../../i18n';
import { api } from '../../lib/api';
import { fmtNum } from '../../lib/format';

const PIPER_HELP = 'https://github.com/OHF-Voice/piper1-gpl';
const field = 'rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent/60';

export const voiceKey = ['tts'] as const;

export function useVoice() {
  return useQuery({ queryKey: voiceKey, queryFn: api.tts, staleTime: 15_000, retry: false });
}

/**
 * Settings → «صدا و پادکست» (SPEC §13.9). Claude has no voice, so the user picks where the sound comes from:
 * the one Windows already has (free, reads in the page, writes no file), a program on this computer (Piper —
 * free, offline, writes a file) or a service (a key, paid per character). The key never leaves the server.
 */
export function VoiceSection({ lang = UI_LANG }: { lang?: string }) {
  const { t } = useTranslation();
  const view = useVoice();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: voiceKey });
  const save = useMutation({ mutationFn: (patch: TtsUpdate) => api.updateTts(patch), onSuccess: refresh });
  const test = useMutation({ mutationFn: () => api.testTts(lang), onSettled: refresh });
  const voices = useMutation({ mutationFn: () => api.ttsVoices(lang) });
  const [key, setKey] = useState('');

  const data = view.data;
  if (!data) {
    return (
      <section id="voice" className="mt-6 scroll-mt-4 rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-2 text-lg font-bold">{t('voice.title')}</h2>
        <p className="text-sm text-muted">{view.isError ? t('app.serverDown') : t('app.loading')}</p>
      </section>
    );
  }
  const source = data.source;
  const list = voices.data?.voices ?? data.voices;
  const state: 'ready' | 'notReady' | 'problem' = data.problem?.blocking
    ? 'problem'
    : data.ready
      ? 'ready'
      : 'notReady';

  return (
    <section
      id="voice"
      className="mt-6 scroll-mt-4 rounded-2xl border border-border bg-surface p-5"
      data-testid="voice-section"
    >
      <h2 className="mb-2 text-lg font-bold">{t('voice.title')}</h2>
      <p className="text-sm leading-7 text-muted">{t('voice.intro')}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">{t('voice.source')}</span>
          <select
            value={source}
            onChange={(e) => save.mutate({ source: e.target.value as TtsSource })}
            className={`${field} min-w-0 max-w-full`}
            data-testid="voice-source"
          >
            {TTS_SOURCES.map((id) => (
              <option key={id} value={id}>
                {t(`voice.sources.${id}`)}
              </option>
            ))}
          </select>
        </label>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${state === 'ready' ? 'bg-accent-soft text-accent' : state === 'problem' ? 'bg-danger-soft text-danger' : 'bg-bg text-muted'}`}
          data-testid="voice-status"
        >
          {state === 'ready' ? <Icon name="check" size={12} className="me-1 inline" /> : null}
          {t(`voice.status.${state}`)}
        </span>
      </div>

      <p className="mt-3 text-sm leading-7">{t(`voice.hints.${source}`)}</p>

      {data.needsKey ? (
        <div className="mt-3 flex flex-col gap-2">
          {data.keyUrl ? (
            <a
              href={data.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-sm text-accent underline decoration-accent/40 underline-offset-4"
            >
              {t('voice.getKey')}
              <Icon name="link" size={14} />
            </a>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={data.keyHint ?? t('engines.keyPlaceholder')}
              className={`${field} min-w-56 flex-1`}
              dir="ltr"
              aria-label={t('engines.key')}
              data-testid="voice-key"
            />
            <Button
              variant="primary"
              onClick={() => {
                save.mutate({ apiKey: key.trim() }, { onSuccess: () => setKey('') });
              }}
              disabled={key.trim().length < 8 || save.isPending}
            >
              {t('engines.saveAndTest')}
            </Button>
          </div>
          {source === 'azure' ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t('voice.region')}</span>
              <input
                defaultValue={data.region}
                onBlur={(e) => e.target.value !== data.region && save.mutate({ region: e.target.value.trim() })}
                placeholder={t('voice.regionPlaceholder')}
                className={`${field} w-48`}
                dir="ltr"
                data-testid="voice-region"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {source === 'piper' ? (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <a
            href={PIPER_HELP}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-accent underline decoration-accent/40 underline-offset-4"
          >
            {t('voice.piperHelp')}
            <Icon name="link" size={14} />
          </a>
          <label className="flex flex-col gap-1">
            <span>{t('voice.piperVoice')}</span>
            <input
              defaultValue={data.voicePath}
              onBlur={(e) => e.target.value !== data.voicePath && save.mutate({ voicePath: e.target.value.trim() })}
              className={`${field} font-mono`}
              dir="ltr"
              data-testid="voice-piper-model"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>{t('voice.piperBin')}</span>
            <input
              defaultValue={data.binPath}
              onBlur={(e) => e.target.value !== data.binPath && save.mutate({ binPath: e.target.value.trim() })}
              className={`${field} font-mono`}
              dir="ltr"
              data-testid="voice-piper-bin"
            />
          </label>
          {!data.canEncodeMp3 ? <p className="text-xs text-muted">{t('voice.mp3Hint')}</p> : null}
        </div>
      ) : null}

      {source !== 'browser' && source !== 'piper' ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span>{t('voice.chooseVoice')}</span>
            <select
              value={data.voice}
              onChange={(e) => save.mutate({ voice: e.target.value })}
              className={`${field} max-w-full font-mono`}
              dir="ltr"
              data-testid="voice-name"
            >
              {!data.voice ? <option value="">—</option> : null}
              {data.voice && !list.some((v) => v.id === data.voice) ? (
                <option value={data.voice}>{data.voice}</option>
              ) : null}
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <Button icon="history" onClick={() => voices.mutate()} disabled={voices.isPending}>
            {t('voice.loadVoices')}
          </Button>
          {voices.data && list.length === 0 ? <span className="text-xs text-danger">{t('voice.noVoices')}</span> : null}
        </div>
      ) : null}

      {source !== 'browser' ? (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={data.polish}
            onChange={(e) => save.mutate({ polish: e.target.checked })}
            className="mt-1.5"
            data-testid="voice-polish"
          />
          <span>
            <span className="font-medium">{t('voice.polish')}</span>
            <span className="block text-xs leading-6 text-muted">{t('voice.polishHint')}</span>
          </span>
        </label>
      ) : null}

      {source !== 'browser' ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => test.mutate()} disabled={test.isPending} data-testid="voice-test">
            {test.isPending ? t('voice.testing') : t('voice.test')}
          </Button>
          <span className="text-xs text-muted">{t('voice.format', { format: data.format.toUpperCase() })}</span>
        </div>
      ) : null}

      {test.data?.ok && test.data.sample ? (
        <div className="mt-3 flex flex-col gap-2" data-testid="voice-sample">
          <span role="status" className="text-sm text-accent">
            {t('voice.testOk', { seconds: fmtNum(Math.max(0.1, Math.round((test.data.ms ?? 0) / 100) / 10)) })}
          </span>
          {/* The sample is a data URL this page just received; nothing is stored. */}
          {/* biome-ignore lint/a11y/useMediaCaption: a spoken sample of the book has no separate caption track */}
          <audio controls src={test.data.sample} className="max-w-full" />
        </div>
      ) : null}
      {test.data && !test.data.ok ? (
        <p role="alert" className="mt-3 text-sm text-danger" data-testid="voice-error">
          {test.data.error?.message ?? ''}
        </p>
      ) : null}
      {data.problem && !test.data ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {data.problem.message}
        </p>
      ) : null}
    </section>
  );
}
