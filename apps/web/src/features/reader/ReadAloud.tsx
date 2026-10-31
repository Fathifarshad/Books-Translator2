import { isFileTtsSource } from '@dozabaneh/shared';
import { getLanguage } from '@dozabaneh/text';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { useVoice } from '../settings/VoiceSection';

/**
 * «بخوان» (SPEC §13.9): reads the section on screen. With a source that writes sound (Piper, Azure, …) chosen in
 * Settings, the server reads it piece by piece and the page plays the pieces in turn, fetching the next one while
 * the current one plays. Otherwise the voice the computer or phone already has reads it — which on Windows often
 * has no Persian voice at all.
 *
 * A read can be paused and continued from the same piece, started over, and played at another speed.
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

/** Smaller pieces for the browser voice, so a pause or a change of speed loses only a sentence or two. */
const BROWSER_PIECE_CHARS = 300;
const RATES = [0.75, 1, 1.25, 1.5, 2] as const;

type State = 'idle' | 'loading' | 'speaking' | 'paused';
interface ServerRun {
  abort: AbortController;
  audio: HTMLAudioElement;
  urls: string[];
}

export function ReadAloud({ lang }: { lang: string }) {
  const { t } = useTranslation();
  const voice = useVoice();
  const [state, setState] = useState<State>('idle');
  const [rate, setRate] = useState<number>(1);
  const [problem, setProblem] = useState<'missing' | 'failed' | null>(null);
  const run = useRef<ServerRun | null>(null);
  /** Where a read stands, so «ادامه» goes on from there and «از اول» starts over. */
  const at = useRef<{ key: string; index: number; pieces: string[] } | null>(null);
  /** Bumped whenever the browser voice is cancelled, so a cancelled piece never starts the next one. */
  const generation = useRef(0);
  const rateRef = useRef(1);
  const browserVoice = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const server = !!voice.data && isFileTtsSource(voice.data.source) && voice.data.ready;

  /** Silences everything without touching the state or the position. */
  const teardown = () => {
    generation.current++;
    window.speechSynthesis?.cancel();
    const r = run.current;
    if (r) {
      r.abort.abort();
      r.audio.pause();
      for (const url of r.urls) URL.revokeObjectURL(url);
      run.current = null;
    }
  };

  /** «پایان»: stop and forget the position. */
  const reset = () => {
    teardown();
    at.current = null;
    setState('idle');
  };

  // Stop when the reader leaves the page; a voice that keeps talking over the next section is worse than none.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only
  useEffect(() => teardown, []);

  if (!server && !browserVoice) return null;

  const playOnServer = async (pieces: string[], key: string, from: number) => {
    teardown();
    const abort = new AbortController();
    const audio = new Audio();
    const current: ServerRun = { abort, audio, urls: [] };
    run.current = current;
    const fetchPiece = (i: number) => {
      const p = api.speak(pieces[i] as string, lang, abort.signal).then((blob) => {
        const url = URL.createObjectURL(blob);
        current.urls.push(url);
        return url;
      });
      // Awaited later; a read stopped in the meantime must not leave an unhandled rejection behind.
      p.catch(() => undefined);
      return p;
    };
    setState('loading');
    try {
      let next = fetchPiece(from);
      for (let i = from; i < pieces.length; i++) {
        at.current = { key, index: i, pieces };
        const url = await next;
        if (i + 1 < pieces.length) next = fetchPiece(i + 1);
        if (run.current !== current) return;
        audio.src = url;
        audio.defaultPlaybackRate = rateRef.current;
        audio.playbackRate = rateRef.current;
        setState('speaking');
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('playback'));
          audio.play().catch(reject);
        });
      }
      if (run.current === current) reset();
    } catch {
      if (run.current !== current) return;
      reset();
      setProblem('failed');
    }
  };

  const playInBrowser = (pieces: string[], key: string, from: number) => {
    const v = voiceFor(lang);
    if (!v) {
      setProblem('missing');
      return;
    }
    teardown();
    const g = generation.current;
    const speakAt = (i: number) => {
      if (i >= pieces.length) {
        reset();
        return;
      }
      at.current = { key, index: i, pieces };
      const utterance = new SpeechSynthesisUtterance(pieces[i] as string);
      utterance.voice = v;
      utterance.lang = v.lang;
      utterance.rate = rateRef.current;
      utterance.onend = () => generation.current === g && speakAt(i + 1);
      utterance.onerror = () => generation.current === g && reset();
      window.speechSynthesis.speak(utterance);
    };
    setState('speaking');
    speakAt(from);
  };

  const begin = (from: 'start' | 'saved') => {
    const lines = sectionLines();
    if (lines.length === 0) return;
    setProblem(null);
    const pieces = piecesOf(lines, server ? PIECE_CHARS : BROWSER_PIECE_CHARS);
    const key = lines.join('\n');
    const saved = at.current;
    const index = from === 'saved' && saved?.key === key ? Math.min(saved.index, pieces.length - 1) : 0;
    if (server) void playOnServer(pieces, key, index);
    else playInBrowser(pieces, key, index);
  };

  const pause = () => {
    if (run.current) run.current.audio.pause();
    else teardown(); // the browser voice's own pause is unreliable; it takes the piece up again from its start
    setState('paused');
  };

  const resume = () => {
    const r = run.current;
    if (r?.audio.src) {
      void r.audio.play();
      setState('speaking');
    } else begin('saved');
  };

  const changeRate = (next: number) => {
    setRate(next);
    rateRef.current = next;
    const r = run.current;
    if (r) {
      r.audio.defaultPlaybackRate = next;
      r.audio.playbackRate = next;
    } else if (state === 'speaking' && at.current) {
      // The browser voice takes its speed per piece: say the current piece again at the new speed.
      playInBrowser(at.current.pieces, at.current.key, at.current.index);
    }
  };

  return (
    <>
      {state === 'idle' ? (
        <Button icon="sparkle" onClick={() => begin('start')} data-testid="read-aloud">
          {t('reader.speak')}
        </Button>
      ) : state === 'loading' ? (
        <Button icon="close" aria-pressed onClick={reset} data-testid="read-aloud">
          {t('reader.speakLoading')}
        </Button>
      ) : state === 'speaking' ? (
        <Button icon="pause" aria-pressed onClick={pause} data-testid="read-aloud">
          {t('reader.pauseSpeaking')}
        </Button>
      ) : (
        <>
          <Button icon="play" onClick={resume} data-testid="read-aloud-resume">
            {t('reader.resumeSpeaking')}
          </Button>
          <Button onClick={() => begin('start')} data-testid="read-aloud-restart">
            {t('reader.restartSpeaking')}
          </Button>
        </>
      )}
      {state !== 'idle' ? (
        <>
          <label className="inline-flex items-center gap-1 text-xs text-muted">
            <span>{t('reader.speakRate')}</span>
            <select
              value={rate}
              onChange={(e) => changeRate(Number(e.target.value))}
              className="rounded-lg border border-border bg-bg px-1.5 py-1 text-xs text-text"
              data-testid="read-aloud-rate"
            >
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {fmtNum(r)}×
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" icon="stop" onClick={reset} data-testid="read-aloud-stop">
            {t('reader.stopSpeaking')}
          </Button>
        </>
      ) : null}
      {problem ? (
        <span role="alert" className="text-xs text-danger" dir={getLanguage(lang).dir}>
          {t(problem === 'missing' ? 'reader.speakUnavailable' : 'reader.speakFailed')}
        </span>
      ) : null}
    </>
  );
}
