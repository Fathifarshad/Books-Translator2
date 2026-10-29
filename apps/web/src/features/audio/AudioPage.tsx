import { AUDIO_KINDS, type AudioKind } from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { api, audioTrackUrl } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { targetOf, useBookLiveUpdates } from '../pipeline/live';
import { useVoice } from '../settings/VoiceSection';

const audioKey = (bookId: string, kind: AudioKind) => ['audio', bookId, kind] as const;

/** Minutes and seconds, or nothing when the length is not known (MP3, whose player reports it better). */
function duration(seconds: number, format: (n: number) => string): string {
  if (!seconds) return '';
  return `${format(Math.floor(seconds / 60))}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

/**
 * «فایل صوتی کتاب» (SPEC §13.9): the whole translation or a summary of it, one file per chapter so a phone's
 * player shows the book as a playlist. Recording runs on the server as a job; this page starts it and hands over
 * the files.
 */
export function AudioPage() {
  const { t } = useTranslation();
  const { bookId = '' } = useParams();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<AudioKind>('full');
  const detail = useQuery({ queryKey: ['book', bookId], queryFn: () => api.book(bookId), enabled: Boolean(bookId) });
  const book = detail.data?.book;
  const lang = book ? targetOf(book) : '';
  const voice = useVoice();
  useBookLiveUpdates(bookId);

  const status = useQuery({
    queryKey: audioKey(bookId, kind),
    queryFn: () => api.audio(bookId, kind, lang || undefined),
    enabled: Boolean(bookId && lang),
    // While a recording runs the page follows it; otherwise it sits still.
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: () => api.startAudio(bookId, kind, lang || undefined),
    onSuccess: (data) => queryClient.setQueryData(audioKey(bookId, kind), data),
  });

  const data = status.data;
  const browserOnly = voice.data?.source === 'browser';
  const blocked = browserOnly || voice.data?.ready === false;

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-3xl px-5 py-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <Icon name="back" size={16} />
        {t('reader.backToLibrary')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t('audio.title')}</h1>
      {book ? (
        <p className="mt-1 text-sm text-muted">
          <LangText lang={book.sourceLang}>{book.titles[book.sourceLang] ?? ''}</LangText>
        </p>
      ) : null}

      <fieldset className="mt-5 flex flex-wrap gap-2">
        <legend className="sr-only">{t('audio.title')}</legend>
        {AUDIO_KINDS.map((id) => (
          <Button
            key={id}
            variant={kind === id ? 'primary' : undefined}
            onClick={() => setKind(id)}
            data-testid={`audio-kind-${id}`}
          >
            {t(`audio.kinds.${id}`)}
          </Button>
        ))}
      </fieldset>
      <p className="mt-2 text-sm leading-7 text-muted">{t(`audio.kindHint.${kind}`)}</p>

      {blocked ? (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {browserOnly ? t('audio.browserOnly') : t('audio.notReady')}{' '}
          <Link to="/settings#voice" className="underline underline-offset-4">
            {t('voice.title')}
          </Link>
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon="sparkle"
            onClick={() => start.mutate()}
            disabled={start.isPending || data?.state === 'running'}
            data-testid="audio-build"
          >
            {data?.tracks.length ? t('audio.rebuild') : t('audio.build')}
          </Button>
          {data?.state === 'running' ? (
            <span role="status" className="text-sm text-muted">
              {t('audio.building', { done: fmtNum(data.done), total: fmtNum(data.total) })}
            </span>
          ) : null}
        </div>
      )}

      {data?.state === 'failed' && data.error ? (
        <p role="alert" className="mt-4 text-sm text-danger" data-testid="audio-error">
          {t('audio.failed', { message: data.error })}
        </p>
      ) : null}

      <section className="mt-6">
        {!data || data.tracks.length === 0 ? (
          <p className="text-sm text-muted" data-testid="audio-empty">
            {t('audio.empty')}
          </p>
        ) : (
          <>
            <h2 className="mb-3 text-sm text-muted">{t('audio.tracks', { count: fmtNum(data.tracks.length) })}</h2>
            <ul className="flex flex-col gap-3">
              {data.tracks.map((track) => (
                <li key={track.id} className="rounded-xl border border-border bg-surface p-4" data-testid="audio-track">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{track.title}</span>
                    <span className="text-xs text-muted">{duration(track.seconds, fmtNum)}</span>
                    <a
                      href={audioTrackUrl(bookId, track.id, kind, lang || undefined)}
                      download
                      className="ms-auto inline-flex items-center gap-1 text-sm text-accent underline decoration-accent/40 underline-offset-4"
                    >
                      <Icon name="download" size={14} />
                      {t('audio.download')}
                    </a>
                  </div>
                  {/* biome-ignore lint/a11y/useMediaCaption: a recording of the book itself has no caption track */}
                  <audio
                    controls
                    preload="none"
                    src={audioTrackUrl(bookId, track.id, kind, lang || undefined)}
                    className="mt-2 w-full"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
