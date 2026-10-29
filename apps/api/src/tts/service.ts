import type {
  AudioFormat,
  TtsProblem,
  TtsSource,
  TtsTestResult,
  TtsUpdate,
  TtsView,
  TtsVoice,
} from '@dozabaneh/shared';
import { isFileTtsSource } from '@dozabaneh/shared';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { keyHint, type SecretBox } from '../settings/secrets';
import { getSetting, setSetting } from '../settings/store';
import { createSpeechEngine, onPath, type SpeechConfig, type SpeechEngine, SpeechError } from './engines';

/**
 * The voice the app reads with (SPEC §13.9). One choice for the whole app, like the assistant engine: which
 * source, which voice, and — for the services — the key, which stays on this computer and encrypted, exactly as
 * the translation keys do (golden rule 7).
 */
interface StoredTts {
  source?: TtsSource;
  keyEnc?: Partial<Record<TtsSource, string>>;
  keyHint?: Partial<Record<TtsSource, string>>;
  region?: string;
  /** The chosen voice per source, so switching back does not lose it. */
  voice?: Partial<Record<TtsSource, string>>;
  binPath?: string;
  voicePath?: string;
  /** Prepare each line with the assistant engine before reading it (on unless turned off). */
  polish?: boolean;
  problem?: TtsProblem;
}

const KEY = 'tts';
const SAMPLE_TEXT_KEY = 'ttsSample';

/** Where each service's key is made. */
const KEY_URLS: Partial<Record<TtsSource, string>> = {
  azure: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices',
  google: 'https://console.cloud.google.com/apis/credentials',
  openai: 'https://platform.openai.com/api-keys',
};

export class TtsService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly box: SecretBox,
    /** Injected in tests. */
    private readonly deps: Pick<SpeechConfig, 'fetch' | 'spawn'> = {},
  ) {}

  private stored(): StoredTts {
    return getSetting<StoredTts>(this.db, KEY) ?? {};
  }

  private save(next: StoredTts): void {
    setSetting(this.db, KEY, next);
  }

  source(): TtsSource {
    return this.stored().source ?? 'browser';
  }

  /** Whether the assistant engine prepares each line before it is read (ADR-042). */
  polish(): boolean {
    return this.stored().polish !== false;
  }

  /** The decrypted key of a source; null when none is stored, undefined when it cannot be read. */
  private apiKey(source: TtsSource): string | null | undefined {
    const enc = this.stored().keyEnc?.[source];
    if (!enc) return null;
    return this.box.decrypt(enc) ?? undefined;
  }

  private voiceOf(source: TtsSource): string {
    return this.stored().voice?.[source] ?? '';
  }

  /** Whether ffmpeg is around to turn Piper's WAV into MP3. */
  canEncodeMp3(): boolean {
    return onPath('ffmpeg') !== null;
  }

  format(): AudioFormat {
    const source = this.source();
    if (source === 'piper') return this.canEncodeMp3() ? 'mp3' : 'wav';
    return 'mp3';
  }

  view(voices: TtsVoice[] = []): TtsView {
    const s = this.stored();
    const source = this.source();
    const needsKey = source === 'azure' || source === 'google' || source === 'openai';
    const key = this.apiKey(source);
    const hasKey = typeof key === 'string';
    const voice = this.voiceOf(source);
    const configured =
      source === 'browser'
        ? true
        : source === 'piper'
          ? Boolean((s.voicePath ?? '').trim())
          : hasKey && voice !== '' && (source !== 'azure' || Boolean((s.region ?? '').trim()));
    return {
      source,
      needsKey,
      keyUrl: KEY_URLS[source] ?? null,
      hasKey,
      keyHint: hasKey ? (s.keyHint?.[source] ?? null) : null,
      region: s.region ?? '',
      voice,
      voices,
      binPath: s.binPath ?? '',
      voicePath: s.voicePath ?? '',
      format: this.format(),
      canEncodeMp3: this.canEncodeMp3(),
      polish: this.polish(),
      problem: s.problem ?? null,
      ready: configured && !s.problem?.blocking,
    };
  }

  update(patch: TtsUpdate): void {
    const next: StoredTts = { ...this.stored() };
    const source = patch.source ?? this.source();
    if (patch.source) next.source = patch.source;
    if (patch.apiKey !== undefined) {
      const keys = { ...(next.keyEnc ?? {}) };
      const hints = { ...(next.keyHint ?? {}) };
      if (patch.apiKey === null) {
        delete keys[source];
        delete hints[source];
      } else {
        keys[source] = this.box.encrypt(patch.apiKey);
        hints[source] = keyHint(patch.apiKey);
      }
      next.keyEnc = keys;
      next.keyHint = hints;
    }
    if (patch.region !== undefined) next.region = patch.region;
    if (patch.voice !== undefined) next.voice = { ...(next.voice ?? {}), [source]: patch.voice };
    if (patch.binPath !== undefined) next.binPath = patch.binPath;
    if (patch.voicePath !== undefined) next.voicePath = patch.voicePath;
    if (patch.polish !== undefined) next.polish = patch.polish;
    // New settings deserve a fresh try.
    delete next.problem;
    this.save(next);
  }

  /** The engine for the chosen source; throws for `browser`, which speaks in the page and writes nothing. */
  engine(lang: string, source: TtsSource = this.source(), foreignLang?: string): SpeechEngine {
    if (!isFileTtsSource(source)) {
      throw new SpeechError('NOT_FOUND', 'The browser voice reads in the page; it cannot write a file.', true);
    }
    const s = this.stored();
    const key = this.apiKey(source);
    if (key === undefined) throw new SpeechError('AUTH', 'The stored key cannot be read; enter it again.', true);
    return createSpeechEngine(source, {
      ...(key ? { apiKey: key } : {}),
      ...(s.region ? { region: s.region } : {}),
      voice: this.voiceOf(source),
      ...(s.binPath ? { binPath: s.binPath } : {}),
      ...(s.voicePath ? { voicePath: s.voicePath } : {}),
      lang,
      // Azure and Google take SSML: a pause between lines, and a foreign run marked so the voice switches to it.
      ssml: source === 'azure' || source === 'google',
      ...(foreignLang ? { foreignLang } : {}),
      ...this.deps,
    });
  }

  async voices(lang: string): Promise<TtsVoice[]> {
    const source = this.source();
    if (!isFileTtsSource(source)) return [];
    return this.engine(lang, source).voices();
  }

  /** Says a short sentence aloud to prove the source works, and returns it for the page to play. */
  async test(lang: string): Promise<TtsTestResult> {
    const source = this.source();
    if (!isFileTtsSource(source)) {
      return { ok: false, error: { code: 'BROWSER', message: 'The browser voice is tried in the page itself.' } };
    }
    let voices: TtsVoice[] | undefined;
    try {
      const engine = this.engine(lang, source);
      voices = await engine.voices().catch(() => undefined);
      if (!this.voiceOf(source) && voices?.length) {
        const preferred = voices.find((v) => v.lang?.toLowerCase().startsWith(lang.toLowerCase())) ?? voices[0];
        if (preferred) this.update({ voice: preferred.id });
      }
      const started = Date.now();
      const sample = getSetting<string>(this.db, SAMPLE_TEXT_KEY) ?? 'سلام. این صدای آزمایشی است.';
      const { audio, format } = await this.engine(lang, source).speak(sample);
      this.clearProblem();
      return {
        ok: true,
        sample: `data:audio/${format === 'mp3' ? 'mpeg' : 'wav'};base64,${audio.toString('base64')}`,
        format,
        ms: Date.now() - started,
        ...(voices ? { voices } : {}),
      };
    } catch (err) {
      const e = err instanceof SpeechError ? err : new SpeechError('OTHER', (err as Error).message);
      this.reportError(e);
      return { ok: false, ...(voices ? { voices } : {}), error: { code: e.code, message: e.message } };
    }
  }

  reportError(err: SpeechError): void {
    this.save({
      ...this.stored(),
      problem: {
        code: err.code,
        message: err.message.slice(0, 300),
        at: new Date().toISOString(),
        blocking: err.blocking,
      },
    });
  }

  clearProblem(): void {
    const s = this.stored();
    if (s.problem) {
      delete s.problem;
      this.save(s);
    }
  }

  /** Where recordings are kept (git-ignored, like uploads). */
  audioDir(): string {
    return `${this.config.dataDir}/audio`;
  }
}
