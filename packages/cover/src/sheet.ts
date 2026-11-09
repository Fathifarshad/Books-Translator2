import type { CoverDesign, CoverPrint } from '@dozabaneh/shared';
import { escapeHtml } from '@dozabaneh/text';
import { safeHex } from './color';
import { backgroundMarkup, COVER_STYLE, type CoverBleed, coverMarkup, type RenderEnv } from './render';
import { ean13Svg, isbnDigits, isValidEan13, wrapLayout } from './wrap';

/**
 * The printer's sheet (ADR-048, stage 3): back, spine and front as one page in millimetres, the grounds running
 * `bleedMm` past the trim, optional crop and fold marks outside the bleed, the barcode, price and logo on the back.
 * Pure string building: the caller supplies the fonts' CSS and how images are addressed.
 */

const NOMINAL_BARCODE_MM = 37.29;
/** Crop marks start this far outside the bleed and run this long. */
const MARK_GAP_MM = 1.5;
const MARK_LEN_MM = 5;
/** Spines narrower than this carry no text (printers' rule of thumb). */
export const MIN_SPINE_TEXT_MM = 6;

const mm = (v: number) => String(Math.round(v * 100) / 100);

/** The ISBN line printed above the barcode, as the owner typed it (hyphens kept). */
export function isbnLabel(input: string): string {
  return isbnDigits(input) ? `ISBN ${input.trim().replace(/\s+/g, ' ')}` : '';
}

export type IsbnState = 'empty' | 'valid' | 'bad-check' | 'bad-format';

export function isbnStatus(input: string): { state: IsbnState; digits: string | null } {
  if (!input.trim()) return { state: 'empty', digits: null };
  const d = isbnDigits(input);
  if (!d) return { state: 'bad-format', digits: null };
  if (d.length !== 13) return { state: 'bad-format', digits: null };
  return isValidEan13(d) ? { state: 'valid', digits: d } : { state: 'bad-check', digits: d };
}

/**
 * Barcode (with its ISBN line, on white as scanners need), price and logo for the back cover, as markup placed in
 * the back's `cv-cover` (lengths in `cqw` of the back's trim width).
 */
export function backExtrasMarkup(
  print: Pick<CoverPrint, 'barcode' | 'isbn' | 'price' | 'logo'>,
  pageWidthMm: number,
  env: RenderEnv,
  ink: string,
  font: string,
): string {
  const parts: string[] = [];
  const status = isbnStatus(print.isbn);
  const k = 100 / pageWidthMm;
  const place = (x: number, y: number, w: number) => `left:${mm(x)}%;top:${mm(y)}%;width:${mm(w)}%`;
  if (print.barcode && status.state === 'valid' && status.digits) {
    const boxW = (NOMINAL_BARCODE_MM + 8) * k;
    const label = escapeHtml(isbnLabel(print.isbn));
    const svg = ean13Svg(status.digits, { widthMm: NOMINAL_BARCODE_MM }).replace(
      / width="[^"]*mm" height="[^"]*mm"/,
      ' style="display:block;width:100%;height:auto"',
    );
    parts.push(
      `<div class="cv-l cv-barcode" style="${place(24, 87, boxW)};background:#fff;padding:${mm(2 * k)}cqw ${mm(3 * k)}cqw;border-radius:${mm(k)}cqw"><div style="font:600 ${mm(2.6 * k)}cqw/1.3 monospace;color:#000;text-align:center;direction:ltr">${label}</div>${svg}</div>`,
    );
  }
  if (print.price.trim()) {
    parts.push(
      `<div class="cv-l cv-text" style="${place(24, 78, 38)};text-align:center;font-family:${font};font-weight:700;font-size:2.6cqw;color:${safeHex(ink, '#ffffff')}"><div class="cv-in" dir="auto">${escapeHtml(print.price.trim())}</div></div>`,
    );
  }
  if (print.logo && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(print.logo)) {
    const src = env.imageUrl(print.logo);
    if (src) {
      parts.push(
        `<div class="cv-l" style="${place(76, 86, 15)}"><img alt="" src="${escapeHtml(src)}" style="display:block;width:100%;height:auto;max-height:14cqw;object-fit:contain"></div>`,
      );
    }
  }
  return parts.join('');
}

export interface SpineText {
  title: string;
  author: string;
  font: string;
  weight: number;
  color: string;
  accent: string;
}

/** The spine's lettering: reads top to bottom, title first, the author at the foot when the spine is wide enough. */
export function spineTextMarkup(t: SpineText, spineMm: number, pageHeightMm: number, env: RenderEnv): string {
  if (spineMm < MIN_SPINE_TEXT_MM || !t.title.trim()) return '';
  const room = pageHeightMm * 0.62;
  const chars = [...t.title.trim()].length;
  const size = Math.min(spineMm * 0.46, 9, room / (chars * 0.58));
  const author =
    spineMm >= 9 && t.author.trim()
      ? `<span style="font-size:${mm(size * 0.62)}mm;font-weight:500;color:${safeHex(t.accent, '#c9a54a')}">${escapeHtml(t.author.trim())}</span>`
      : '';
  const pad = mm(pageHeightMm * 0.07);
  return `<div class="spine-text" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;writing-mode:vertical-rl;padding:${pad}mm 0;font-family:${env.fontFamily(t.font)};font-weight:${Math.round(t.weight)};color:${safeHex(t.color, '#ffffff')};white-space:nowrap"><span style="font-size:${mm(size)}mm;line-height:1">${escapeHtml(t.title.trim())}</span>${author}</div>`;
}

/** The front's ground for the spine: its colours (a picture becomes its first colour), no pattern or frame. */
export function spineDesign(front: CoverDesign): CoverDesign {
  const bg = front.background;
  return {
    ...front,
    layers: [],
    background: {
      ...bg,
      kind: bg.kind === 'solid' || bg.kind === 'image' ? 'solid' : 'gradient',
      gradient: 'linear',
      angle: 180,
      image: null,
      dim: 0,
      pattern: 'none',
      frame: 'none',
    },
  };
}

function cropMarks(layout: ReturnType<typeof wrapLayout>, margin: number, sheetW: number, sheetH: number): string {
  const x0 = margin + layout.bleed;
  const y0 = margin + layout.bleed;
  const x1 = margin + layout.width - layout.bleed;
  const y1 = margin + layout.height - layout.bleed;
  const off = layout.bleed + MARK_GAP_MM;
  const lines: string[] = [];
  const h = (x: number, y: number, dir: -1 | 1) => `M${mm(x)} ${mm(y)}h${mm(dir * MARK_LEN_MM)}`;
  const v = (x: number, y: number, dir: -1 | 1) => `M${mm(x)} ${mm(y)}v${mm(dir * MARK_LEN_MM)}`;
  // Corners: a horizontal and a vertical mark each, outside the bleed.
  lines.push(h(x0 - off, y0, -1), v(x0, y0 - off, -1), h(x1 + off, y0, 1), v(x1, y0 - off, -1));
  lines.push(h(x0 - off, y1, -1), v(x0, y1 + off, 1), h(x1 + off, y1, 1), v(x1, y1 + off, 1));
  // Folds: the spine's two edges, above and below.
  for (const fx of [margin + layout.spine.x, margin + layout.spine.x + layout.spine.width]) {
    lines.push(v(fx, y0 - off, -1), v(fx, y1 + off, 1));
  }
  return `<svg class="marks" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mm(sheetW)} ${mm(sheetH)}" width="${mm(sheetW)}mm" height="${mm(sheetH)}mm"><path d="${lines.join('')}" fill="none" stroke="#000" stroke-width="0.25"/></svg>`;
}

export interface SheetInput {
  front: CoverDesign;
  back: CoverDesign;
  page: { width: number; height: number };
  spineMm: number;
  bleedMm: number;
  cropMarks: boolean;
  rtl: boolean;
  spine: SpineText | null;
  backExtras: string;
  env: RenderEnv;
  /** `@font-face` rules (embedded files for the printer, URLs for the preview). */
  css: string;
  title: string;
  lang: string;
  /** Scale the sheet to the frame's width (the preview) instead of printing it at size. */
  fit?: boolean;
}

export interface Sheet {
  html: string;
  widthMm: number;
  heightMm: number;
}

export function wrapSheet(input: SheetInput): Sheet {
  const { page, spineMm, bleedMm: bleed } = input;
  const layout = wrapLayout(page, spineMm, bleed, input.rtl);
  const margin = input.cropMarks ? bleed + MARK_GAP_MM + MARK_LEN_MM + 1.5 : 0;
  const W = layout.width + 2 * margin;
  const H = layout.height + 2 * margin;
  const leftmost = Math.min(layout.back.x, layout.spine.x, layout.front.x);
  const rightmost = Math.max(layout.back.x, layout.spine.x, layout.front.x);

  const panel = (
    name: 'back' | 'spine' | 'front',
    box: { x: number; width: number },
    design: CoverDesign,
    extra = '',
  ) => {
    const left = box.x === leftmost ? bleed : 0;
    const right = box.x === rightmost ? bleed : 0;
    const k = 100 / box.width;
    const b: CoverBleed = { top: bleed * k, bottom: bleed * k, left: left * k, right: right * k };
    const cover =
      name === 'spine'
        ? `<div class="cv-cover cv-bleed" style="--bt:${mm(b.top)}cqw;--br:0cqw;--bb:${mm(b.bottom)}cqw;--bl:0cqw">${backgroundMarkup(design.background, input.env, name)}</div>`
        : coverMarkup(design, input.env, { uid: name, bleed: b, extra });
    const lettering =
      name === 'spine' && input.spine ? spineTextMarkup(input.spine, spineMm, page.height, input.env) : '';
    return `<div class="panel" data-panel="${name}" style="left:${mm(margin + box.x - left)}mm;top:${mm(margin)}mm;width:${mm(box.width + left + right)}mm;height:${mm(layout.height)}mm"><div class="in" style="left:${mm(left)}mm;top:${mm(bleed)}mm;width:${mm(box.width)}mm;height:${mm(page.height)}mm">${cover}${lettering}</div></div>`;
  };

  const body = [
    panel('back', layout.back, input.back, input.backExtras),
    panel('spine', layout.spine, spineDesign(input.front)),
    panel('front', layout.front, input.front),
    input.cropMarks ? cropMarks(layout, margin, W, H) : '',
  ].join('');
  const fit = input.fit
    ? `<script>function fit(){document.body.style.zoom=String(innerWidth/(${mm(W)}*96/25.4))}fit();addEventListener('resize',fit)</script>`
    : '';
  const html = `<!doctype html><html lang="${escapeHtml(input.lang)}"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<style>@page{size:${mm(W)}mm ${mm(H)}mm;margin:0}
html,body{margin:0;padding:0;background:#fff}${input.fit ? 'body{overflow:hidden}' : ''}
.sheet{position:relative;width:${mm(W)}mm;height:${mm(H)}mm;overflow:hidden;background:#fff}
.panel{position:absolute;overflow:hidden}.in{position:absolute}.marks{position:absolute;left:0;top:0}
${COVER_STYLE}${input.css}</style></head><body><div class="sheet" data-w="${mm(W)}" data-h="${mm(H)}">${body}</div>${fit}</body></html>`;
  return { html, widthMm: W, heightMm: H };
}
