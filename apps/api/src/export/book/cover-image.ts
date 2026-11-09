import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { coverImagePage, type ImageFormat, type ImagePreset, mockupPage } from '@dozabaneh/cover';
import { BOOK_PAGE_MM } from '@dozabaneh/shared';
import { getLanguage } from '@dozabaneh/text';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import { getBundle } from '../../db/repo';
import { coverFontFamily, embeddedFontCss, type FontRegistry } from '../../fonts/registry';
import { savedOptions } from './build';
import { coverDesign, coverTexts, designFonts, imageFile } from './cover-design';
import { coverPrintView, spineTextFor } from './cover-print';
import { bookPdfDir } from './figures';
import { takePicture } from './print';

/**
 * Pictures of the front cover for shops and social media (ADR-048, stage 4): the design as the printed book has it,
 * photographed at the preset's size by the same browser that prints the book.
 */
type Deps = { db: Db; config: Pick<Config, 'dataDir'> };

export async function renderCoverImage(
  deps: Deps,
  fonts: FontRegistry,
  bookId: string,
  lang: string,
  preset: ImagePreset,
  format: ImageFormat,
): Promise<{ bytes: Uint8Array; width: number; height: number; mime: string }> {
  const bundle = getBundle(deps.db, bookId);
  if (!bundle) throw new Error('BOOK_NOT_FOUND');
  const dir = bookPdfDir(deps.config, bookId);
  mkdirSync(dir, { recursive: true });
  const { design } = coverDesign(deps, bookId, lang);
  const options = savedOptions(deps.db, bookId);
  const texts = coverTexts(bundle, lang, options.preparer);
  const env = {
    imageUrl: (id: string) => {
      const img = imageFile(deps.config, bookId, id);
      return img ? img.file.slice(dir.length + 1).replace(/\\/g, '/') : '';
    },
    fontFamily: coverFontFamily,
  };
  const used = new Set(['vazirmatn', ...designFonts(design)]);
  const { html, size } = coverImagePage({
    front: design,
    preset,
    page: BOOK_PAGE_MM[options.pageSize],
    env,
    css: embeddedFontCss(fonts.all().filter((f) => used.has(f.id))),
    title: texts.title ?? '',
    lang,
  });
  const htmlFile = join(dir, `cover-image-${lang}.html`);
  writeFileSync(htmlFile, html);
  const bytes = await takePicture(htmlFile, size, format);
  return { bytes, ...size, mime: format === 'png' ? 'image/png' : 'image/jpeg' };
}

/**
 * The book standing in 3D (stage 4b): front, spine (width from the pages and paper; 14 mm when the pages are not yet
 * known) and the page block, three-quarters toward the viewer, as a PNG or JPG of 1600 × 1200.
 */
export async function renderMockup(
  deps: Deps,
  fonts: FontRegistry,
  bookId: string,
  lang: string,
  format: ImageFormat,
): Promise<{ bytes: Uint8Array; width: number; height: number; mime: string; spineMm: number }> {
  const bundle = getBundle(deps.db, bookId);
  if (!bundle) throw new Error('BOOK_NOT_FOUND');
  const dir = bookPdfDir(deps.config, bookId);
  mkdirSync(dir, { recursive: true });
  const { design } = coverDesign(deps, bookId, lang);
  const view = coverPrintView(deps, bookId, lang);
  const options = savedOptions(deps.db, bookId);
  const texts = coverTexts(bundle, lang, options.preparer);
  const env = {
    imageUrl: (id: string) => {
      const img = imageFile(deps.config, bookId, id);
      return img ? img.file.slice(dir.length + 1).replace(/\\/g, '/') : '';
    },
    fontFamily: coverFontFamily,
  };
  const used = new Set(['vazirmatn', ...designFonts(design)]);
  const spineMm = view.spineMm ?? 14;
  const { html, size } = mockupPage({
    front: design,
    spine: spineTextFor(design, view.print, texts.title ?? '', bundle.book.authors),
    page: BOOK_PAGE_MM[options.pageSize],
    spineMm,
    rtl: getLanguage(lang).dir === 'rtl',
    env,
    css: embeddedFontCss(fonts.all().filter((f) => used.has(f.id))),
    title: texts.title ?? '',
    lang,
  });
  const htmlFile = join(dir, `cover-mockup-${lang}.html`);
  writeFileSync(htmlFile, html);
  const bytes = await takePicture(htmlFile, size, format);
  return { bytes, ...size, mime: format === 'png' ? 'image/png' : 'image/jpeg', spineMm };
}
