import {
  type CoverConcept,
  type CoverDesign,
  CoverDesignSchema,
  type CoverLayer,
  type CoverLayoutId,
  type CoverShapeLayer,
  type CoverTextLayer,
  CoverTextLayerSchema,
  type CoverTextRole,
} from '@dozabaneh/shared';
import { contrastRatio, mix, parseHex, readableInk, toHex } from './color';
import { type CoverTexts, DEFAULT_COVER_FONT, titleSize } from './defaults';
import { clamp, round } from './geometry';

/**
 * From an art director's concept to an editable design (ADR-048, stage 2): the app owns the geometry. Each layout
 * places the layers where a book designer would; the concept brings the palette, the faces, the ground and the
 * picture. Colours are checked here again — a concept that put mid-grey ink on a mid-grey ground gets readable ink.
 */
export interface LayoutSpec {
  id: CoverLayoutId;
  /** For the art director (English, like the prompt). */
  description: string;
  /** Where the type sits, so the picture keeps that part calm and the darkening goes there. */
  calm: 'top' | 'bottom' | 'middle' | 'all';
}

export const LAYOUTS: LayoutSpec[] = [
  {
    id: 'classic',
    description:
      'Centred and formal: a medallion ornament in the upper third, the title in the middle between fine rules, original title and authors below, the credit at the foot. Best on colour grounds with a pattern and a frame.',
    calm: 'middle',
  },
  {
    id: 'top-title',
    description:
      'The title block in the upper quarter; the picture or ground carries the lower two thirds; the credit at the foot. The picture must be calm at the top.',
    calm: 'top',
  },
  {
    id: 'bottom-title',
    description:
      'The picture fills the upper two thirds; the title block sits in the lower third over a darkened foot. The picture must be calm at the bottom.',
    calm: 'bottom',
  },
  {
    id: 'side',
    description:
      'Modern and asymmetric: a large title aligned to the right edge in the upper half under a short accent rule, the other texts aligned the same way, generous empty space on the left.',
    calm: 'top',
  },
  {
    id: 'big-type',
    description:
      'Typographic: the title very large across the middle, filling the width, almost nothing else. A strong colour ground; no picture or a very quiet one.',
    calm: 'all',
  },
  {
    id: 'band',
    description:
      'A picture over the whole cover and a solid band of the ground colour across the middle that carries the title; the other texts at the foot.',
    calm: 'bottom',
  },
];

const layoutSpec = (id: CoverLayoutId) => LAYOUTS.find((l) => l.id === id) ?? (LAYOUTS[0] as LayoutSpec);

type Place = Partial<CoverTextLayer> & Pick<CoverTextLayer, 'x' | 'y' | 'w'>;

/** Where each text goes in a layout, and its size relative to the classic cover's (title: × titleSize). */
const PLACES: Record<
  CoverLayoutId,
  { title: Place & { k: number }; original: Place; authors: Place; preparer: Place }
> = {
  classic: {
    title: { x: 50, y: 52, w: 66, k: 1 },
    original: { x: 50, y: 62, w: 66 },
    authors: { x: 50, y: 67.5, w: 66 },
    preparer: { x: 50, y: 86, w: 76 },
  },
  'top-title': {
    title: { x: 50, y: 17, w: 80, k: 1.12 },
    original: { x: 50, y: 27.5, w: 76 },
    authors: { x: 50, y: 32, w: 76 },
    preparer: { x: 50, y: 89, w: 76 },
  },
  'bottom-title': {
    title: { x: 50, y: 69, w: 80, k: 1.12 },
    original: { x: 50, y: 78.5, w: 76 },
    authors: { x: 50, y: 83, w: 76 },
    preparer: { x: 50, y: 92, w: 80, size: 2.3 },
  },
  side: {
    title: { x: 59, y: 31, w: 64, k: 1.15, align: 'right', lineHeight: 1.35 },
    original: { x: 59, y: 43, w: 64, align: 'right' },
    authors: { x: 59, y: 47.5, w: 64, align: 'right' },
    preparer: { x: 61, y: 87, w: 60, align: 'right' },
  },
  'big-type': {
    title: { x: 50, y: 45, w: 86, k: 1.6, lineHeight: 1.25 },
    original: { x: 50, y: 63, w: 76 },
    authors: { x: 50, y: 68, w: 76 },
    preparer: { x: 50, y: 88, w: 76 },
  },
  band: {
    title: { x: 50, y: 48, w: 100, k: 1.05 },
    original: { x: 50, y: 80, w: 76 },
    authors: { x: 50, y: 84.5, w: 76 },
    preparer: { x: 50, y: 92, w: 80, size: 2.3 },
  },
};

const ground = (p: CoverConcept['palette']) => mix(parseHex(p.ground), parseHex(p.ground2), 0.5);

const worstOn = (ink: string, a: string, b: string) =>
  Math.min(contrastRatio(parseHex(ink), parseHex(a)), contrastRatio(parseHex(ink), parseHex(b)));

/**
 * The palette with ink that reads on its ground (≥ 4.5) and an accent that shows (≥ 3). Ink is replaced by black or
 * white when it does not; a mid-tone ground that neither reaches is moved away from the ink, a step at a time.
 */
export function readablePalette(p: CoverConcept['palette']): CoverConcept['palette'] {
  if (worstOn(p.ink, p.ground, p.ground2) >= 4.5 && contrastRatio(parseHex(p.accent), ground(p)) >= 3) return p;
  const ink = worstOn(p.ink, p.ground, p.ground2) >= 4.5 ? p.ink : readableInk(ground(p));
  let g1 = p.ground;
  let g2 = p.ground2;
  const away = parseHex(ink === '#ffffff' ? '#000000' : '#ffffff');
  for (let i = 0; i < 8 && worstOn(ink, g1, g2) < 4.5; i++) {
    g1 = toHex(mix(away, parseHex(g1), 0.2));
    g2 = toHex(mix(away, parseHex(g2), 0.2));
  }
  const g = mix(parseHex(g1), parseHex(g2), 0.5);
  const accent =
    contrastRatio(parseHex(p.accent), g) >= 3 ? p.accent : toHex(mix(parseHex(ink), parseHex(p.accent), 0.6));
  return { ground: g1, ground2: g2, ink, accent };
}

function text(role: CoverTextRole, value: string, o: Place & Partial<CoverTextLayer>): CoverTextLayer {
  return CoverTextLayerSchema.parse({
    kind: 'text',
    id: role,
    role,
    text: value,
    font: DEFAULT_COVER_FONT,
    color: '#ffffff',
    size: 2,
    ...o,
    visible: o.visible ?? Boolean(value.trim()),
  });
}

const shape = (o: Omit<CoverShapeLayer, 'opacity' | 'visible' | 'locked' | 'thickness'> & Partial<CoverShapeLayer>) =>
  ({ opacity: 1, visible: true, locked: false, thickness: 0.8, ...o }) satisfies CoverShapeLayer;

/**
 * A concept as a design. `image` is the picture drawn for it, when there is one; without it an image concept keeps
 * a gradient of its palette (the owner can add a picture later).
 */
export function conceptToDesign(concept: CoverConcept, texts: CoverTexts, image?: string): CoverDesign {
  const palette = readablePalette(concept.palette);
  const spec = layoutSpec(concept.layout);
  const places = PLACES[concept.layout];
  const pictured = concept.ground === 'image' && Boolean(image);
  const title = texts.title ?? '';
  const titleFont = concept.titleFont || DEFAULT_COVER_FONT;
  const bodyFont = concept.bodyFont || DEFAULT_COVER_FONT;
  const { k, ...titlePlace } = places.title;
  const size = clamp(round(titleSize(title) * k * concept.titleScale, 2), 2.2, 12);

  const layers: CoverLayer[] = [];
  if (concept.layout === 'classic' && !pictured) {
    layers.push(
      shape({ kind: 'shape', id: 'medallion', shape: 'medallion', x: 50, y: 26, w: 30, color: palette.accent }),
    );
  }
  if (concept.layout === 'classic') {
    layers.push(shape({ kind: 'shape', id: 'rule-top', shape: 'rule', x: 50, y: 43.5, w: 26, color: palette.accent }));
  }
  if (concept.layout === 'side') {
    layers.push(shape({ kind: 'shape', id: 'rule-top', shape: 'rule', x: 81, y: 19, w: 20, color: palette.accent }));
  }
  layers.push(
    text('title', title, {
      ...titlePlace,
      size,
      font: titleFont,
      weight: concept.titleWeight,
      color: palette.ink,
      lineHeight: titlePlace.lineHeight ?? 1.45,
      ...(concept.layout === 'band'
        ? { band: { color: palette.ground, opacity: 0.9, padding: 0.7, radius: 0 } }
        : pictured
          ? { shadow: { color: '#000000', blur: 0.35, offset: 0.05, opacity: 0.45 } }
          : {}),
    }),
    text('original', texts.original ?? '', {
      ...places.original,
      size: 2.1,
      font: bodyFont,
      weight: 400,
      color: palette.accent,
      letterSpacing: 0.04,
      lineHeight: 1.4,
    }),
    text('authors', texts.authors ?? '', {
      ...places.authors,
      size: 1.85,
      font: bodyFont,
      weight: 400,
      color: palette.ink,
      opacity: 0.92,
    }),
    text('preparer', texts.preparer ?? '', {
      size: 2.6,
      ...places.preparer,
      font: bodyFont,
      weight: 700,
      color: palette.ink,
      lineStyle: 'credit',
      accent: palette.accent,
      lineHeight: 1.55,
    }),
  );

  // A picture is darkened (in the ground's colour) where the type sits, so the palette's ink reads on it.
  const dim = pictured
    ? spec.calm === 'top'
      ? { dim: 0.62, dimMode: 'top' as const }
      : spec.calm === 'bottom'
        ? { dim: 0.68, dimMode: 'bottom' as const }
        : { dim: concept.layout === 'band' ? 0.25 : 0.5, dimMode: 'flat' as const }
    : { dim: 0, dimMode: 'flat' as const };

  return CoverDesignSchema.parse({
    background: {
      kind: pictured ? 'image' : concept.ground === 'solid' ? 'solid' : 'gradient',
      color: palette.ground,
      color2: concept.ground === 'solid' ? palette.ground : palette.ground2,
      gradient: 'radial',
      image: pictured ? image : null,
      pattern: pictured ? 'none' : concept.pattern,
      patternColor: palette.accent,
      patternOpacity: 0.2,
      frame: concept.frame,
      frameColor: palette.accent,
      dimColor: palette.ground,
      ...dim,
    },
    layers,
  });
}

/**
 * What the illustrator is asked: the art director's picture, the shape of the cover, where the type will go, and —
 * firmly — no lettering of any kind.
 */
export function paintPrompt(concept: CoverConcept): string {
  const calm = layoutSpec(concept.layout).calm;
  const space =
    calm === 'top'
      ? 'Keep the upper third calm and uncluttered.'
      : calm === 'bottom'
        ? 'Keep the lower third calm and uncluttered.'
        : calm === 'middle'
          ? 'Keep the centre calm and uncluttered.'
          : 'Keep the whole picture quiet and simple.';
  return [
    concept.imagePrompt.trim(),
    'Book cover artwork, vertical portrait composition, full bleed, high quality, refined.',
    space,
    'Absolutely no text, no letters, no words, no numbers, no typography, no title, no logo, no watermark, no signature, no frame, no book mockup.',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2000);
}

/** Words of the app's own designer (from the UI catalogue), one per concept it can make. */
export interface BasicWords {
  name: string;
  why: string;
}

const BASIC: Omit<CoverConcept, 'name' | 'rationale' | 'titleFont' | 'bodyFont'>[] = [
  {
    layout: 'classic',
    palette: { ground: '#16264a', ground2: '#0b1530', ink: '#f6f1e3', accent: '#c9a54a' },
    ground: 'gradient',
    pattern: 'stars',
    frame: 'double',
    titleWeight: 800,
    titleScale: 1,
    imagePrompt: '',
  },
  {
    layout: 'side',
    palette: { ground: '#f3ecdc', ground2: '#ebe1c9', ink: '#1d2740', accent: '#9b2c2c' },
    ground: 'gradient',
    pattern: 'none',
    frame: 'none',
    titleWeight: 900,
    titleScale: 1,
    imagePrompt: '',
  },
  {
    layout: 'big-type',
    palette: { ground: '#0d4a45', ground2: '#062b28', ink: '#f3efe2', accent: '#d2b25c' },
    ground: 'gradient',
    pattern: 'dots',
    frame: 'corners',
    titleWeight: 900,
    titleScale: 1,
    imagePrompt: '',
  },
  {
    layout: 'top-title',
    palette: { ground: '#5a1628', ground2: '#310a15', ink: '#f7efe4', accent: '#d4a95a' },
    ground: 'gradient',
    pattern: 'diagonal',
    frame: 'single',
    titleWeight: 800,
    titleScale: 1,
    imagePrompt: '',
  },
  {
    layout: 'bottom-title',
    palette: { ground: '#1f2a33', ground2: '#0f161c', ink: '#ffffff', accent: '#e0a458' },
    ground: 'gradient',
    pattern: 'grid',
    frame: 'none',
    titleWeight: 800,
    titleScale: 1,
    imagePrompt: '',
  },
];

/**
 * The app's own designer, for when no AI engine is connected: curated pairings of layout, palette and faces, a
 * different set each round. Pictures need an art director's description, so these use colour grounds.
 */
export function basicConcepts(
  words: BasicWords[],
  fonts: { title: string[]; body: string },
  count: number,
  round = 0,
): CoverConcept[] {
  return Array.from({ length: count }, (_, i) => {
    const n = (round * count + i) % BASIC.length;
    const base = BASIC[n] as (typeof BASIC)[number];
    const w = words[n % Math.max(1, words.length)] ?? { name: base.layout, why: '' };
    return {
      ...base,
      name: w.name,
      rationale: w.why,
      titleFont: fonts.title[n % Math.max(1, fonts.title.length)] ?? fonts.body,
      bodyFont: fonts.body,
    };
  });
}
