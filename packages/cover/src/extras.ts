import type { CoverDesign, CoverExtra, CoverExtraLayer, CoverPrint } from '@dozabaneh/shared';
import { escapeHtml } from '@dozabaneh/text';
import { safeHex } from './color';
import type { RenderEnv } from './render';
import { ean13Svg, isbnDigits, isValidEan13 } from './wrap';

/**
 * The back cover's barcode, price and publisher's logo (ADR-048, stage 4c). Each is a layer of the back design —
 * `{kind: 'extra'}` — so it is dragged, sized, hidden, undone and saved like any other; what it says comes from the
 * printer settings (`CoverPrint`). Pure string building.
 */
const NOMINAL_BARCODE_MM = 37.29;
const mm = (v: number) => String(Math.round(v * 100) / 100);
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

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

/** What the layers show, and the type they use. */
export interface ExtrasContent {
  print: Pick<CoverPrint, 'barcode' | 'isbn' | 'price' | 'logo'>;
  /** The page's width: sizes inside the barcode box follow the layer's width. */
  pageWidthMm: number;
  /** Colour and face of the price (the title's ink and the back's body face). */
  ink: string;
  font: string;
  /** The editor shows a dashed box named by these where a layer has nothing to say yet (so it can still be dragged). */
  placeholders?: Record<CoverExtra, string> | undefined;
}

/** The barcode box's width in % of the page: the barcode itself plus a white margin. */
const barcodeBoxWidth = (pageWidthMm: number) => Math.round(((NOMINAL_BARCODE_MM + 8) * 1000) / pageWidthMm) / 10;

/** Default places on the back's foot. */
export function defaultExtraLayers(pageWidthMm: number): CoverExtraLayer[] {
  const base = { opacity: 1, visible: true, locked: false } as const;
  return [
    { kind: 'extra', id: 'barcode', extra: 'barcode', x: 24, y: 87, w: barcodeBoxWidth(pageWidthMm), ...base },
    { kind: 'extra', id: 'price', extra: 'price', x: 24, y: 78, w: 38, ...base },
    { kind: 'extra', id: 'logo', extra: 'logo', x: 76, y: 86, w: 15, ...base },
  ];
}

/** The design with the extra layers it lacks, at their default places (a saved one keeps its own). */
export function ensureExtras(design: CoverDesign, pageWidthMm: number): CoverDesign {
  const have = new Set(design.layers.flatMap((l) => (l.kind === 'extra' ? [l.extra] : [])));
  const missing = defaultExtraLayers(pageWidthMm).filter((l) => !have.has(l.extra));
  if (!missing.length) return design;
  const ids = new Set(design.layers.map((l) => l.id));
  const add = missing.map((l) => {
    let id = l.id;
    for (let i = 2; ids.has(id); i++) id = `${l.id}-${i}`;
    ids.add(id);
    return { ...l, id };
  });
  return { ...design, layers: [...design.layers, ...add].slice(0, 40) };
}

function box(l: CoverExtraLayer, inner: string, extraStyle = ''): string {
  return `<div class="cv-l cv-extra" data-layer="${escapeHtml(l.id)}" style="left:${mm(l.x)}%;top:${mm(l.y)}%;width:${mm(l.w)}%;opacity:${mm(l.opacity)};${extraStyle}">${inner}</div>`;
}

function placeholder(l: CoverExtraLayer, label: string): string {
  return box(
    l,
    `<div style="text-align:center;font:600 2.2cqw/1.5 sans-serif;color:#fff;opacity:.75">${escapeHtml(label)}</div>`,
    'border:0.4cqw dashed rgba(255,255,255,.55);border-radius:1cqw;padding:2cqw 1cqw;background:rgba(0,0,0,.18)',
  );
}

/** One extra layer: the barcode on white (as scanners need), the price as type, or the logo. Empty → nothing. */
export function extraLayerMarkup(l: CoverExtraLayer, c: ExtrasContent, env: RenderEnv): string {
  const hint = c.placeholders?.[l.extra];
  if (l.extra === 'barcode') {
    const status = isbnStatus(c.print.isbn);
    if (!(c.print.barcode && status.state === 'valid' && status.digits)) return hint ? placeholder(l, hint) : '';
    const k = 100 / c.pageWidthMm;
    // Everything inside follows the layer's width (the default width is the barcode plus its margin).
    const s = l.w / barcodeBoxWidth(c.pageWidthMm);
    const label = escapeHtml(isbnLabel(c.print.isbn));
    const svg = ean13Svg(status.digits, { widthMm: NOMINAL_BARCODE_MM }).replace(
      / width="[^"]*mm" height="[^"]*mm"/,
      ' style="display:block;width:100%;height:auto"',
    );
    return box(
      l,
      `<div style="font:600 ${mm(2.6 * k * s)}cqw/1.3 monospace;color:#000;text-align:center;direction:ltr">${label}</div>${svg}`,
      `background:#fff;padding:${mm(2 * k * s)}cqw ${mm(3 * k * s)}cqw;border-radius:${mm(k * s)}cqw`,
    );
  }
  if (l.extra === 'price') {
    if (!c.print.price.trim()) return hint ? placeholder(l, hint) : '';
    return box(
      l,
      `<div class="cv-in" dir="auto">${escapeHtml(c.print.price.trim())}</div>`,
      `text-align:center;font-family:${c.font};font-weight:700;font-size:${mm((2.6 * l.w) / 38)}cqw;color:${safeHex(c.ink, '#ffffff')}`,
    );
  }
  const src = c.print.logo && ID.test(c.print.logo) ? env.imageUrl(c.print.logo) : '';
  if (!src) return hint ? placeholder(l, hint) : '';
  return box(
    l,
    `<img alt="" src="${escapeHtml(src)}" style="display:block;width:100%;height:auto;max-height:${mm(l.w * 0.93)}cqw;object-fit:contain">`,
  );
}

/** The callback `layersMarkup`/`coverMarkup`/`wrapSheet` take to draw the back's extra layers. */
export function extrasRenderer(c: ExtrasContent, env: RenderEnv): (l: CoverExtraLayer) => string {
  return (l) => extraLayerMarkup(l, c, env);
}
