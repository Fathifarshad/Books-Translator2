import { isFileTtsSource } from '@dozabaneh/shared';
import { getLanguage } from '@dozabaneh/text';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useVoice } from '../settings/VoiceSection';

/**
 * «بخوان» (SPEC §13.9): reads the section on screen. With a source that writes sound (Piper, Azure, …) chosen in
 * Settings, the server reads it piece by piece and the page plays the pieces in turn, fetching the next one while
 * the current one plays. Otherwise the voice the computer or phone already has reads it — which on Windows often
 * has no Persian voice at all.
 *
 * The text is taken from the target column as rendered, so what is read is exactly what is on screen.
 */
function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const tag = lang.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith(tag)) ??
    voices.find((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === tag)
  );
}

function sectionLines(): string[] {
  const cells = document.querySelectorAll('[data-col="target"] p');
  return [...cells].map((cell) => cell.textContent?.trim() ?? '').filter(Boolean);
}

/** Paragraphs grouped into pieces short enough that the first one is ready in a few seconds. */
const PIECE_CHARS = 700;
export function piecesOf(lines: string[], max = PIECE_CHARS): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > max) {
      pieces.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

type State = 'idle' | 'loading' | 'speaking';

export function ReadAloud({ lang }: { lang: string }) {
  const { t } = useTranslation();
  const voice = useVoice();
  const [state, setState] = useState<State>('idle');
  const [problem, setProblem] = useState<'missing' | 'failed' | null>(null);
  const run = useRef<{ abort: AbortController; audio: HTMLAudioElement; urls: string[] } | null>(null);
  const browserVoice = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const server = !!voice.data && isFileTtsSource(voice.data.source) && voice.data.ready;

  const stop = () => {
    window.speechSynthesis?.cancel();
    const r = run.current;
    if (r) {
      r.abort.abort();
      r.audio.pause();
      for (const url of r.urls) URL.revokeObjectURL(url);
      run.current = null;
    }
    setState('idle');
  };

  // Stop when the reader leaves the page; a voice that keeps talking over the next section is worse than none.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only
  useEffect(() => stop, []);

  if (!server && !browserVoice) return null;

  const readOnServer = async (pieces: string[]) => {
    const abort = new AbortController();
    const audio = new Audio();
    const current = { abort, audio, urls: [] as string[] };
    run.current = current;
    const fetchPiece = (i: number) =>
      api.speak(pieces[i] as string, lang, abort.signal).then((blob) => {
        const url = URL.createObjectURL(blob);
        current.urls.push(url);
        return url;
      });
    setState('loading');
    try {
      let next = fetchPiece(0);
      for (let i = 0; i < pieces.length; i++) {
        const url = await next;
        if (i + 1 < pieces.length) next = fetchPiece(i + 1);
        if (run.current !== current) return;
        audio.src = url;
        setState('speaking');
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('playback'));
          audio.play().catch(reject);
        });
      }
      if (run.current === current) stop();
    } catch {
      if (run.current !== current) return;
      stop();
      setProblem('failed');
    }
  };

  const readInBrowser = (text: string) => {
    const v = voiceFor(lang);
    if (!v) {
      setProblem('missing');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = v;
    utterance.lang = v.lang;
    utterance.rate = 1;
    utterance.onend = () => setState('idle');
    utterance.onerror = () => setState('idle');
    setState('speaking');
    window.speechSynthesis.speak(utterance);
  };

  const start = () => {
    const lines = sectionLines();
    if (lines.length === 0) return;
    setProblem(null);
    if (server) void readOnServer(piecesOf(lines));
    else readInBrowser(lines.join('\n'));
  };

  const busy = state !== 'idle';
  return (
    <>
      <Button
        icon={busy ? 'close' : 'sparkle'}
        aria-pressed={busy}
        onClick={() => (busy ? stop() : start())}
        data-testid="read-aloud"
      >
        {state === 'loading' ? t('reader.speakLoading') : busy ? t('reader.stopSpeaking') : t('reader.speak')}
      </Button>
      {problem ? (
        <span role="alert" className="text-xs text-danger" dir={getLanguage(lang).dir}>
          {t(problem === 'missing' ? 'reader.speakUnavailable' : 'reader.speakFailed')}
        </span>
      ) : null}
    </>
  );
}
