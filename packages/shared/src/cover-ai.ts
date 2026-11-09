import { z } from 'zod';
import { COVER_FRAMES, COVER_PATTERNS, type CoverDesign } from './cover';

/**
 * «طراحی خودکار جلد» (ADR-048, stage 2): an art director — the book's AI engine, through the shared `cover_design`
 * task and `prompts/cover.md` — proposes distinct cover concepts (layout, palette, faces, ornament, the picture to
 * draw), the app turns each into an editable design, and an illustrator draws its picture without any lettering:
 * Cloudflare Workers AI (free daily allowance) or a model on this computer (ComfyUI). Type is always set by the app,
 * because image models do not write Persian.
 */

/** Layouts the art director chooses from; the app places the layers of each (packages/cover presets). */
export const COVER_LAYOUTS = ['classic', 'top-title', 'bottom-title', 'side', 'big-type', 'band'] as const;
export type CoverLayoutId = (typeof COVER_LAYOUTS)[number];

/** No transform here: task schemas are sent to the engines as JSON Schema, which cannot carry one. */
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ── The `cover_design` task ─────────────────────────────────────────────────────────────────────────────────────

export const CoverDesignTaskInputSchema = z.object({
  title: z.string(),
  original: z.string(),
  authors: z.string(),
  /** What the book is about: its brief, or its chapter titles. */
  subject: z.string(),
  /** The owner's wishes for this round («سبز و آرام، حال‌وهوای پزشکی»); may be empty. */
  request: z.string(),
  count: z.number().int().min(1).max(6),
  layouts: z.array(z.object({ id: z.enum(COVER_LAYOUTS), description: z.string() })).min(1),
  fonts: z.array(z.object({ id: z.string(), family: z.string(), category: z.string() })).min(1),
  /** Names of concepts already shown, so a new round goes elsewhere. */
  avoid: z.array(z.string()),
  /** A picture can be drawn (an illustrator is connected); otherwise only colour grounds make sense. */
  canPaint: z.boolean(),
});
export type CoverDesignTaskInput = z.infer<typeof CoverDesignTaskInputSchema>;

export const CoverConceptSchema = z.object({
  /** A short name in the book's language («آرامش آبی»). */
  name: z.string().trim().min(1).max(60),
  /** Why it fits the book, in the book's language, one or two sentences. */
  rationale: z.string().trim().max(500),
  layout: z.enum(COVER_LAYOUTS),
  palette: z.object({ ground: Hex, ground2: Hex, ink: Hex, accent: Hex }),
  ground: z.enum(['image', 'gradient', 'solid']),
  pattern: z.enum(COVER_PATTERNS),
  frame: z.enum(COVER_FRAMES),
  titleFont: z.string().min(1).max(64),
  bodyFont: z.string().min(1).max(64),
  titleWeight: z.number().int().min(100).max(900),
  /** Title size relative to the layout's own (1 = as designed). */
  titleScale: z.number().min(0.6).max(1.6),
  /** The picture, in English, with no lettering of any kind; empty for a colour ground. */
  imagePrompt: z.string().max(1200),
});
export type CoverConcept = z.infer<typeof CoverConceptSchema>;

export const CoverDesignTaskResultSchema = z.object({ concepts: z.array(CoverConceptSchema).min(1).max(6) });
export type CoverDesignTaskResult = z.infer<typeof CoverDesignTaskResultSchema>;

// ── The illustrator ─────────────────────────────────────────────────────────────────────────────────────────────

export const PAINTER_ENGINES = ['none', 'cloudflare', 'comfy'] as const;
export type PainterEngine = (typeof PAINTER_ENGINES)[number];

/** Cloudflare's FLUX models: portrait FLUX.2 klein (≈ 60 covers a day free) or square FLUX.1 schnell (≈ 500). */
export const CLOUDFLARE_IMAGE_MODELS = ['flux-2-klein-4b', 'flux-1-schnell'] as const;
export type CloudflareImageModel = (typeof CLOUDFLARE_IMAGE_MODELS)[number];

export const PainterUpdateSchema = z.object({
  /** Which illustrator draws first; the other connected one is tried when it fails. */
  engine: z.enum(PAINTER_ENGINES).optional(),
  cloudflareAccountId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/i)
    .nullable()
    .optional(),
  /** null removes the stored token. */
  cloudflareToken: z.string().trim().min(20).max(300).nullable().optional(),
  cloudflareModel: z.enum(CLOUDFLARE_IMAGE_MODELS).optional(),
  comfyUrl: z.url().max(300).optional(),
  comfyCheckpoint: z.string().trim().max(300).optional(),
});
export type PainterUpdate = z.infer<typeof PainterUpdateSchema>;

export interface PainterView {
  engine: PainterEngine;
  cloudflare: { accountId: string | null; hasToken: boolean; tokenHint: string | null; model: CloudflareImageModel };
  comfy: { url: string; checkpoint: string };
}

export interface PainterTestResult {
  ok: boolean;
  engine: PainterEngine;
  /** Error code: AUTH, NETWORK, QUOTA, NOT_CONFIGURED, NO_CHECKPOINT, BAD_RESPONSE, … */
  error?: string;
  message?: string;
  /** ComfyUI: the checkpoints it has. */
  checkpoints?: string[];
  ms?: number;
}

// ── A design round ──────────────────────────────────────────────────────────────────────────────────────────────

export const CoverAiRequestSchema = z.object({
  lang: z.string().min(2).max(12).optional(),
  request: z.string().trim().max(500).default(''),
  count: z.number().int().min(1).max(6).default(3),
});

export interface CoverAiOption {
  id: string;
  concept: CoverConcept;
  design: CoverDesign;
  /** The picture: drawing, drawn, or failed (the design then keeps its colour ground). */
  image: 'none' | 'pending' | 'done' | 'failed';
  imageError?: string;
}

export interface CoverAiStatus {
  state: 'idle' | 'designing' | 'painting' | 'done' | 'failed';
  /** Who designed: the AI engine (its id), or the app's own designer when no engine is connected. */
  designer?: string;
  painter: PainterEngine;
  options: CoverAiOption[];
  error?: string;
  message?: string;
  startedAt?: string;
}
