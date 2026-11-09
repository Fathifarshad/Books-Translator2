import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  backDesign,
  backExtrasMarkup,
  type CoverTexts,
  DEFAULT_BLEED_MM,
  DEFAULT_PAPER,
  isbnStatus,
  PAPERS,
  type Sheet,
  type SpineText,
  spineWidthMm,
  wrapSheet,
} from '@dozabaneh/cover';
import {
  BOOK_PAGE_MM,
  type CoverBlurbResult,
  type CoverBlurbTaskInput,
  type CoverDesign,
  CoverDesignSchema,
  type CoverPrint,
  CoverPrintSchema,
  type CoverPrintView,
  isProviderId,
  type ProviderId,
} from '@dozabaneh/shared';
import { getLanguage } from '@dozabaneh/text';
import { runAssistTask } from '../../assist/task';
import type { Config } from '../../config';
import { bookSubject } from '../../cover-ai/designer';
import type { Db } from '../../db/client';
import { getBookRow, getBundle } from '../../db/repo';
import { coverFontFamily, embeddedFontCss, type FontEntry, type FontRegistry, fontFaceCss } from '../../fonts/registry';
import { bookSettings, translationSettings, updateSettings } from '../../pipeline/state';
import type { ProviderService } from '../../settings/providers';
import { builtFile, savedOptions } from './build';
import { coverDesign, coverTexts, designFonts, imageFile } from './cover-design';
import { bookPdfDir } from './figures';
import { withPrinter } from './print';

/**
 * The printer's cover (ADR-048, stage 3): paper, bleed and the pages that give the spine; the back cover's blurb,
 * ISBN barcode, price and logo; the back's own design; and one sheet — back, spine, front — printed to PDF through
 * the same browser as the book. Settings live in `books.settings.coverPrint` and `.coverBack`, per language.
 */
type Deps = { db: Db; config: Pick<Config, 'dataDir'> };

const MM_TO_PX = 96 / 25.4;
/** Longest blurb asked of the engine, in characters (about 110 words of Persian). */
const MAX_BLURB = 700;

// ── Saved settings ──────────────────────────────────────────────────────────────────────────────────────────────

function allSettings(
  db: Db,
  bookId: string,
): { coverPrint?: Record<string, unknown>; coverBack?: Record<string, unknown> } {
  const row = getBookRow(db, bookId);
  return row
    ? (bookSettings(row) as { coverPrint?: Record<string, unknown>; coverBack?: Record<string, unknown> })
    : {};
}

/** The saved printer settings for a language, else the defaults (تحریر 70 g, 3 mm bleed, the book's publisher). */
export function savedPrint(db: Db, bookId: string, lang: string): CoverPrint {
  const parsed = CoverPrintSchema.safeParse(allSettings(db, bookId).coverPrint?.[lang] ?? {});
  return parsed.success ? parsed.data : CoverPrintSchema.parse({ paper: DEFAULT_PAPER, bleedMm: DEFAULT_BLEED_MM });
}

export function savedBack(db: Db, bookId: string, lang: string): CoverDesign | undefined {
  const parsed = CoverDesignSchema.safeParse(allSettings(db, bookId).coverBack?.[lang]);
  return parsed.success ? parsed.data : undefined;
}

const leafOf = (print: CoverPrint) => print.leafMm ?? PAPERS[print.paper].leaf;

/** The back cover: the saved design, else the one made from the front and the blurb. */
function backFor(
  front: CoverDesign,
  saved: CoverDesign | undefined,
  print: CoverPrint,
  texts: CoverTexts,
  rtl: boolean,
): CoverDesign {
  if (saved) return saved;
  return backDesign(front, {
    blurb: print.blurb,
    tagline: print.tagline,
    publisher: texts.publisher ?? '',
    rtl,
  });
}

export function coverPrintView(deps: Deps, bookId: string, lang: string): CoverPrintView {
  const bundle = getBundle(deps.db, bookId);
  if (!bundle) throw new Error('BOOK_NOT_FOUND');
  const view = coverDesign(deps, bookId, lang);
  const print = savedPrint(deps.db, bookId, lang);
  const saved = savedBack(deps.db, bookId, lang);
  const options = savedOptions(deps.db, bookId);
  const builtPages = builtFile(deps.config, bookId, lang)?.pages || null;
  const pages = print.pages ?? builtPages;
  const leafMm = leafOf(print);
  const spineMm = pages ? spineWidthMm(pages, leafMm) : null;
  const page = BOOK_PAGE_MM[options.pageSize];
  const margin = print.cropMarks ? print.bleedMm + 8 : 0;
  const rtl = getLanguage(lang).dir === 'rtl';
  return {
    print,
    back: backFor(view.design, saved, print, view.texts, rtl),
    backSaved: Boolean(saved),
    builtPages,
    pages,
    leafMm,
    spineMm,
    sheet:
      spineMm === null
        ? null
        : {
            width: Math.round((2 * page.width + spineMm + 2 * print.bleedMm + 2 * margin) * 10) / 10,
            height: Math.round((page.height + 2 * print.bleedMm + 2 * margin) * 10) / 10,
          },
    isbn: isbnStatus(print.isbn),
    hasBrief: Boolean(bookSubject(bundle, lang)),
  };
}

/**
 * Saves the printer settings and, when given, the back's design (`null` goes back to the one made from the front).
 * The blurb lives in two places — the setting and the back's «blurb» layer — and the one just edited wins.
 */
export function saveCoverPrint(
  deps: Deps,
  bookId: string,
  lang: string,
  print: CoverPrint,
  back?: CoverDesign | null,
): CoverPrintView {
  const keep = back === undefined ? savedBack(deps.db, bookId, lang) : back;
  let next = print;
  let design = keep ?? undefined;
  if (design) {
    const layer = design.layers.find((l) => l.kind === 'text' && l.id === 'blurb');
    if (back && layer?.kind === 'text') {
      next = { ...print, blurb: layer.text };
    } else if (layer?.kind === 'text' && layer.text !== print.blurb) {
      design = { ...design, layers: design.layers.map((l) => (l === layer ? { ...layer, text: print.blurb } : l)) };
    }
    const tag = design.layers.find((l) => l.kind === 'text' && l.id === 'tagline');
    if (tag?.kind === 'text' && !(back && layer)) {
      design = { ...design, layers: design.layers.map((l) => (l === tag ? { ...tag, text: print.tagline } : l)) };
    }
  }
  updateSettings(deps.db, bookId, (s) => {
    const settings = s as { coverPrint?: Record<string, CoverPrint>; coverBack?: Record<string, CoverDesign> };
    settings.coverPrint = { ...settings.coverPrint, [lang]: next };
    const rest = { ...settings.coverBack };
    if (design) rest[lang] = design;
    else delete rest[lang];
    settings.coverBack = rest;
  });
  return coverPrintView(deps, bookId, lang);
}

// ── The blurb ───────────────────────────────────────────────────────────────────────────────────────────────────

export type BlurbWriter = (
  input: CoverBlurbTaskInput,
  ctx: { sourceLang: string; targetLang: string; title: string; authors: string[] },
) => Promise<{ blurb: string; tagline: string }>;

function engineFor(
  db: Db,
  providers: ProviderService | undefined,
  bookId: string,
  lang: string,
): ProviderId | undefined {
  if (!providers) return undefined;
  const row = getBookRow(db, bookId);
  const candidates = [providers.assistantEngine(), row ? translationSettings(row, lang).engines.translate : undefined];
  return candidates.find((e): e is ProviderId => typeof e === 'string' && isProviderId(e) && providers.view(e).ready);
}

/** The first paragraphs of the book's brief, cut at a sentence, as a blurb when no engine can write one. */
export function blurbFromBrief(subject: string, maxChars: number): string {
  const text = subject.replace(/^Chapters:\s*/u, '').trim();
  // A list of chapter titles is not a blurb.
  if (!text || subject.startsWith('Chapters:')) return '';
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('؟ '), cut.lastIndexOf('. \n'), cut.lastIndexOf('.\n'));
  return (end > maxChars * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/u, '…')).trim();
}

/** The back cover's text: written by the book's AI engine; else cut from the book's brief. */
export async function writeBlurb(
  deps: Deps & { providers?: ProviderService | undefined; write?: BlurbWriter | undefined },
  bookId: string,
  lang: string,
  request: string,
): Promise<CoverBlurbResult> {
  const bundle = getBundle(deps.db, bookId);
  if (!bundle) throw new Error('BOOK_NOT_FOUND');
  const texts = coverTexts(bundle, lang, savedOptions(deps.db, bookId).preparer);
  const input: CoverBlurbTaskInput = {
    title: texts.title ?? '',
    original: texts.original ?? '',
    authors: texts.authors ?? '',
    subject: bookSubject(bundle, lang),
    request: request.trim(),
    maxChars: MAX_BLURB,
  };
  const ctx = {
    sourceLang: bundle.book.sourceLang,
    targetLang: lang,
    title: input.title,
    authors: bundle.book.authors,
  };
  const engine = engineFor(deps.db, deps.providers, bookId, lang);
  const ask: BlurbWriter | undefined =
    deps.write ??
    (engine && deps.providers
      ? async (i, c) => {
          const out = await runAssistTask(
            deps.providers as ProviderService,
            engine,
            'cover_blurb',
            { sourceLang: c.sourceLang, targetLang: c.targetLang, book: { title: c.title, authors: c.authors } },
            i,
            60_000,
          );
          return { blurb: out.blurb, tagline: out.tagline };
        }
      : undefined);
  let message: string | undefined;
  if (ask) {
    try {
      const out = await ask(input, ctx);
      return { blurb: out.blurb.trim(), tagline: out.tagline.trim(), source: 'ai' };
    } catch (err) {
      message = `AI_FAILED: ${String((err as Error).message).slice(0, 200)}`;
    }
  }
  const fallback = blurbFromBrief(input.subject, MAX_BLURB);
  return fallback
    ? { blurb: fallback, tagline: '', source: 'brief', ...(message ? { message } : {}) }
    : { blurb: '', tagline: '', source: 'none', ...(message ? { message } : {}) };
}

// ── The sheet ───────────────────────────────────────────────────────────────────────────────────────────────────

export class PagesUnknownError extends Error {
  constructor() {
    super('PAGES_UNKNOWN');
  }
}

/** Fonts the sheet uses: the front's and the back's, the spine's and the price's (Vazirmatn for the rest). */
function sheetFonts(all: FontEntry[], front: CoverDesign, back: CoverDesign): FontEntry[] {
  const used = new Set(['vazirmatn', ...designFonts(front), ...designFonts(back)]);
  return all.filter((f) => used.has(f.id));
}

export type SheetMode =
  /** For the printer: fonts and images embedded or beside the page. */
  | { kind: 'print'; imageSrc: (file: string) => string }
  /** For the studio's preview: fonts and images fetched from this server. */
  | { kind: 'preview'; apiPrefix: string };

export function buildSheet(deps: Deps, fonts: FontRegistry, bookId: string, lang: string, mode: SheetMode): Sheet {
  const bundle = getBundle(deps.db, bookId);
  if (!bundle) throw new Error('BOOK_NOT_FOUND');
  const view = coverPrintView(deps, bookId, lang);
  if (!view.pages || view.spineMm === null) throw new PagesUnknownError();
  const { design: front } = coverDesign(deps, bookId, lang);
  const options = savedOptions(deps.db, bookId);
  const texts = coverTexts(bundle, lang, options.preparer);
  const page = BOOK_PAGE_MM[options.pageSize];
  const rtl = getLanguage(lang).dir === 'rtl';
  const env = {
    imageUrl: (id: string) => {
      if (mode.kind === 'preview') return `${mode.apiPrefix}/books/${bookId}/cover-images/${id}`;
      const img = imageFile(deps.config, bookId, id);
      return img ? mode.imageSrc(img.file) : '';
    },
    fontFamily: coverFontFamily,
  };
  const body = view.back.layers.find((l) => l.kind === 'text' && l.visible && l.id !== 'blurb');
  const titleLayer = front.layers.find((l) => l.kind === 'text' && l.role === 'title');
  const credit = front.layers.find((l) => l.kind === 'text' && l.role === 'preparer');
  const spine: SpineText | null =
    view.print.spineText && titleLayer?.kind === 'text'
      ? {
          title: texts.title ?? '',
          author: bundle.book.authors.join('، '),
          font: titleLayer.font,
          weight: titleLayer.weight,
          color: titleLayer.color,
          accent: credit?.kind === 'text' ? credit.accent : '#c9a54a',
        }
      : null;
  const ink = titleLayer?.kind === 'text' ? titleLayer.color : '#ffffff';
  const family = coverFontFamily(body?.kind === 'text' ? body.font : 'vazirmatn');
  const extras = backExtrasMarkup(view.print, page.width, env, ink, family);
  const used = sheetFonts(fonts.all(), front, view.back);
  const css =
    mode.kind === 'print'
      ? embeddedFontCss(used)
      : fontFaceCss(used, (font, face) => `${mode.apiPrefix}/fonts/${font.id}/${encodeURIComponent(face.name)}`);
  return wrapSheet({
    front,
    back: view.back,
    page,
    spineMm: view.spineMm,
    bleedMm: view.print.bleedMm,
    cropMarks: view.print.cropMarks,
    rtl,
    spine,
    backExtras: extras,
    env,
    css,
    title: texts.title ?? '',
    lang,
    fit: mode.kind === 'preview',
  });
}

export const wrapFile = (config: Pick<Config, 'dataDir'>, bookId: string, lang: string) =>
  join(bookPdfDir(config, bookId), `cover-wrap-${lang}.pdf`);

/** Prints the sheet to one PDF page of exactly the sheet's size and keeps it beside the book. */
export async function printWrapPdf(
  deps: Deps,
  fonts: FontRegistry,
  bookId: string,
  lang: string,
): Promise<{ file: string; sheet: { width: number; height: number } }> {
  const dir = bookPdfDir(deps.config, bookId);
  mkdirSync(dir, { recursive: true });
  const sheet = buildSheet(deps, fonts, bookId, lang, {
    kind: 'print',
    imageSrc: (file) => file.slice(dir.length + 1).replace(/\\/g, '/'),
  });
  const htmlFile = join(dir, `cover-wrap-${lang}.html`);
  writeFileSync(htmlFile, sheet.html);
  const pdf = await withPrinter(sheet.widthMm * MM_TO_PX, (print) => print(htmlFile));
  const file = wrapFile(deps.config, bookId, lang);
  writeFileSync(file, pdf);
  return { file, sheet: { width: sheet.widthMm, height: sheet.heightMm } };
}
