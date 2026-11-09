import type { CoverDesign } from '@dozabaneh/shared';
import { escapeHtml } from '@dozabaneh/text';
import { COVER_STYLE, coverMarkup, type RenderEnv } from './render';
import { spineDesign } from './sheet';

/**
 * Pictures of the front cover (ADR-048, stage 4): the shop size, a social-media square and the full print
 * resolution. Pure string building — the caller supplies the fonts' CSS and the browser takes the picture, with the
 * viewport set to exactly the size in pixels (every length of a cover is `cqw`, so size is the only input).
 */
export const IMAGE_PRESETS = ['shop', 'square', 'print'] as const;
export type ImagePreset = (typeof IMAGE_PRESETS)[number];
export const IMAGE_FORMATS = ['png', 'jpg'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** Height of the shop picture (about what Persian and international online shops ask for); width follows the page. */
export const SHOP_HEIGHT_PX = 2400;
/** Side of the social-media square. */
export const SQUARE_PX = 1080;
export const PRINT_DPI = 300;
/** The book fills this share of the square's side. */
const SQUARE_FILL = 0.84;

export interface ImageSize {
  width: number;
  height: number;
}

/** Pixel size of a preset for a page of `page` millimetres. */
export function imageSize(preset: ImagePreset, page: { width: number; height: number }): ImageSize {
  switch (preset) {
    case 'square':
      return { width: SQUARE_PX, height: SQUARE_PX };
    case 'print':
      return {
        width: Math.round((page.width * PRINT_DPI) / 25.4),
        height: Math.round((page.height * PRINT_DPI) / 25.4),
      };
    default:
      return { width: Math.round((SHOP_HEIGHT_PX * page.width) / page.height), height: SHOP_HEIGHT_PX };
  }
}

export interface ImagePageInput {
  front: CoverDesign;
  preset: ImagePreset;
  page: { width: number; height: number };
  env: RenderEnv;
  css: string;
  title: string;
  lang: string;
}

/** The page the browser photographs: the cover alone, or — for the square — the book standing on its own colours. */
export function coverImagePage(input: ImagePageInput): { html: string; size: ImageSize } {
  const size = imageSize(input.preset, input.page);
  const { width: W, height: H } = size;
  let body: string;
  if (input.preset === 'square') {
    const bookH = Math.round(SQUARE_PX * SQUARE_FILL);
    const bookW = Math.round((bookH * input.page.width) / input.page.height);
    const ground = coverMarkup(spineDesign(input.front), input.env, { uid: 'ground' });
    body =
      `<div class="ground">${ground}</div>` +
      `<div class="book" style="width:${bookW}px;height:${bookH}px;left:${Math.round((W - bookW) / 2)}px;top:${Math.round((H - bookH) / 2)}px">` +
      `${coverMarkup(input.front, input.env, { uid: 'front' })}</div>`;
  } else {
    body = `<div class="flat">${coverMarkup(input.front, input.env, { uid: 'front' })}</div>`;
  }
  const html = `<!doctype html><html lang="${escapeHtml(input.lang)}"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<style>html,body{margin:0;padding:0;background:#fff}body{width:${W}px;height:${H}px;position:relative;overflow:hidden}
.ground,.flat{position:absolute;inset:0}
.book{position:absolute;box-shadow:0 ${Math.round(H * 0.02)}px ${Math.round(H * 0.05)}px rgba(0,0,0,.45),0 0 ${Math.round(H * 0.004)}px rgba(0,0,0,.5)}
${COVER_STYLE}${input.css}</style></head><body>${body}</body></html>`;
  return { html, size };
}
