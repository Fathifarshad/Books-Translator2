import {
  type CoverBackground,
  type CoverDesign,
  type CoverExtraLayer,
  type CoverLayer,
  type CoverPattern,
  type CoverShapeLayer,
  type CoverTextLayer,
  CoverTextLayerSchema,
} from '@dozabaneh/shared';
import { escapeHtml } from '@dozabaneh/text';
import { rgba, safeHex } from './color';
import { DEFAULT_COVER_FONT } from './defaults';

/**
 * One cover, one picture: the markup the editor shows and the book prints. The cover element is a CSS size
 * container, so every length is in `cqw` (per cent of the cover's width) and the picture only scales — a preview 300
 * pixels wide and a printed A4 page are the same design. Text is escaped; colours and numbers are checked here too,
 * so a design that skipped validation still cannot inject markup.
 */
export interface RenderEnv {
  /** URL of a cover image by id (the editor: the API; the book: a file beside the page). */
  imageUrl(id: string): string;
  /** CSS `font-family` value for a font id, with its fallbacks. */
  fontFamily(id: string): string;
}

const n = (v: number, places = 3) => {
  const f = 10 ** places;
  return String(Math.round((Number.isFinite(v) ? v : 0) * f) / f);
};
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const COVER_STYLE = `
.cv-cover { position: relative; overflow: hidden; container-type: size; width: 100%; height: 100%; direction: ltr;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cv-cover * { box-sizing: border-box; }
.cv-fill { position: absolute; inset: 0; }
.cv-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; max-width: none; }
.cv-pat { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.cv-l { position: absolute; transform: translate(-50%, -50%); margin: 0; }
.cv-text { overflow-wrap: break-word; text-wrap: balance; font-kerning: normal; font-synthesis: weight; }
.cv-in { display: block; }
.cv-in > div { display: block; }
.cv-s svg { display: block; width: 100%; height: auto; overflow: visible; }
/* The printer's bleed (stage 3): the ground, picture and ornaments run past the trim by --bt/--br/--bb/--bl. */
.cv-cover.cv-bleed { overflow: visible; }
.cv-bleed .cv-g { inset: auto; left: calc(-1 * var(--bl, 0cqw)); top: calc(-1 * var(--bt, 0cqw));
  width: calc(100% + var(--bl, 0cqw) + var(--br, 0cqw)); height: calc(100% + var(--bt, 0cqw) + var(--bb, 0cqw)); }
`;

// ── Background ──────────────────────────────────────────────────────────────────────────────────────────────────

function groundCss(bg: CoverBackground): string {
  const a = safeHex(bg.color);
  const b = safeHex(bg.color2);
  if (bg.kind === 'solid') return `background:${a}`;
  if (bg.kind === 'gradient') {
    return bg.gradient === 'radial'
      ? `background:radial-gradient(ellipse at 50% 35%, ${a} 0%, ${a} 45%, ${b} 100%)`
      : `background:linear-gradient(${n(bg.angle, 1)}deg, ${a}, ${b})`;
  }
  // Behind an image: its first colour, for the edges a blur leaves.
  return `background:${a}`;
}

/** The repeating ornaments, in a 1000-wide viewBox so tiles scale with the cover. */
function pattern(kind: CoverPattern, color: string, opacity: number, id: string): string {
  if (kind === 'none' || opacity <= 0) return '';
  const c = safeHex(color);
  const tiles: Record<Exclude<CoverPattern, 'none'>, { size: number; body: string }> = {
    stars: {
      size: 70,
      body: `<g fill="none" stroke="${c}" stroke-width="0.9"><rect x="17.5" y="17.5" width="35" height="35"/><rect x="17.5" y="17.5" width="35" height="35" transform="rotate(45 35 35)"/><circle cx="35" cy="35" r="6.9"/><path d="M0 35h10M60 35h10M35 0v10M35 60v10M0 0l10 10M70 0l-10 10M0 70l10-10M70 70l-10-10"/></g>`,
    },
    grid: { size: 50, body: `<path d="M50 0V50H0" fill="none" stroke="${c}" stroke-width="0.8"/>` },
    dots: { size: 28, body: `<circle cx="14" cy="14" r="2.2" fill="${c}"/>` },
    diagonal: { size: 24, body: `<path d="M-6 6L6 -6M0 24L24 0M18 30L30 18" stroke="${c}" stroke-width="1"/>` },
  };
  const t = tiles[kind];
  return `<svg class="cv-pat cv-g" aria-hidden="true" viewBox="0 0 1000 1414" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="${id}" width="${t.size}" height="${t.size}" patternUnits="userSpaceOnUse">${t.body}</pattern></defs><rect width="1000" height="1414" fill="url(#${id})" opacity="${n(opacity)}"/></svg>`;
}

function frame(bg: CoverBackground): string {
  const c = safeHex(bg.frameColor);
  switch (bg.frame) {
    case 'single':
      return `<div class="cv-fill" style="inset:4.3cqw;border:0.2cqw solid ${c}"></div>`;
    case 'double':
      return `<div class="cv-fill" style="inset:4.3cqw;border:0.2cqw solid ${c};outline:0.085cqw solid ${c};outline-offset:-1.24cqw"></div>`;
    case 'corners': {
      const corner = (t: string) =>
        `<svg aria-hidden="true" viewBox="0 0 40 40" style="position:absolute;width:11cqw;height:11cqw;${t}" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${c}" stroke-width="1.4"><path d="M1 39V1H39"/><path d="M6 39V6H39" stroke-width="0.7"/><circle cx="6" cy="6" r="2.2" fill="${c}"/></g></svg>`;
      return `<div class="cv-fill" style="inset:4.3cqw">${corner('left:0;top:0')}${corner('right:0;top:0;transform:scaleX(-1)')}${corner('left:0;bottom:0;transform:scaleY(-1)')}${corner('right:0;bottom:0;transform:scale(-1,-1)')}</div>`;
    }
    default:
      return '';
  }
}

function dimCss(bg: CoverBackground): string {
  if (bg.dim <= 0) return '';
  const c = safeHex(bg.dimColor);
  const d = Math.min(0.9, bg.dim);
  if (bg.dimMode === 'flat') return `background:${rgba(c, d)}`;
  const dir = bg.dimMode === 'bottom' ? 'to top' : 'to bottom';
  return `background:linear-gradient(${dir}, ${rgba(c, d)} 0%, ${rgba(c, d * 0.65)} 40%, ${rgba(c, 0)} 80%)`;
}

export function backgroundMarkup(bg: CoverBackground, env: RenderEnv, uid: string): string {
  const parts = [`<div class="cv-fill cv-g" style="${groundCss(bg)}"></div>`];
  if (bg.kind === 'image' && bg.image && ID.test(bg.image)) {
    const fx = n(bg.focusX, 2);
    const fy = n(bg.focusY, 2);
    // A blur draws the edges in: enlarge a little so they stay outside the trim.
    const scale = bg.zoom * (1 + bg.blur * 0.06);
    const blur = bg.blur > 0 ? `;filter:blur(${n(bg.blur, 2)}cqw)` : '';
    parts.push(
      `<img class="cv-img cv-g" alt="" src="${escapeHtml(env.imageUrl(bg.image))}" style="object-position:${fx}% ${fy}%;transform:scale(${n(scale)});transform-origin:${fx}% ${fy}%${blur}">`,
    );
  }
  const dim = dimCss(bg);
  if (dim) parts.push(`<div class="cv-fill cv-g" style="${dim}"></div>`);
  parts.push(pattern(bg.pattern, bg.patternColor, bg.patternOpacity, `cv-pat-${uid}`));
  parts.push(frame(bg));
  return parts.join('');
}

// ── Layers ──────────────────────────────────────────────────────────────────────────────────────────────────────

function place(l: CoverLayer): string {
  return `left:${n(l.x, 2)}%;top:${n(l.y, 2)}%;width:${n(l.w, 2)}%;opacity:${n(l.opacity)}`;
}

function linesHtml(l: CoverTextLayer): string {
  const lines = l.text.replace(/\r\n?/g, '\n').split('\n');
  if (l.lineStyle === 'credit') {
    return lines
      .map((line, i) => {
        const t = escapeHtml(line) || '&nbsp;';
        if (i === 0) return `<div style="font-size:0.6em;font-weight:500;color:${safeHex(l.accent)}">${t}</div>`;
        if (i === 1) return `<div>${t}</div>`;
        return `<div style="font-size:0.6em;font-weight:400;opacity:0.92">${t}</div>`;
      })
      .join('');
  }
  return lines.map((line) => escapeHtml(line)).join('<br>');
}

export function textLayerMarkup(l: CoverTextLayer, env: RenderEnv): string {
  const style = [
    place(l),
    `text-align:${l.align}`,
    `font-family:${env.fontFamily(ID.test(l.font) ? l.font : 'vazirmatn')}`,
    `font-weight:${Math.round(l.weight)}`,
    `font-size:${n(l.size)}cqw`,
    `line-height:${n(l.lineHeight)}`,
    `color:${safeHex(l.color, '#ffffff')}`,
  ];
  if (l.letterSpacing) style.push(`letter-spacing:${n(l.letterSpacing)}em`);
  if (l.stroke && l.stroke.width > 0) {
    style.push(`-webkit-text-stroke:${n(l.stroke.width)}em ${safeHex(l.stroke.color)}`, 'paint-order:stroke fill');
  }
  if (l.shadow && l.shadow.opacity > 0) {
    const s = l.shadow;
    style.push(`text-shadow:0 ${n(s.offset)}em ${n(s.blur)}em ${rgba(s.color, s.opacity)}`);
  }
  const inner: string[] = [];
  if (l.band && l.band.opacity > 0) {
    const b = l.band;
    inner.push(
      `background:${rgba(b.color, b.opacity)}`,
      `padding:${n(b.padding * 0.55)}em ${n(b.padding)}em`,
      `border-radius:${n(b.radius)}em`,
    );
  }
  return `<div class="cv-l cv-text" data-layer="${escapeHtml(l.id)}" style="${escapeHtml(style.join(';'))}"><div class="cv-in" dir="auto"${
    inner.length ? ` style="${escapeHtml(inner.join(';'))}"` : ''
  }>${linesHtml(l)}</div></div>`;
}

/** Ornaments drawn in a 200-wide box; `t` is the line width in that box. */
function shapeSvg(s: CoverShapeLayer): string {
  const c = safeHex(s.color);
  const t = n(Math.max(0.2, s.thickness * 2), 2);
  const svg = (viewBox: string, body: string) =>
    `<svg aria-hidden="true" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  switch (s.shape) {
    case 'medallion': {
      const star = (r: number) =>
        `<g transform="rotate(${r} 100 100)"><rect x="52" y="52" width="96" height="96"/><rect x="52" y="52" width="96" height="96" transform="rotate(45 100 100)"/></g>`;
      return svg(
        '0 0 200 200',
        `<g fill="none" stroke="${c}" stroke-width="${t}">${star(0)}${star(22.5)}<circle cx="100" cy="100" r="96"/><circle cx="100" cy="100" r="90" stroke-width="${n(Number(t) / 2, 2)}"/><circle cx="100" cy="100" r="30"/><circle cx="100" cy="100" r="22" stroke-width="${n(Number(t) / 2, 2)}"/></g><circle cx="100" cy="100" r="6" fill="${c}"/>`,
      );
    }
    case 'star':
      return svg(
        '0 0 200 200',
        `<g fill="none" stroke="${c}" stroke-width="${t}"><rect x="40" y="40" width="120" height="120"/><rect x="40" y="40" width="120" height="120" transform="rotate(45 100 100)"/></g>`,
      );
    case 'ring':
      return svg(
        '0 0 200 200',
        `<circle cx="100" cy="100" r="${n(98 - Number(t) / 2, 2)}" fill="none" stroke="${c}" stroke-width="${t}"/>`,
      );
    case 'diamond':
      return svg('0 0 200 200', `<path d="M100 4L196 100L100 196L4 100Z" fill="${c}"/>`);
    default:
      // A rule with a small diamond at its middle.
      return svg(
        '0 0 200 12',
        `<path d="M0 6H86M114 6H200" stroke="${c}" stroke-width="${n(Math.max(0.4, s.thickness * 1.2), 2)}"/><path d="M100 1L105 6L100 11L95 6Z" fill="${c}"/>`,
      );
  }
}

export function shapeLayerMarkup(s: CoverShapeLayer): string {
  return `<div class="cv-l cv-s" data-layer="${escapeHtml(s.id)}" style="${place(s)}">${shapeSvg(s)}</div>`;
}

/** The visible layers in order (the editor repaints these alone while a layer is dragged). */
export function layersMarkup(
  design: CoverDesign,
  env: RenderEnv,
  extra?: ((l: CoverExtraLayer) => string) | undefined,
): string {
  return design.layers
    .filter((l) => l.visible)
    .map((l) => {
      if (l.kind === 'extra') return extra ? extra(l) : '';
      return l.kind === 'text' ? (l.text.trim() ? textLayerMarkup(l, env) : '') : shapeLayerMarkup(l);
    })
    .join('');
}

/** How far the ground runs past each edge, in % of the cover's width (the printer's bleed). */
export interface CoverBleed {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The whole cover: background, then the visible layers in order. `uid` keeps SVG ids of two covers apart; `bleed`
 * lets the ground run past the trim (the layers do not move); `extra` is markup placed on top (the back's barcode).
 */
export function coverMarkup(
  design: CoverDesign,
  env: RenderEnv,
  opts: {
    uid?: string;
    className?: string;
    bleed?: CoverBleed;
    extra?: string;
    /** Draws the back's barcode, price and logo layers. */
    extraLayer?: (l: CoverExtraLayer) => string;
  } = {},
): string {
  const uid = (opts.uid ?? 'front').replace(/[^a-z0-9-]/gi, '');
  const b = opts.bleed;
  const bleed = b
    ? ` style="--bt:${n(b.top)}cqw;--br:${n(b.right)}cqw;--bb:${n(b.bottom)}cqw;--bl:${n(b.left)}cqw"`
    : '';
  const cls = ['cv-cover', b ? 'cv-bleed' : '', opts.className ? escapeHtml(opts.className) : '']
    .filter(Boolean)
    .join(' ');
  return `<div class="${cls}"${bleed}>${backgroundMarkup(design.background, env, uid)}${layersMarkup(design, env, opts.extraLayer)}${opts.extra ?? ''}</div>`;
}

/** The CSS family of a cover font; Vazirmatn fills any letter a face lacks (the same name in editor and book). */
export function coverFontFamily(id: string): string {
  // Single quotes: the value is written into style attributes.
  return `'cv-${ID.test(id) ? id : 'vazirmatn'}', 'cv-vazirmatn', 'Vazirmatn Offline', sans-serif`;
}

/** What the back cover carries besides the front's title: the blurb (with a line above it) and the publisher. */
export interface BackTexts {
  blurb?: string;
  tagline?: string;
  publisher?: string;
  /** Right-to-left books set the blurb ragged-left (aligned right). */
  rtl?: boolean;
}

/**
 * The back cover made from the front (the owner edits it in the studio): the front's ground and ornaments, a smaller
 * medallion, the title, the original title, the blurb, the credit and the publisher, centred, in the front's type.
 * The foot is left free for the ISBN barcode, the price and the publisher's logo.
 */
export function backDesign(design: CoverDesign, extra: BackTexts = {}): CoverDesign {
  const pick = (role: string) =>
    design.layers.find(
      (l): l is CoverTextLayer => l.kind === 'text' && l.role === role && l.visible && Boolean(l.text.trim()),
    );
  const medallion = design.layers.find(
    (l): l is CoverShapeLayer => l.kind === 'shape' && l.shape === 'medallion' && l.visible,
  );
  const withBlurb = Boolean(extra.blurb?.trim());
  const layers: CoverLayer[] = [];
  let y = withBlurb ? 20 : 34;
  if (medallion) layers.push({ ...medallion, x: 50, y: withBlurb ? 12 : 30, w: withBlurb ? 14 : 22 });
  else y = withBlurb ? 14 : 40;
  const title = pick('title');
  const body = pick('preparer') ?? pick('original') ?? title;
  const accent = body && body.kind === 'text' ? body.accent : '#c9a54a';
  if (title) {
    layers.push({
      ...title,
      x: 50,
      y: y + 12,
      w: 64,
      size: Math.min(title.size, 4.6) * 0.62,
      band: null,
      align: 'center',
    });
  }
  const original = pick('original');
  if (original)
    layers.push({ ...original, x: 50, y: y + 19, w: 64, size: original.size * 0.88, band: null, align: 'center' });
  if (withBlurb) {
    const font = body?.font ?? DEFAULT_COVER_FONT;
    const base = {
      kind: 'text' as const,
      role: 'text' as const,
      x: 50,
      font,
      color: title?.color ?? '#ffffff',
      accent,
    };
    if (extra.tagline?.trim()) {
      layers.push(
        CoverTextLayerSchema.parse({
          ...base,
          id: 'tagline',
          text: extra.tagline.trim(),
          y: 47,
          w: 70,
          size: 2.7,
          weight: 700,
          color: accent,
          lineHeight: 1.5,
          align: 'center',
        }),
      );
    }
    layers.push(
      CoverTextLayerSchema.parse({
        ...base,
        id: 'blurb',
        text: extra.blurb?.trim(),
        y: 60,
        w: 70,
        size: 2.05,
        weight: 400,
        lineHeight: 1.95,
        align: extra.rtl === false ? 'left' : 'right',
      }),
    );
  }
  const credit = pick('preparer');
  if (credit) {
    layers.push({
      ...credit,
      x: 50,
      y: withBlurb ? 73 : y + 32,
      w: 72,
      size: withBlurb ? credit.size * 0.9 : credit.size,
      band: null,
      align: 'center',
    });
  }
  if (withBlurb && extra.publisher?.trim()) {
    layers.push(
      CoverTextLayerSchema.parse({
        kind: 'text',
        id: 'publisher',
        role: 'publisher',
        text: extra.publisher.trim(),
        x: 50,
        y: 94,
        w: 50,
        size: 2.1,
        weight: 600,
        font: body?.font ?? DEFAULT_COVER_FONT,
        color: title?.color ?? '#ffffff',
        align: 'center',
      }),
    );
  }
  return { ...design, layers };
}
