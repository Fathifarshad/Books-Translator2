import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { outlinePages } from '@dozabaneh/pdf';
import {
  BOOK_PAGE_MM,
  type BookBundle,
  type BookPdfFile,
  type BookPdfOptions,
  BookPdfOptionsSchema,
  type BookPdfStep,
  isProviderId,
  type Preparer,
  PreparerSchema,
} from '@dozabaneh/shared';
import { getLanguage, isEditOnly } from '@dozabaneh/text';
import { runAssistTask } from '../../assist/task';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import { getBookRow, getBundle } from '../../db/repo';
import { approvedTerms, glossarySubset, toEntry } from '../../pipeline/batches';
import { bookSettings, translationSettings, updateSettings } from '../../pipeline/state';
import type { ProviderService } from '../../settings/providers';
import { getSetting, setSetting } from '../../settings/store';
import { bookDocument } from '../document';
import { bookStrings } from '../strings';
import { type BookFigure, bookFigures, bookPdfDir, LabelCache, type TranslateTexts, translateLabels } from './figures';
import { buildBookHtml, headingIds } from './html';
import { brokenTitles, layoutBook } from './layout';
import { withPrinter } from './print';

/**
 * «کتاب PDF» end to end (ADR-046): figures cut out of the original, their labels translated, the book laid out,
 * printed twice (the second time with the page numbers the first print revealed) and kept on disk until the next
 * build. Runs as a job; each step reports progress.
 */
export interface BookPdfDeps {
  db: Db;
  config: Pick<Config, 'dataDir'>;
  providers?: ProviderService | undefined;
  /** Tests inject the translator; otherwise the book's translation engine is asked. */
  translate?: TranslateTexts | undefined;
}

export type ProgressFn = (step: BookPdfStep, done: number, total: number, fraction: number) => void;

const PREPARER_KEY = 'book:preparer';

/** The preparer last printed on a book: the next book starts with it. */
export function lastPreparer(db: Db): Preparer {
  return PreparerSchema.parse(getSetting<Preparer>(db, PREPARER_KEY) ?? {});
}

/** Options of the book's last build, or the defaults with the last preparer. */
export function savedOptions(db: Db, bookId: string): BookPdfOptions {
  const row = getBookRow(db, bookId);
  const saved = row ? (bookSettings(row) as { bookPdf?: unknown }).bookPdf : undefined;
  const parsed = BookPdfOptionsSchema.safeParse(saved ?? {});
  const options = parsed.success ? parsed.data : BookPdfOptionsSchema.parse({});
  return options.preparer.name ? options : { ...options, preparer: lastPreparer(db) };
}

export function saveOptions(db: Db, bookId: string, options: BookPdfOptions): void {
  updateSettings(db, bookId, (s) => {
    (s as { bookPdf?: BookPdfOptions }).bookPdf = options;
  });
  if (options.preparer.name) setSetting(db, PREPARER_KEY, options.preparer);
}

export const outputFile = (config: Pick<Config, 'dataDir'>, bookId: string, lang: string) =>
  join(bookPdfDir(config, bookId), `book-${lang}.pdf`);
const metaFile = (config: Pick<Config, 'dataDir'>, bookId: string, lang: string) =>
  join(bookPdfDir(config, bookId), `book-${lang}.json`);

export function builtFile(config: Pick<Config, 'dataDir'>, bookId: string, lang: string): BookPdfFile | undefined {
  const file = outputFile(config, bookId, lang);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(metaFile(config, bookId, lang), 'utf8')) as BookPdfFile;
  } catch {
    return {
      bytes: statSync(file).size,
      pages: 0,
      builtAt: statSync(file).mtime.toISOString(),
      figures: 0,
      translatedFigures: 0,
    };
  }
}

// ── The cover image ────────────────────────────────────────────────────────────────────────────────────────────

export const COVER_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function coverFile(config: Pick<Config, 'dataDir'>, bookId: string): string | undefined {
  const dir = bookPdfDir(config, bookId);
  if (!existsSync(dir)) return undefined;
  const name = readdirSync(dir).find((f) => /^cover\.(jpg|png|webp)$/.test(f));
  return name ? join(dir, name) : undefined;
}

export function saveCover(config: Pick<Config, 'dataDir'>, bookId: string, data: Buffer, mime: string): void {
  const ext = COVER_TYPES[mime];
  if (!ext) throw new Error('unsupported image type');
  removeCover(config, bookId);
  const dir = bookPdfDir(config, bookId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `cover.${ext}`), data);
}

export function removeCover(config: Pick<Config, 'dataDir'>, bookId: string): void {
  const file = coverFile(config, bookId);
  if (file) rmSync(file, { force: true });
}

// ── Translation of labels and broken titles ─────────────────────────────────────────────────────────────────────

/** The book's translation engine (else the assistant's), asked through the shared `translate` task and prompt. */
function engineTranslator(deps: BookPdfDeps, bundle: BookBundle, lang: string): TranslateTexts | undefined {
  if (deps.translate) return deps.translate;
  const providers = deps.providers;
  const row = getBookRow(deps.db, bundle.book.id);
  if (!providers || !row) return undefined;
  const engines = [translationSettings(row, lang).engines.translate, providers.assistantEngine()];
  const engine = engines.find((e): e is NonNullable<typeof e> & string => typeof e === 'string' && isProviderId(e));
  if (!engine || !isProviderId(engine)) return undefined;
  const terms = approvedTerms(bundle, lang);
  const src = bundle.book.sourceLang;
  return async (items, context) => {
    const out = await runAssistTask(
      providers,
      engine,
      'translate',
      {
        sourceLang: src,
        targetLang: lang,
        book: { title: bundle.book.titles[lang] ?? bundle.book.titles[src] ?? '', authors: bundle.book.authors },
      },
      {
        // A label has no room for «(original term)».
        glossary: glossarySubset(
          terms,
          items.map((i) => i.src),
          src,
        ).map((g) => ({ ...toEntry(g), parenthetical: 'never' as const })),
        alreadyIntroduced: [],
        context: {
          previous: context.captions ?? [],
          next: [],
        },
        items,
      },
      65_000,
    );
    return new Map(out.items.map((i) => [i.key, i.tgt]));
  };
}

/**
 * Page of each heading id: the outline lists the page's headings in document order, so ids and entries pair up one
 * to one. Should the browser have left one out, nothing is guessed — those entries keep no number.
 */
export function headingPages(ids: string[], entries: { title: string; page: number }[]): Map<string, number> {
  const pages = new Map<string, number>();
  if (ids.length !== entries.length) return pages;
  ids.forEach((id, i) => {
    const page = entries[i]?.page;
    if (page) pages.set(id, page);
  });
  return pages;
}

// ── The build ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Share of the whole build each step takes, for one progress bar. */
const SPAN: Record<BookPdfStep, [number, number]> = {
  figures: [0, 0.35],
  labels: [0.35, 0.6],
  layout: [0.6, 0.65],
  print: [0.65, 1],
};

const MM_TO_PX = 96 / 25.4;
const SIDE_MARGIN_MM = { a4: 18, vaziri: 15, roqee: 13 } as const;

export async function buildBookPdf(
  deps: BookPdfDeps,
  job: { bookId: string; lang: string; options: BookPdfOptions; onProgress?: ProgressFn; now?: Date },
): Promise<BookPdfFile> {
  const { db, config } = deps;
  const { bookId, lang, options } = job;
  const report = (step: BookPdfStep, done: number, total: number) => {
    const [a, b] = SPAN[step];
    job.onProgress?.(step, done, total, a + (b - a) * (total ? Math.min(1, done / total) : 0));
  };
  const bundle = getBundle(db, bookId);
  const row = getBookRow(db, bookId);
  if (!bundle || !row) throw new Error('BOOK_NOT_FOUND');
  const editOnly = isEditOnly(bundle.book.sourceLang, lang);
  const rtl = getLanguage(lang).dir === 'rtl';
  const dir = bookPdfDir(config, bookId);
  mkdirSync(dir, { recursive: true });

  // 1. Figures, cut out of the original PDF.
  report('figures', 0, 1);
  let figures: BookFigure[] = [];
  if (options.figures) {
    figures = await bookFigures(
      { db, config },
      { id: bookId, sourceLang: bundle.book.sourceLang, filePath: row.filePath, fileSha256: row.fileSha256 },
      { keepText: editOnly, mirror: rtl && !editOnly, onPage: (d, t) => report('figures', d, t) },
    );
  }
  report('figures', 1, 1);

  // 2. Their labels — and chapter titles printed in pieces — in the target language.
  const doc = bookDocument(bundle, lang, job.now);
  const titles = new Map<string, string>();
  const translator = editOnly ? undefined : engineTranslator(deps, bundle, lang);
  const cache = new LabelCache(config, bookId, lang);
  let translatedFigures = 0;
  if (!editOnly) {
    const captionTgt = new Map(doc.sections.flatMap((s) => s.rows.map((r) => [r.id ?? '', r.tgt] as const)));
    const result = await translateLabels(figures, {
      lang,
      cache,
      translate: translator,
      captionOf: (f) => f.captionIds.map((id) => captionTgt.get(id) ?? '').join(' ') || undefined,
      onProgress: (d, t) => report('labels', d, t),
    });
    translatedFigures = result.translated;
    const broken = brokenTitles(doc);
    const todo = broken.filter((s) => cache.get(`#h ${s}`) === undefined);
    if (todo.length && translator) {
      try {
        const out = await translator(
          todo.map((src, i) => ({ key: `h${i + 1}`, type: 'h' as const, src })),
          {},
        );
        todo.forEach((src, i) => {
          const tgt = out.get(`h${i + 1}`);
          if (tgt?.trim()) cache.set(`#h ${src}`, tgt.trim());
        });
        cache.save();
      } catch {
        // The pieces' own translations are joined instead.
      }
    }
    for (const src of broken) {
      const tgt = cache.get(`#h ${src}`);
      if (tgt) titles.set(src, tgt);
    }
  }
  report('labels', 1, 1);

  // 3. Layout.
  report('layout', 0, 1);
  const layout = layoutBook(doc, figures, { mode: options.mode, titles });
  const strings = bookStrings();
  const cover = options.cover === 'uploaded' ? coverFile(config, bookId) : undefined;
  const html = (pages?: Map<string, number>) =>
    buildBookHtml({
      doc,
      book: { publisher: bundle.book.publisher, year: bundle.book.year },
      layout,
      options: cover || options.cover !== 'uploaded' ? options : { ...options, cover: 'generated' },
      strings,
      figureSrc: (f) => `figures/${f.file}`,
      coverImage: cover ? cover.slice(dir.length + 1).replace(/\\/g, '/') : undefined,
      editOnly,
      pages,
    });
  report('layout', 1, 1);

  // 4. Print twice: the first print tells on which page every heading and figure landed.
  const htmlFile = join(dir, `book-${lang}.html`);
  const width = (BOOK_PAGE_MM[options.pageSize].width - 2 * SIDE_MARGIN_MM[options.pageSize]) * MM_TO_PX;
  const pdf = await withPrinter(width, async (print) => {
    report('print', 0, 2);
    const firstHtml = html();
    writeFileSync(htmlFile, firstHtml);
    const first = await print(htmlFile);
    const outline = (await outlinePages(first)).entries;
    const pages = headingPages(headingIds(firstHtml), outline);
    report('print', 1, 2);
    writeFileSync(htmlFile, html(pages));
    const second = await print(htmlFile);
    report('print', 2, 2);
    return second;
  });

  const out = outputFile(config, bookId, lang);
  writeFileSync(out, pdf);
  const { pages } = await outlinePages(pdf);
  const file: BookPdfFile = {
    bytes: pdf.byteLength,
    pages,
    builtAt: (job.now ?? new Date()).toISOString(),
    figures: layout.figures.length,
    translatedFigures,
  };
  writeFileSync(metaFile(config, bookId, lang), JSON.stringify(file));
  return file;
}
