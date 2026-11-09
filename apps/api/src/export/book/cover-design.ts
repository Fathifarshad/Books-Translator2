import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backDesign, type CoverTexts, coverMarkup, defaultDesign, preparerText, THEMES } from '@dozabaneh/cover';
import {
  type BookBundle,
  type CoverDesign,
  CoverDesignSchema,
  type CoverDesignView,
  type CoverImage,
  type CoverTemplate,
  CoverTemplateSchema,
  type Preparer,
} from '@dozabaneh/shared';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import { getBookRow, getBundle } from '../../db/repo';
import { coverFontFamily, embeddedFontCss, type FontRegistry } from '../../fonts/registry';
import { bookSettings, updateSettings } from '../../pipeline/state';
import { getSetting, setSetting } from '../../settings/store';
import { type BookStrings, bookStrings, fill } from '../strings';
import { COVER_TYPES, coverFile, savedOptions, saveOptions } from './build';
import { bookPdfDir } from './figures';

/**
 * «استودیوی جلد» on the server (ADR-048): a design per book and language (in the book's settings), the book's own
 * cover images (uploaded now, drawn by AI in stage 2), templates kept for later books, and the cover printed into
 * the book — the same markup the editor shows, with the fonts it uses embedded.
 */
type Deps = { db: Db; config: Pick<Config, 'dataDir'> };

// ── Texts ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function coverTexts(
  bundle: BookBundle,
  lang: string,
  preparer: Preparer,
  strings: BookStrings = bookStrings(),
): CoverTexts {
  const src = bundle.book.sourceLang;
  const title = bundle.book.titles[lang] ?? bundle.book.titles[src] ?? '';
  const original = bundle.book.titles[src] ?? '';
  return {
    title,
    original: original && original !== title ? original : '',
    authors: bundle.book.authors.length ? fill(strings.by, { authors: bundle.book.authors.join('، ') }) : '',
    preparer: preparerText(preparer, strings.defaultRole),
    publisher: bundle.book.publisher ?? '',
  };
}

// ── Images ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ImageIndexSchema = z.array(
  z.object({
    id: z.string(),
    ext: z.enum(['jpg', 'png', 'webp']),
    source: z.enum(['upload', 'ai']),
    createdAt: z.string(),
    prompt: z.string().optional(),
  }),
);
type ImageRecord = z.infer<typeof ImageIndexSchema>[number];

const imagesDir = (config: Deps['config'], bookId: string) => join(bookPdfDir(config, bookId), 'cover-images');

function readIndex(config: Deps['config'], bookId: string): ImageRecord[] {
  try {
    return ImageIndexSchema.parse(JSON.parse(readFileSync(join(imagesDir(config, bookId), 'index.json'), 'utf8')));
  } catch {
    return [];
  }
}

function writeIndex(config: Deps['config'], bookId: string, list: ImageRecord[]): void {
  mkdirSync(imagesDir(config, bookId), { recursive: true });
  writeFileSync(join(imagesDir(config, bookId), 'index.json'), JSON.stringify(list, null, 1));
}

const view = ({ ext: _ext, ...r }: ImageRecord): CoverImage => r;

export function listImages(config: Deps['config'], bookId: string): CoverImage[] {
  return readIndex(config, bookId).map(view);
}

export function imageFile(
  config: Deps['config'],
  bookId: string,
  id: string,
): { file: string; mime: string } | undefined {
  const r = readIndex(config, bookId).find((i) => i.id === id);
  if (!r) return undefined;
  const file = join(imagesDir(config, bookId), `${r.id}.${r.ext}`);
  const mime = Object.entries(COVER_TYPES).find(([, e]) => e === r.ext)?.[0] ?? 'application/octet-stream';
  return existsSync(file) ? { file, mime } : undefined;
}

export function addImage(
  config: Deps['config'],
  bookId: string,
  data: Buffer,
  mime: string,
  meta: { source: 'upload' | 'ai'; prompt?: string; now?: Date },
): CoverImage {
  const ext = COVER_TYPES[mime] as ImageRecord['ext'] | undefined;
  if (!ext) throw new Error('unsupported image type');
  const record: ImageRecord = {
    id: `img-${ulid().toLowerCase()}`,
    ext,
    source: meta.source,
    createdAt: (meta.now ?? new Date()).toISOString(),
    ...(meta.prompt ? { prompt: meta.prompt } : {}),
  };
  mkdirSync(imagesDir(config, bookId), { recursive: true });
  writeFileSync(join(imagesDir(config, bookId), `${record.id}.${ext}`), data);
  writeIndex(config, bookId, [record, ...readIndex(config, bookId)]);
  return view(record);
}

export function removeImage(config: Deps['config'], bookId: string, id: string): boolean {
  const list = readIndex(config, bookId);
  const r = list.find((i) => i.id === id);
  if (!r) return false;
  rmSync(join(imagesDir(config, bookId), `${r.id}.${r.ext}`), { force: true });
  writeIndex(
    config,
    bookId,
    list.filter((i) => i.id !== id),
  );
  return true;
}

/** The cover image uploaded on the «کتاب PDF» page becomes one of the studio's images (once). */
function importLegacyCover(config: Deps['config'], bookId: string): string | undefined {
  const legacy = coverFile(config, bookId);
  if (!legacy) return undefined;
  const ext = legacy.split('.').pop() as ImageRecord['ext'];
  const list = readIndex(config, bookId);
  const done = list.find((i) => i.prompt === '#legacy');
  if (done) return done.id;
  const record: ImageRecord = {
    id: `img-${ulid().toLowerCase()}`,
    ext,
    source: 'upload',
    createdAt: new Date().toISOString(),
    prompt: '#legacy',
  };
  mkdirSync(imagesDir(config, bookId), { recursive: true });
  copyFileSync(legacy, join(imagesDir(config, bookId), `${record.id}.${ext}`));
  writeIndex(config, bookId, [record, ...list]);
  return record.id;
}

// ── The design ──────────────────────────────────────────────────────────────────────────────────────────────────

function savedDesign(db: Db, bookId: string, lang: string): CoverDesign | undefined {
  const row = getBookRow(db, bookId);
  const all = row ? (bookSettings(row) as { coverDesign?: Record<string, unknown> }).coverDesign : undefined;
  const parsed = CoverDesignSchema.safeParse(all?.[lang]);
  return parsed.success ? parsed.data : undefined;
}

/** The book's design in this language: the saved one, or the classic cover of its last «کتاب PDF» options. */
export function coverDesign(deps: Deps, bookId: string, lang: string): CoverDesignView {
  const bundle = getBundle(deps.db, bookId);
  if (!bundle) throw new Error('BOOK_NOT_FOUND');
  const options = savedOptions(deps.db, bookId);
  const texts = coverTexts(bundle, lang, options.preparer);
  const saved = savedDesign(deps.db, bookId, lang);
  if (saved) return { design: saved, saved: true, texts, images: listImages(deps.config, bookId) };
  let design = defaultDesign(texts, THEMES[options.theme]);
  if (options.cover === 'uploaded') {
    const image = importLegacyCover(deps.config, bookId);
    if (image) {
      design = {
        ...design,
        background: {
          ...design.background,
          kind: 'image',
          image,
          pattern: 'none',
          frame: 'none',
          dim: 0.6,
          dimMode: 'bottom',
        },
        layers: design.layers
          .filter((l) => l.kind === 'text')
          .map((l) => (l.id === 'title' ? { ...l, y: 78 } : l.id === 'preparer' ? { ...l, y: 89 } : l)),
      };
    }
  }
  return { design, saved: false, texts, images: listImages(deps.config, bookId) };
}

/** Saves the design; the book's next «کتاب PDF» uses it as its cover. */
export function saveCoverDesign(deps: Deps, bookId: string, lang: string, design: CoverDesign): CoverDesignView {
  updateSettings(deps.db, bookId, (s) => {
    const settings = s as { coverDesign?: Record<string, CoverDesign> };
    settings.coverDesign = { ...settings.coverDesign, [lang]: design };
  });
  const options = savedOptions(deps.db, bookId);
  if (options.cover !== 'designed') saveOptions(deps.db, bookId, { ...options, cover: 'designed' });
  return coverDesign(deps, bookId, lang);
}

export function resetCoverDesign(deps: Deps, bookId: string, lang: string): CoverDesignView {
  updateSettings(deps.db, bookId, (s) => {
    const all = (s as { coverDesign?: Record<string, CoverDesign> }).coverDesign;
    if (all) delete all[lang];
  });
  return coverDesign(deps, bookId, lang);
}

/** Fonts a design uses (shapes use none). */
export function designFonts(design: CoverDesign): string[] {
  return [...new Set(design.layers.flatMap((l) => (l.kind === 'text' && l.visible ? [l.font] : [])))];
}

/**
 * The front and back cover for the printed book: markup, the `@font-face` rules of its fonts with the files inside,
 * and images referred to as files beside the page (`imageSrc`).
 */
export function printedCover(
  deps: Deps,
  fonts: FontRegistry,
  bookId: string,
  lang: string,
  imageSrc: (file: string) => string,
): { front: string; back: string; css: string } {
  const { design } = coverDesign(deps, bookId, lang);
  const env = {
    imageUrl: (id: string) => {
      const img = imageFile(deps.config, bookId, id);
      return img ? imageSrc(img.file) : '';
    },
    fontFamily: coverFontFamily,
  };
  const used = new Set(['vazirmatn', ...designFonts(design)]);
  const css = embeddedFontCss(fonts.all().filter((f) => used.has(f.id)));
  return {
    front: coverMarkup(design, env, { uid: 'front' }),
    back: coverMarkup(backDesign(design), env, { uid: 'back' }),
    css,
  };
}

// ── Templates ───────────────────────────────────────────────────────────────────────────────────────────────────

const TEMPLATES_KEY = 'cover:templates';
const MAX_TEMPLATES = 60;

export function listTemplates(db: Db): CoverTemplate[] {
  const raw = getSetting<unknown[]>(db, TEMPLATES_KEY) ?? [];
  return raw.flatMap((t) => {
    const p = CoverTemplateSchema.safeParse(t);
    return p.success ? [p.data] : [];
  });
}

export function addTemplate(db: Db, name: string, design: CoverDesign, now = new Date()): CoverTemplate {
  const template: CoverTemplate = { id: `tpl-${ulid().toLowerCase()}`, name, createdAt: now.toISOString(), design };
  setSetting(db, TEMPLATES_KEY, [template, ...listTemplates(db)].slice(0, MAX_TEMPLATES));
  return template;
}

export function removeTemplate(db: Db, id: string): boolean {
  const list = listTemplates(db);
  if (!list.some((t) => t.id === id)) return false;
  setSetting(
    db,
    TEMPLATES_KEY,
    list.filter((t) => t.id !== id),
  );
  return true;
}
