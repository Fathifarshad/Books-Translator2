import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { basicConcepts, type CoverTexts, conceptToDesign, LAYOUTS, paintPrompt } from '@dozabaneh/cover';
import {
  type BookBundle,
  type CoverAiOption,
  type CoverAiStatus,
  type CoverConcept,
  type CoverDesignTaskInput,
  isProviderId,
  type ProviderId,
} from '@dozabaneh/shared';
import { ulid } from 'ulid';
import { runAssistTask } from '../assist/task';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { getBookRow, getBundle } from '../db/repo';
import { savedOptions } from '../export/book/build';
import { addImage, coverTexts } from '../export/book/cover-design';
import { bookPdfDir } from '../export/book/figures';
import type { FontRegistry } from '../fonts/registry';
import { translationSettings } from '../pipeline/state';
import type { ProviderService } from '../settings/providers';
import { PainterError, type PainterService } from './painter';
import { type BasicDesignerWords, basicDesignerWords } from './words';

/**
 * A round of «طراحی خودکار جلد» (ADR-048, stage 2): the art director proposes concepts (the book's AI engine through
 * the shared `cover_design` task; the app's own designer when no engine is connected or it fails), each becomes an
 * editable design at once, then the illustrator draws the pictures one by one and each design takes its picture.
 * The round is kept on disk, so the cards are still there after a restart; a round runs in the server, not in a job,
 * because the owner waits for it on the page.
 */
export type DesignConcepts = (
  input: CoverDesignTaskInput,
  ctx: { sourceLang: string; targetLang: string; title: string; authors: string[] },
) => Promise<CoverConcept[]>;

export interface CoverAiDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
  fonts: FontRegistry;
  painter: PainterService;
  providers?: ProviderService | undefined;
  /** Tests inject the art director; otherwise the book's engine is asked. */
  design?: DesignConcepts | undefined;
  words?: () => BasicDesignerWords;
}

const file = (config: Pick<Config, 'dataDir'>, bookId: string, lang: string) =>
  join(bookPdfDir(config, bookId), `cover-ai-${lang}.json`);

/** What the art director knows of the book: its brief, else its chapter titles. */
export function bookSubject(bundle: BookBundle, lang: string): string {
  const brief = bundle.book.brief?.[lang] ?? bundle.book.brief?.[bundle.book.sourceLang];
  if (brief) return brief.slice(0, 1800);
  const heading = new Map(bundle.segments.map((s) => [s.id, s.src]));
  const titles = bundle.nodes
    .filter((n) => n.depth <= 1 && !n.skip)
    .sort((a, b) => a.ord - b.ord)
    .map((n) => n.title ?? (n.headingSegmentId ? heading.get(n.headingSegmentId) : undefined))
    .filter((t): t is string => Boolean(t?.trim()))
    .slice(0, 25);
  return titles.length ? `Chapters: ${titles.join(' · ')}` : '';
}

export class CoverAiService {
  private readonly runs = new Map<string, CoverAiStatus>();
  private readonly rounds = new Map<string, number>();
  constructor(private readonly deps: CoverAiDeps) {}

  private key = (bookId: string, lang: string) => `${bookId}|${lang}`;

  status(bookId: string, lang: string): CoverAiStatus {
    const live = this.runs.get(this.key(bookId, lang));
    if (live) return live;
    try {
      const saved = JSON.parse(readFileSync(file(this.deps.config, bookId, lang), 'utf8')) as CoverAiStatus;
      // A round cut short by a restart: its pictures will not come.
      const options = saved.options.map((o) =>
        o.image === 'pending' ? { ...o, image: 'failed' as const, imageError: 'INTERRUPTED' } : o,
      );
      const state = saved.state === 'designing' || saved.state === 'painting' ? 'done' : saved.state;
      return { ...saved, state, options, painter: this.painterName() };
    } catch {
      return { state: 'idle', painter: this.painterName(), options: [] };
    }
  }

  private painterName() {
    return this.deps.painter.ready()[0] ?? 'none';
  }

  private save(bookId: string, lang: string, s: CoverAiStatus): void {
    this.runs.set(this.key(bookId, lang), s);
    mkdirSync(bookPdfDir(this.deps.config, bookId), { recursive: true });
    writeFileSync(file(this.deps.config, bookId, lang), JSON.stringify(s));
  }

  /** Starts a round (or returns the one running). `done` resolves when it ends — for tests. */
  start(
    bookId: string,
    lang: string,
    req: { request: string; count: number },
  ): { status: CoverAiStatus; done: Promise<void> } {
    const current = this.runs.get(this.key(bookId, lang));
    if (current && (current.state === 'designing' || current.state === 'painting')) {
      return { status: current, done: Promise.resolve() };
    }
    const status: CoverAiStatus = {
      state: 'designing',
      painter: this.painterName(),
      options: [],
      startedAt: new Date().toISOString(),
    };
    const previous = this.status(bookId, lang).options.map((o) => o.concept.name);
    this.save(bookId, lang, status);
    const done = this.run(bookId, lang, req, previous).catch((err) => {
      this.save(bookId, lang, {
        ...this.status(bookId, lang),
        state: 'failed',
        error: /^[A-Z_]+$/.test((err as Error).message) ? (err as Error).message : 'DESIGN_FAILED',
        message: String((err as Error).message).slice(0, 300),
      });
    });
    return { status, done };
  }

  /** Draws the picture of one option again (a new seed). */
  repaint(bookId: string, lang: string, optionId: string): { status: CoverAiStatus; done: Promise<void> } {
    const s = this.status(bookId, lang);
    const option = s.options.find((o) => o.id === optionId);
    if (!option || s.state === 'designing' || s.state === 'painting') return { status: s, done: Promise.resolve() };
    const texts = this.texts(bookId, lang);
    const next: CoverAiStatus = {
      ...s,
      state: 'painting',
      options: s.options.map((o) => (o.id === optionId ? { ...o, image: 'pending' as const } : o)),
    };
    this.save(bookId, lang, next);
    const done = this.paintAll(bookId, lang, next, texts);
    return { status: next, done };
  }

  private texts(bookId: string, lang: string): CoverTexts {
    const bundle = getBundle(this.deps.db, bookId);
    if (!bundle) throw new Error('BOOK_NOT_FOUND');
    return coverTexts(bundle, lang, savedOptions(this.deps.db, bookId).preparer);
  }

  private async run(
    bookId: string,
    lang: string,
    req: { request: string; count: number },
    avoid: string[],
  ): Promise<void> {
    const bundle = getBundle(this.deps.db, bookId);
    if (!bundle) throw new Error('BOOK_NOT_FOUND');
    const texts = this.texts(bookId, lang);
    const canPaint = this.deps.painter.ready().length > 0;
    const fonts = this.deps.fonts.list().slice(0, 150);
    const input: CoverDesignTaskInput = {
      title: texts.title ?? '',
      original: texts.original ?? '',
      authors: texts.authors ?? '',
      subject: bookSubject(bundle, lang),
      request: req.request,
      count: req.count,
      layouts: LAYOUTS.map((l) => ({ id: l.id, description: l.description })),
      fonts: fonts.map((f) => ({ id: f.id, family: f.family, category: f.category })),
      avoid: avoid.slice(0, 30),
      canPaint,
    };

    let concepts: CoverConcept[] | undefined;
    let designer = 'basic';
    let message: string | undefined;
    const engine = this.engine(bookId, lang);
    const ask = this.deps.design ?? (engine ? this.askEngine(engine) : undefined);
    if (ask) {
      try {
        concepts = (
          await ask(input, {
            sourceLang: bundle.book.sourceLang,
            targetLang: lang,
            title: input.title,
            authors: bundle.book.authors,
          })
        )
          .filter((c) => fonts.some((f) => f.id === c.titleFont))
          .slice(0, req.count);
        designer = engine ?? 'ai';
      } catch (err) {
        message = `AI_FAILED: ${String((err as Error).message).slice(0, 200)}`;
      }
    }
    if (!concepts?.length) {
      const round = this.rounds.get(this.key(bookId, lang)) ?? 0;
      this.rounds.set(this.key(bookId, lang), round + 1);
      const titleFonts = ['estedad', 'lalezar', 'noto-kufi', 'reem-kufi', 'markazi'].filter((id) =>
        fonts.some((f) => f.id === id),
      );
      concepts = basicConcepts(
        (this.deps.words ?? basicDesignerWords)(),
        { title: titleFonts, body: 'vazirmatn' },
        req.count,
        round,
      );
      designer = 'basic';
    }

    const options: CoverAiOption[] = concepts.map((concept) => ({
      id: `opt-${ulid().toLowerCase()}`,
      concept,
      design: conceptToDesign(concept, texts),
      image: concept.ground === 'image' && canPaint && concept.imagePrompt.trim() ? 'pending' : 'none',
    }));
    const status: CoverAiStatus = {
      state: options.some((o) => o.image === 'pending') ? 'painting' : 'done',
      designer,
      painter: this.painterName(),
      options,
      startedAt: this.runs.get(this.key(bookId, lang))?.startedAt ?? new Date().toISOString(),
      ...(message ? { message } : {}),
    };
    this.save(bookId, lang, status);
    await this.paintAll(bookId, lang, status, texts);
  }

  /** Draws every pending picture in turn; each design takes its picture as soon as it is drawn. */
  private async paintAll(bookId: string, lang: string, start: CoverAiStatus, texts: CoverTexts): Promise<void> {
    let s = start;
    for (const option of start.options.filter((o) => o.image === 'pending')) {
      let patch: Partial<CoverAiOption>;
      try {
        const painting = await this.deps.painter.paint(paintPrompt(option.concept));
        const image = addImage(this.deps.config, bookId, painting.data, painting.mime, {
          source: 'ai',
          prompt: option.concept.imagePrompt,
        });
        patch = { image: 'done', design: conceptToDesign(option.concept, texts, image.id) };
      } catch (err) {
        patch = { image: 'failed', imageError: err instanceof PainterError ? err.code : 'PAINT_FAILED' };
      }
      s = { ...s, options: s.options.map((o) => (o.id === option.id ? { ...o, ...patch } : o)) };
      this.save(bookId, lang, s);
    }
    this.save(bookId, lang, { ...s, state: 'done' });
  }

  /** The assistant engine when it is a connected provider, else the book's translation engine. */
  private engine(bookId: string, lang: string): ProviderId | undefined {
    const providers = this.deps.providers;
    if (!providers) return undefined;
    const row = getBookRow(this.deps.db, bookId);
    const candidates = [
      providers.assistantEngine(),
      row ? translationSettings(row, lang).engines.translate : undefined,
    ];
    return candidates.find((e): e is ProviderId => typeof e === 'string' && isProviderId(e) && providers.view(e).ready);
  }

  private askEngine(engine: ProviderId): DesignConcepts {
    const providers = this.deps.providers as ProviderService;
    return async (input, ctx) => {
      const out = await runAssistTask(
        providers,
        engine,
        'cover_design',
        { sourceLang: ctx.sourceLang, targetLang: ctx.targetLang, book: { title: ctx.title, authors: ctx.authors } },
        input,
        60_000,
      );
      return out.concepts;
    };
  }
}
