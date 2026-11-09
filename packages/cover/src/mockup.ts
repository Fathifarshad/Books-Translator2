import type { CoverDesign } from '@dozabaneh/shared';
import { escapeHtml } from '@dozabaneh/text';
import { COVER_STYLE, coverMarkup, type RenderEnv } from './render';
import { type SpineText, spineDesign, spineTextMarkup } from './sheet';

/**
 * A 3D picture of the book (ADR-048, stage 4b): a box in CSS 3D — front, spine, page block, back — measured in
 * millimetres like the real book, turned three-quarters toward the viewer on a soft studio ground and photographed
 * by the browser. Pure string building; the caller supplies the fonts' CSS and how images are addressed.
 */
export const MOCKUP_SIZE = { width: 1600, height: 1200 } as const;
/** The book's height as a share of the picture's. */
const FILL = 0.74;
const PX_PER_MM = 96 / 25.4;
/** Even a hairline spine gets this much depth so the book reads as a book. */
const MIN_DEPTH_MM = 6;

const mm = (v: number) => String(Math.round(v * 100) / 100);

export interface MockupInput {
  front: CoverDesign;
  spine: SpineText | null;
  page: { width: number; height: number };
  spineMm: number;
  /** Right-to-left books have the spine on the right of the front. */
  rtl: boolean;
  env: RenderEnv;
  css: string;
  title: string;
  lang: string;
}

export function mockupPage(input: MockupInput): { html: string; size: { width: number; height: number } } {
  const { page, rtl } = input;
  const D = Math.max(input.spineMm, MIN_DEPTH_MM);
  const W = page.width;
  const H = page.height;
  const scale = (MOCKUP_SIZE.height * FILL) / (H * PX_PER_MM);
  // The edge that carries the spine turns toward the viewer.
  const turn = rtl ? -32 : 32;
  const spineX = rtl ? W : 0;
  const pagesX = rtl ? 0 : W;
  const spineFace = `${coverMarkup(spineDesign(input.front), input.env, { uid: 'spine' })}${spineTextMarkup(input.spine ?? { title: '', author: '', font: 'vazirmatn', weight: 700, color: '#fff', accent: '#fff' }, D, H, input.env)}`;
  const html = `<!doctype html><html lang="${escapeHtml(input.lang)}"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<style>html,body{margin:0;padding:0}
body{width:${MOCKUP_SIZE.width}px;height:${MOCKUP_SIZE.height}px;overflow:hidden;position:relative;
 background:radial-gradient(ellipse at 50% 38%,#f7f4ee 0%,#e4ddd0 60%,#cfc6b4 100%)}
.floor{position:absolute;left:50%;top:${Math.round(MOCKUP_SIZE.height * (0.5 + FILL / 2) - 28)}px;width:${Math.round(W * PX_PER_MM * scale * 1.25)}px;height:70px;transform:translateX(-50%);
 background:radial-gradient(ellipse at center,rgba(40,30,15,.5) 0%,rgba(40,30,15,.18) 55%,rgba(40,30,15,0) 72%);filter:blur(10px)}
.scene{position:absolute;inset:0;perspective:2600px;display:flex;align-items:center;justify-content:center}
.stage{transform:scale(${scale.toFixed(4)});transform-style:preserve-3d}
.book{position:relative;width:${mm(W)}mm;height:${mm(H)}mm;transform-style:preserve-3d;transform:rotateX(-7deg) rotateY(${turn}deg)}
.face{position:absolute;overflow:hidden;backface-visibility:hidden}
.front{left:0;top:0;width:${mm(W)}mm;height:${mm(H)}mm;transform:translateZ(${mm(D / 2)}mm)}
.back{left:0;top:0;width:${mm(W)}mm;height:${mm(H)}mm;transform:rotateY(180deg) translateZ(${mm(D / 2)}mm);background:#222}
.spine{left:${mm(spineX - D / 2)}mm;top:0;width:${mm(D)}mm;height:${mm(H)}mm;transform:rotateY(${rtl ? 90 : -90}deg)}
.spine::after{content:"";position:absolute;inset:0;background:linear-gradient(${rtl ? 90 : 270}deg,rgba(0,0,0,.28),rgba(255,255,255,.08) 40%,rgba(0,0,0,.18))}
.sheen{position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,0) 38%,rgba(0,0,0,.14) 100%)}
.pages,.top,.bottom{background:repeating-linear-gradient(90deg,#f3eee2 0 .35mm,#e0d8c6 .35mm .5mm)}
.pages{left:${mm(pagesX - D / 2)}mm;top:0;width:${mm(D)}mm;height:${mm(H)}mm;transform:rotateY(${rtl ? -90 : 90}deg);background:repeating-linear-gradient(0deg,#f3eee2 0 .35mm,#ddd5c2 .35mm .5mm)}
.top{left:0;top:${mm(-D / 2)}mm;width:${mm(W)}mm;height:${mm(D)}mm;transform:rotateX(90deg)}
.bottom{left:0;top:${mm(H - D / 2)}mm;width:${mm(W)}mm;height:${mm(D)}mm;transform:rotateX(-90deg);filter:brightness(.8)}
${COVER_STYLE}${input.css}</style></head><body><div class="floor"></div><div class="scene"><div class="stage"><div class="book">
<div class="face back"></div><div class="face pages"></div><div class="face top"></div><div class="face bottom"></div>
<div class="face spine">${spineFace}</div>
<div class="face front">${coverMarkup(input.front, input.env, { uid: 'front' })}<div class="sheen"></div></div>
</div></div></div></body></html>`;
  return { html, size: { ...MOCKUP_SIZE } };
}
