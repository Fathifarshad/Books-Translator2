import { createReadStream } from 'node:fs';
import { API_PREFIX, AudioKindSchema, AudioRequestSchema, type AudioStatus } from '@dozabaneh/shared';
import { speechText } from '@dozabaneh/text';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { getBundle } from '../db/repo';
import { enqueue } from '../jobs/queue';
import { audioStatus, bookTitleFor, trackFile } from '../tts/audio';
import { SpeechError } from '../tts/engines';
import { httpError } from './errors';
import { exportFileName } from './export';

const Query = z.object({
  lang: z.string().min(2).max(12).optional(),
  kind: AudioKindSchema.default('full'),
});

const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav' } as const;

/** «بخوان» in the reader: a piece of the section on screen, read by the voice chosen in Settings. */
const SpeakBody = z.object({
  text: z.string().trim().min(1).max(4_000),
  lang: z.string().min(2).max(12),
});

/**
 * «فایل صوتی»: the book read aloud, one file per chapter (SPEC §13.9). Recording takes minutes, so it runs as a
 * job in the same queue as everything else; this route starts it, reports what it has done, and hands over the
 * finished files.
 */
export async function audioRoutes(app: FastifyInstance, { ctx }: { ctx: AppContext }): Promise<void> {
  const deps = () => ({ db: ctx.db, config: ctx.config, tts: ctx.tts, providers: ctx.providers });

  /** The book and its target language, or 404. */
  const read = (id: string, query: unknown) => {
    const bundle = getBundle(ctx.db, id);
    if (!bundle) throw httpError(404, 'BOOK_NOT_FOUND');
    const { lang: asked, kind } = Query.parse(query ?? {});
    const lang = asked ?? bundle.book.targetLangs[0] ?? (bundle.book.sourceLang === 'fa' ? 'en' : 'fa');
    return { bundle, lang, kind };
  };

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/audio`, async (req): Promise<AudioStatus> => {
    const { lang, kind } = read(req.params.id, req.query);
    return audioStatus(deps(), req.params.id, lang, kind);
  });

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/books/:id/audio`, async (req): Promise<AudioStatus> => {
    const { bundle } = read(req.params.id, {});
    const body = AudioRequestSchema.parse(req.body ?? {});
    const lang = body.lang ?? bundle.book.targetLangs[0] ?? (bundle.book.sourceLang === 'fa' ? 'en' : 'fa');
    const view = ctx.tts.view();
    // The browser's own voice reads in the page; there is nothing for the server to record.
    if (view.source === 'browser') throw httpError(409, 'TTS_BROWSER_ONLY');
    if (!view.ready) throw httpError(409, 'TTS_NOT_READY', { problem: view.problem });
    const running = audioStatus(deps(), req.params.id, lang, body.kind);
    if (running.state === 'running') return running;
    enqueue(ctx.db, { bookId: req.params.id, stage: 'audio', targetLang: lang, scope: { kind: body.kind } });
    ctx.runner.kick();
    return audioStatus(deps(), req.params.id, lang, body.kind);
  });

  /**
   * Reads a short piece aloud with the chosen file source (Piper, Azure, …) and hands the sound back to play in the
   * page — for a computer whose browser has no voice for the language. Only the rules prepare the text here; the
   * model pass would make the reader wait.
   */
  app.post(`${API_PREFIX}/tts/speak`, async (req, reply) => {
    const { text, lang } = SpeakBody.parse(req.body ?? {});
    const said = text
      .split('\n')
      .map((line) => speechText(line, lang))
      .filter(Boolean)
      .join('\n');
    if (!said) throw httpError(400, 'NOTHING_TO_SAY');
    try {
      const { audio, format } = await ctx.tts.engine(lang).speak(said);
      return reply.header('Content-Type', MIME[format]).header('Cache-Control', 'no-store').send(audio);
    } catch (err) {
      const e = err instanceof SpeechError ? err : new SpeechError('OTHER', (err as Error).message);
      throw httpError(503, 'TTS_FAILED', { reason: e.code, message: e.message.slice(0, 300) });
    }
  });

  app.get<{ Params: { id: string; trackId: string } }>(`${API_PREFIX}/books/:id/audio/:trackId`, async (req, reply) => {
    const { lang, kind } = read(req.params.id, req.query);
    const found = trackFile(ctx.config, req.params.id, lang, kind, req.params.trackId);
    if (!found) throw httpError(404, 'TRACK_NOT_FOUND');
    const title = `${bookTitleFor(ctx.db, req.params.id)} ${found.track.id}`;
    const name = exportFileName(title, `dozabaneh-${req.params.id}-${found.track.id}`, found.track.format);
    return reply
      .header('Content-Type', MIME[found.track.format])
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('Content-Length', String(found.track.bytes))
      .header('Cache-Control', 'no-store')
      .send(createReadStream(found.path));
  });
}
