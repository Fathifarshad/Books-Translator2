import { z } from 'zod';

/**
 * «استودیوی جلد» (ADR-048): a book cover as data — a background and a stack of layers (texts and ornaments), each
 * placed in percentages of the cover so one design fits A4, «وزیری» and «رقعی» alike. Type sizes are percentages of
 * the cover's width (CSS `cqw`), so the editor's preview and the printed PDF are the same picture at any scale.
 * The editor, the server that saves and prints it, and the AI designer (stage 2) share these shapes.
 */
export const COVER_DESIGN_VERSION = 1;

const Hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((s) => s.toLowerCase());
/** Ids of layers, images and fonts: short, URL-safe, never a path. */
export const CoverIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

/** What a text layer says: the book's title, its original title, … — or free text («text»). */
export const COVER_TEXT_ROLES = [
  'title',
  'subtitle',
  'original',
  'authors',
  'preparer',
  'publisher',
  'series',
  'badge',
  'text',
] as const;
export type CoverTextRole = (typeof COVER_TEXT_ROLES)[number];

export const COVER_SHAPES = ['medallion', 'star', 'rule', 'ring', 'diamond'] as const;
export type CoverShape = (typeof COVER_SHAPES)[number];

export const COVER_ALIGNS = ['left', 'center', 'right'] as const;
export type CoverAlign = (typeof COVER_ALIGNS)[number];

/**
 * «uniform»: every line alike. «credit»: the line of a credit — a small first line in the accent colour (the role,
 * «ترجمه و تدوین»), the name at full size, and smaller lines after it (the preparer's titles).
 */
export const COVER_LINE_STYLES = ['uniform', 'credit'] as const;

const Placement = {
  /** Centre of the layer, in % of the cover's width (x) and height (y); a little outside is allowed (bleed). */
  x: z.number().min(-20).max(120),
  y: z.number().min(-20).max(120),
  /** Width of the layer in % of the cover's width. */
  w: z.number().min(2).max(140),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  /** A locked layer is not moved by dragging (it can still be selected and edited). */
  locked: z.boolean().default(false),
};

export const CoverStrokeSchema = z.object({ color: Hex, width: z.number().min(0).max(0.2) });
export const CoverShadowSchema = z.object({
  color: Hex,
  /** Blur and offset in em of the layer's type, so they grow with it. */
  blur: z.number().min(0).max(1.5),
  offset: z.number().min(0).max(0.4),
  opacity: z.number().min(0).max(1),
});
export const CoverBandSchema = z.object({
  color: Hex,
  opacity: z.number().min(0).max(1),
  /** Padding and corner radius in em of the layer's type. */
  padding: z.number().min(0).max(2),
  radius: z.number().min(0).max(1),
});

export const CoverTextLayerSchema = z.object({
  kind: z.literal('text'),
  id: CoverIdSchema,
  role: z.enum(COVER_TEXT_ROLES),
  text: z.string().max(600),
  ...Placement,
  align: z.enum(COVER_ALIGNS).default('center'),
  font: CoverIdSchema,
  weight: z.number().int().min(100).max(900).default(700),
  /** Type size in % of the cover's width. */
  size: z.number().min(0.6).max(30),
  color: Hex,
  lineHeight: z.number().min(0.7).max(3).default(1.5),
  /** Letter spacing in em; Persian letters stay joined (applied to non-joining scripts only by the browser). */
  letterSpacing: z.number().min(-0.1).max(0.6).default(0),
  lineStyle: z.enum(COVER_LINE_STYLES).default('uniform'),
  /** Colour of a credit's first line. */
  accent: Hex.default('#c9a54a'),
  stroke: CoverStrokeSchema.nullable().default(null),
  shadow: CoverShadowSchema.nullable().default(null),
  band: CoverBandSchema.nullable().default(null),
});
export type CoverTextLayer = z.infer<typeof CoverTextLayerSchema>;

export const CoverShapeLayerSchema = z.object({
  kind: z.literal('shape'),
  id: CoverIdSchema,
  shape: z.enum(COVER_SHAPES),
  ...Placement,
  color: Hex,
  /** Line width in % of the shape's own width. */
  thickness: z.number().min(0.1).max(10).default(0.8),
});
export type CoverShapeLayer = z.infer<typeof CoverShapeLayerSchema>;

export const CoverLayerSchema = z.discriminatedUnion('kind', [CoverTextLayerSchema, CoverShapeLayerSchema]);
export type CoverLayer = z.infer<typeof CoverLayerSchema>;

export const COVER_BG_KINDS = ['solid', 'gradient', 'image'] as const;
export const COVER_GRADIENTS = ['linear', 'radial'] as const;
export const COVER_PATTERNS = ['none', 'stars', 'grid', 'dots', 'diagonal'] as const;
export type CoverPattern = (typeof COVER_PATTERNS)[number];
export const COVER_FRAMES = ['none', 'single', 'double', 'corners'] as const;
export type CoverFrame = (typeof COVER_FRAMES)[number];
/** How an image is darkened for the type on it: evenly, or deeper towards the foot or the head. */
export const COVER_DIM_MODES = ['flat', 'bottom', 'top'] as const;

export const CoverBackgroundSchema = z.object({
  kind: z.enum(COVER_BG_KINDS).default('gradient'),
  color: Hex.default('#16264a'),
  color2: Hex.default('#0b1530'),
  gradient: z.enum(COVER_GRADIENTS).default('radial'),
  angle: z.number().min(0).max(360).default(180),
  /** An image of this book's cover images (uploaded or drawn by AI). */
  image: CoverIdSchema.nullable().default(null),
  /** The point of the image kept in view, in %, and how far it is enlarged. */
  focusX: z.number().min(0).max(100).default(50),
  focusY: z.number().min(0).max(100).default(50),
  zoom: z.number().min(1).max(4).default(1),
  /** Blur in % of the cover's width. */
  blur: z.number().min(0).max(3).default(0),
  dim: z.number().min(0).max(0.9).default(0),
  dimColor: Hex.default('#000000'),
  dimMode: z.enum(COVER_DIM_MODES).default('flat'),
  pattern: z.enum(COVER_PATTERNS).default('none'),
  patternColor: Hex.default('#c9a54a'),
  patternOpacity: z.number().min(0).max(1).default(0.22),
  frame: z.enum(COVER_FRAMES).default('none'),
  frameColor: Hex.default('#c9a54a'),
});
export type CoverBackground = z.infer<typeof CoverBackgroundSchema>;

export const CoverDesignSchema = z.object({
  v: z.literal(COVER_DESIGN_VERSION).default(COVER_DESIGN_VERSION),
  background: CoverBackgroundSchema.default(CoverBackgroundSchema.parse({})),
  /** Painted in order: the last layer is on top. */
  layers: z.array(CoverLayerSchema).max(40),
});
export type CoverDesign = z.infer<typeof CoverDesignSchema>;
export type CoverDesignInput = z.input<typeof CoverDesignSchema>;

/** A design kept for later books: its texts are replaced by the next book's own (by role). */
export const CoverTemplateSchema = z.object({
  id: CoverIdSchema,
  name: z.string().trim().min(1).max(80),
  createdAt: z.string(),
  design: CoverDesignSchema,
});
export type CoverTemplate = z.infer<typeof CoverTemplateSchema>;

export const CoverTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  design: CoverDesignSchema,
});

export const CoverDesignSaveSchema = z.object({
  lang: z.string().min(2).max(12).optional(),
  design: CoverDesignSchema,
});

/** A typeface the cover can use: shipped with the app (free licence) or installed on this computer. */
export interface CoverFont {
  id: string;
  /** The family's own name, e.g. «B Titr», «Estedad». */
  family: string;
  source: 'bundled' | 'system';
  /** Weights available (others are synthesised by the browser). */
  weights: number[];
  /** A rough class for grouping in the picker. */
  category: 'sans' | 'serif' | 'display' | 'nastaliq' | 'other';
}

export interface CoverImage {
  id: string;
  source: 'upload' | 'ai';
  createdAt: string;
  /** For an AI image: what it was asked to draw. */
  prompt?: string;
}

export interface CoverDesignView {
  design: CoverDesign;
  /** The design was saved by the owner (else it is the default made from the book). */
  saved: boolean;
  /** The book's own texts per role, for «reset to the book's text». */
  texts: Partial<Record<CoverTextRole, string>>;
  images: CoverImage[];
}

// ── The printer's wrap (ADR-048, stage 3) ───────────────────────────────────────────────────────────────────────

/** Papers whose thickness sets the spine (packages/cover `PAPERS` holds the numbers). */
export const COVER_PAPERS = ['tahrir70', 'bulk80', 'glossy115'] as const;
export type CoverPaperId = (typeof COVER_PAPERS)[number];

/**
 * What the printer needs besides the two designs: paper and bleed, the pages that set the spine, the back cover's
 * blurb, ISBN, price and the publisher's logo (one of the book's cover images). Saved per book and language in
 * `books.settings.coverPrint`.
 */
export const CoverPrintSchema = z.object({
  paper: z.enum(COVER_PAPERS).default('tahrir70'),
  /** Thickness of one leaf (two pages) in mm, when the printer's paper is not one of the three. */
  leafMm: z.number().min(0.04).max(0.4).nullable().default(null),
  /** The book's page count when it has not been built (else the last build's count is used). */
  pages: z.number().int().min(4).max(4000).nullable().default(null),
  bleedMm: z.number().min(0).max(10).default(3),
  cropMarks: z.boolean().default(false),
  /** Title and author on the spine (drawn only when the spine is wide enough). */
  spineText: z.boolean().default(true),
  blurb: z.string().max(1500).default(''),
  /** A line set above the blurb. */
  tagline: z.string().max(160).default(''),
  isbn: z.string().max(24).default(''),
  price: z.string().max(60).default(''),
  barcode: z.boolean().default(true),
  logo: CoverIdSchema.nullable().default(null),
});
export type CoverPrint = z.infer<typeof CoverPrintSchema>;

export const CoverPrintSaveSchema = z.object({
  lang: z.string().min(2).max(12).optional(),
  print: CoverPrintSchema,
  /** The back cover's own design; omitted = keep, null = go back to the one made from the front. */
  back: CoverDesignSchema.nullable().optional(),
});

export interface CoverBlurbResult {
  blurb: string;
  tagline: string;
  /** `ai`: written by the book's engine; `brief`: cut from the book's own brief (no engine connected or it failed). */
  source: 'ai' | 'brief' | 'none';
  message?: string;
}

export interface CoverPrintView {
  print: CoverPrint;
  /** The back cover's design: the saved one, or the one made from the front and the blurb. */
  back: CoverDesign;
  backSaved: boolean;
  /** Pages of the last «کتاب PDF» build, if any. */
  builtPages: number | null;
  /** Pages used for the spine: the owner's number, else the build's; null = unknown. */
  pages: number | null;
  leafMm: number;
  spineMm: number | null;
  /** The printed sheet in mm (bleed and crop-mark margin included); null while the spine is unknown. */
  sheet: { width: number; height: number } | null;
  /** The ISBN as typed: valid 13 digits, or why not. */
  isbn: { state: 'empty' | 'valid' | 'bad-check' | 'bad-format'; digits: string | null };
  /** The back's texts the AI can fill: the book's own brief exists. */
  hasBrief: boolean;
}

export const CoverBlurbRequestSchema = z.object({
  lang: z.string().min(2).max(12).optional(),
  /** The owner's wishes («کوتاه و ساده، برای دانشجویان»). */
  request: z.string().max(400).optional(),
});
export type CoverBlurbRequest = z.infer<typeof CoverBlurbRequestSchema>;
