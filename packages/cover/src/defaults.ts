import {
  type CoverDesign,
  CoverDesignSchema,
  type CoverLayer,
  type CoverShapeLayer,
  type CoverTextLayer,
  CoverTextLayerSchema,
  type CoverTextRole,
  type CoverTheme,
} from '@dozabaneh/shared';

/**
 * The starting point of a design: the classic generated cover of ADR-046 (star field, double frame, medallion,
 * title between rules, the original title, the preparer at the foot) as editable layers — and the helpers that put a
 * book's own texts into a design or a template.
 */
export interface ThemeColors {
  /** Cover background, its deeper edge, the ink on it, the ornament colour, and the accent used inside the book. */
  bg: string;
  edge: string;
  ink: string;
  ornament: string;
  accent: string;
  /** Tint of chapter openings and table headers inside the book. */
  tint: string;
}

export const THEMES: Record<CoverTheme, ThemeColors> = {
  navy: { bg: '#16264a', edge: '#0b1530', ink: '#f6f1e3', ornament: '#c9a54a', accent: '#1f3a6b', tint: '#eef2f8' },
  emerald: { bg: '#0d4a45', edge: '#062b28', ink: '#f3efe2', ornament: '#d2b25c', accent: '#0f5c55', tint: '#ecf5f3' },
  burgundy: { bg: '#5a1628', edge: '#310a15', ink: '#f7efe4', ornament: '#d4a95a', accent: '#7a1f35', tint: '#f8eef0' },
  ivory: { bg: '#f3ecdc', edge: '#e2d6bb', ink: '#1d2740', ornament: '#9b2c2c', accent: '#8a2b22', tint: '#f7f1e6' },
};

/** The book's own words for each role; the preparer as «role\nname\ntitles». */
export type CoverTexts = Partial<Record<CoverTextRole, string>>;

/** Default typeface of the cover: shipped with the app, so a design opens the same on any computer. */
export const DEFAULT_COVER_FONT = 'vazirmatn';

/** Title size steps down as the title grows (34/29/25/21 pt on an A4 cover, as % of its width). */
export function titleSize(title: string): number {
  const n = title.length;
  return n <= 28 ? 5.7 : n <= 48 ? 4.9 : n <= 72 ? 4.2 : 3.5;
}

/** «role\nname\ntitles» of a preparer, without empty lines at the end. */
export function preparerText(p: { role: string; name: string; title: string }, defaultRole: string): string {
  if (!p.name.trim()) return '';
  return [p.role.trim() || defaultRole, p.name.trim(), p.title.trim()].filter(Boolean).join('\n');
}

function text(
  role: CoverTextRole,
  o: Partial<CoverTextLayer> & Pick<CoverTextLayer, 'y' | 'size' | 'color'>,
): CoverTextLayer {
  return CoverTextLayerSchema.parse({
    kind: 'text',
    id: role,
    role,
    text: '',
    x: 50,
    w: 66,
    font: DEFAULT_COVER_FONT,
    ...o,
  });
}

const shape = (o: Omit<CoverShapeLayer, 'opacity' | 'visible' | 'locked' | 'thickness'> & Partial<CoverShapeLayer>) =>
  ({ opacity: 1, visible: true, locked: false, thickness: 0.8, ...o }) satisfies CoverShapeLayer;

export function defaultDesign(texts: CoverTexts, theme: ThemeColors): CoverDesign {
  const title = texts.title ?? '';
  const layers: CoverLayer[] = [
    shape({ kind: 'shape', id: 'medallion', shape: 'medallion', x: 50, y: 26, w: 30, color: theme.ornament }),
    shape({ kind: 'shape', id: 'rule-top', shape: 'rule', x: 50, y: 43.5, w: 26, color: theme.ornament }),
    text('title', { text: title, y: 52, size: titleSize(title), weight: 800, color: theme.ink, lineHeight: 1.45 }),
    text('original', {
      text: texts.original ?? '',
      y: 62,
      size: 2.1,
      weight: 400,
      color: theme.ornament,
      letterSpacing: 0.04,
      lineHeight: 1.4,
    }),
    text('authors', { text: texts.authors ?? '', y: 67.5, size: 1.85, weight: 400, color: theme.ink, opacity: 0.9 }),
    text('preparer', {
      text: texts.preparer ?? '',
      y: 86,
      w: 76,
      size: 2.85,
      weight: 700,
      color: theme.ink,
      lineStyle: 'credit',
      accent: theme.ornament,
      lineHeight: 1.55,
    }),
  ];
  return CoverDesignSchema.parse({
    background: {
      kind: 'gradient',
      gradient: 'radial',
      color: theme.bg,
      color2: theme.edge,
      pattern: 'stars',
      patternColor: theme.ornament,
      patternOpacity: 0.22,
      frame: 'double',
      frameColor: theme.ornament,
    },
    // Empty texts stay as hidden layers, ready to be filled in.
    layers: layers.map((l) => (l.kind === 'text' && !l.text.trim() ? { ...l, visible: false } : l)),
  });
}

/**
 * Puts a book's texts into a design (a template, or «reset to the book's text»): every layer of a known role takes
 * the book's words; free text stays as it is.
 */
export function withTexts(design: CoverDesign, texts: CoverTexts): CoverDesign {
  return {
    ...design,
    layers: design.layers.map((l) => {
      if (l.kind !== 'text' || l.role === 'text') return l;
      const t = texts[l.role];
      return t === undefined ? l : { ...l, text: t };
    }),
  };
}

/** A new id for a layer of this kind that the design does not use yet. */
export function newLayerId(design: CoverDesign, base: string): string {
  const used = new Set(design.layers.map((l) => l.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A new text layer of a role, styled after the design's title (font and colour), placed under the middle. */
export function newTextLayer(design: CoverDesign, role: CoverTextRole, text: string): CoverTextLayer {
  const title = design.layers.find((l): l is CoverTextLayer => l.kind === 'text' && l.role === 'title');
  return CoverTextLayerSchema.parse({
    kind: 'text',
    id: newLayerId(design, role),
    role,
    text,
    x: 50,
    y: 75,
    w: 60,
    font: title?.font ?? DEFAULT_COVER_FONT,
    weight: role === 'badge' ? 700 : 500,
    size: role === 'badge' ? 1.8 : 2.4,
    color: title?.color ?? '#ffffff',
    ...(role === 'badge' ? { band: { color: '#9b2c2c', opacity: 1, padding: 0.5, radius: 0.3 }, w: 30 } : {}),
  });
}

export function newShapeLayer(design: CoverDesign, kind: CoverShapeLayer['shape'], color: string): CoverShapeLayer {
  return shape({
    kind: 'shape',
    id: newLayerId(design, kind),
    shape: kind,
    x: 50,
    y: 50,
    w: kind === 'rule' ? 30 : 20,
    color,
  });
}

/**
 * One click, one palette: the ground, its ornaments and frame, and the type take a theme's colours — the title and
 * the body texts its ink, the original title and the credit's first line its ornament colour. An image ground keeps
 * its picture.
 */
export function applyTheme(design: CoverDesign, theme: ThemeColors): CoverDesign {
  return {
    ...design,
    background: {
      ...design.background,
      color: theme.bg,
      color2: theme.edge,
      patternColor: theme.ornament,
      frameColor: theme.ornament,
    },
    layers: design.layers.map((l) => {
      if (l.kind === 'shape') return { ...l, color: theme.ornament };
      if (l.kind === 'extra') return l;
      if (l.role === 'badge') return l;
      const color = l.role === 'original' || l.role === 'series' ? theme.ornament : theme.ink;
      return { ...l, color, accent: theme.ornament };
    }),
  };
}
