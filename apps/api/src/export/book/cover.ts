import type { ThemeColors } from '@dozabaneh/cover';
import type { Preparer } from '@dozabaneh/shared';
import { escapeHtml } from '@dozabaneh/text';

/**
 * Covers of the book PDF (ADR-046): a generated cover in one of four colour themes — a field of eight-pointed
 * stars (the «خاتم» pattern of Persian tilework), a medallion, the title, the original title, and the preparer — or
 * the owner's own image, optionally with the title and the preparer on a band at its foot. The same theme colours
 * the headings and rules inside the book, so cover and pages read as one object.
 */
export { THEMES, type ThemeColors } from '@dozabaneh/cover';

export interface CoverContent {
  title: string;
  titleSrc: string;
  srcDir: 'ltr' | 'rtl';
  srcLang: string;
  authors: string;
  preparer: Preparer;
}

/** One tile of the star field; `id` keeps the patterns of the front and back cover apart. */
function starField(id: string, color: string, opacity: number): string {
  return `<svg class="field" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
<defs><pattern id="${id}" width="56" height="56" patternUnits="userSpaceOnUse">
<g fill="none" stroke="${color}" stroke-width="0.7" opacity="${opacity}">
<rect x="14" y="14" width="28" height="28"/><rect x="14" y="14" width="28" height="28" transform="rotate(45 28 28)"/>
<circle cx="28" cy="28" r="5.5"/><path d="M0 28h8M48 28h8M28 0v8M28 48v8M0 0l8 8M56 0l-8 8M0 56l8-8M56 56l-8-8"/>
</g></pattern></defs><rect width="100%" height="100%" fill="url(#${id})"/></svg>`;
}

/** A sixteen-pointed medallion: two eight-pointed stars inside a double ring. */
function medallion(color: string): string {
  const star = (rotate: number) =>
    `<g transform="rotate(${rotate} 100 100)"><rect x="52" y="52" width="96" height="96"/><rect x="52" y="52" width="96" height="96" transform="rotate(45 100 100)"/></g>`;
  return `<svg class="medallion" aria-hidden="true" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
<g fill="none" stroke="${color}" stroke-width="1.6">${star(0)}${star(22.5)}
<circle cx="100" cy="100" r="96"/><circle cx="100" cy="100" r="90" stroke-width="0.8"/><circle cx="100" cy="100" r="30"/>
<circle cx="100" cy="100" r="22" stroke-width="0.8"/></g><circle cx="100" cy="100" r="6" fill="${color}"/></svg>`;
}

function preparerHtml(p: Preparer, defaultRole: string): string {
  if (!p.name) return '';
  return `<div class="preparer"><div class="role">${escapeHtml(p.role || defaultRole)}</div>
<div class="name">${escapeHtml(p.name)}</div>${p.title ? `<div class="about">${escapeHtml(p.title)}</div>` : ''}</div>`;
}

/** Title size steps down as the title grows, so a long title still fits on two or three lines. */
function titleSize(title: string): string {
  const n = title.length;
  return n <= 28 ? '34pt' : n <= 48 ? '29pt' : n <= 72 ? '25pt' : '21pt';
}

export function generatedCover(c: CoverContent, theme: ThemeColors, defaultRole: string): string {
  return `<section class="cover generated" style="--c-bg:${theme.bg};--c-edge:${theme.edge};--c-ink:${theme.ink};--c-orn:${theme.ornament}">
${starField('cover-stars', theme.ornament, 0.22)}
<div class="frame"></div>
<div class="cover-top">${medallion(theme.ornament)}</div>
<div class="cover-title">
<div class="t" style="font-size:${titleSize(c.title)}">${escapeHtml(c.title)}</div>
${c.titleSrc && c.titleSrc !== c.title ? `<div class="o" dir="${c.srcDir}" lang="${escapeHtml(c.srcLang)}">${escapeHtml(c.titleSrc)}</div>` : ''}
${c.authors ? `<div class="a">${escapeHtml(c.authors)}</div>` : ''}
</div>
<div class="cover-foot">${preparerHtml(c.preparer, defaultRole)}</div>
</section>`;
}

export function backCover(c: CoverContent, theme: ThemeColors, defaultRole: string): string {
  return `<section class="cover back" style="--c-bg:${theme.bg};--c-edge:${theme.edge};--c-ink:${theme.ink};--c-orn:${theme.ornament}">
${starField('back-stars', theme.ornament, 0.14)}
<div class="frame"></div>
<div class="back-body">${medallion(theme.ornament)}
<div class="t">${escapeHtml(c.title)}</div>
${c.titleSrc && c.titleSrc !== c.title ? `<div class="o" dir="${c.srcDir}" lang="${escapeHtml(c.srcLang)}">${escapeHtml(c.titleSrc)}</div>` : ''}
${preparerHtml(c.preparer, defaultRole)}</div>
</section>`;
}

/** The owner's own cover image; `src` is a URL the page can load (a file next to it). */
export function imageCover(src: string, c: CoverContent, withText: boolean, defaultRole: string): string {
  const band = withText
    ? `<div class="band"><div class="t">${escapeHtml(c.title)}</div>${preparerHtml(c.preparer, defaultRole)}</div>`
    : '';
  return `<section class="cover image"><img src="${escapeHtml(src)}" alt="">${band}</section>`;
}

export const COVER_CSS = `
.cover { page: cover; position: relative; overflow: hidden; break-after: page; width: var(--page-w); height: var(--page-h); }
.cover.generated, .cover.back { background: radial-gradient(ellipse at 50% 35%, var(--c-bg) 0%, var(--c-bg) 45%, var(--c-edge) 100%); color: var(--c-ink); }
.cover .field { position: absolute; inset: 0; }
.cover .frame { position: absolute; inset: 9mm; border: 1.2pt solid var(--c-orn); outline: 0.5pt solid var(--c-orn); outline-offset: -2.6mm; }
.cover-top { position: absolute; top: 15%; inset-inline: 0; display: flex; justify-content: center; }
.cover .medallion { width: 30%; aspect-ratio: 1; filter: drop-shadow(0 0 6px rgba(0,0,0,.25)); }
.cover-top::before { content: ""; position: absolute; top: 50%; inset-inline: 18mm; border-top: 0.6pt solid var(--c-orn); opacity: .55; }
.cover-title { position: absolute; top: 47%; inset-inline: 17%; text-align: center; }
.cover-title .t { font-family: var(--f-head); font-weight: 800; line-height: 1.45; text-wrap: balance; }
.cover-title .o { margin-top: 5mm; font-family: var(--f-latin); font-size: 12.5pt; letter-spacing: .04em; color: var(--c-orn); text-wrap: balance; }
.cover-title .a { margin-top: 3mm; font-size: 11pt; opacity: .9; }
.cover-title::before, .cover-title::after { content: ""; display: block; margin: 0 auto; width: 26%; border-top: 0.8pt solid var(--c-orn); }
.cover-title::before { margin-bottom: 7mm; } .cover-title::after { margin-top: 7mm; }
.cover-foot { position: absolute; bottom: 9%; inset-inline: 12%; text-align: center; }
.cover .preparer .role { font-size: 10.5pt; color: var(--c-orn); letter-spacing: .02em; }
.cover .preparer .name { margin-top: 1.5mm; font-family: var(--f-head); font-size: 17pt; font-weight: 700; }
.cover .preparer .about { margin-top: 1mm; font-size: 10.5pt; opacity: .92; }
.back-body { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5mm; padding: 0 18%; text-align: center; }
.back-body .medallion { width: 22%; }
.back-body .t { font-family: var(--f-head); font-size: 17pt; font-weight: 700; line-height: 1.5; }
.back-body .o { font-family: var(--f-latin); font-size: 11pt; color: var(--c-orn); }
.back-body .preparer { margin-top: 8mm; }
.cover.image img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cover.image .band { position: absolute; inset-inline: 0; bottom: 0; padding: 7mm 12mm 9mm; text-align: center; color: #fff;
  background: linear-gradient(to top, rgba(0,0,0,.82), rgba(0,0,0,.55) 70%, rgba(0,0,0,0)); }
.cover.image .band .t { font-family: var(--f-head); font-size: 20pt; font-weight: 800; line-height: 1.5; }
.cover.image .band .preparer { margin-top: 3mm; } .cover.image .band .role { color: #f0d58c; }
`;
