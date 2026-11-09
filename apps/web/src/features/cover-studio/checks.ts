import { type Box, MIN_CONTRAST, outsideSafe, regionColors, rgba, textContrast } from '@dozabaneh/cover';
import type { CoverBackground, CoverDesign } from '@dozabaneh/shared';
import { useEffect, useState } from 'react';
import { coverImageFileUrl } from '../../lib/api';
import type { LayerBoxes } from './CoverView';

/**
 * The editor's quality checks (ADR-048): the ground is painted on a small canvas (colours, gradient, the image with
 * its focus, zoom, blur and darkening — the ornament lines are too thin to matter), and the cells under each text
 * layer are measured against its ink; layers outside the safe area are listed too.
 */
export interface CoverIssue {
  layer: string;
  kind: 'contrast' | 'safe';
  /** The contrast ratio, for a contrast issue. */
  ratio?: number;
}

const W = 160;
const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

/** Paints the ground on a canvas the way the cover's CSS does. */
export async function paintGround(bg: CoverBackground, bookId: string, aspect: number): Promise<ImageData | null> {
  const H = Math.round(W / aspect);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = bg.color;
  ctx.fillRect(0, 0, W, H);
  if (bg.kind === 'gradient' && bg.gradient === 'linear') {
    const a = (bg.angle * Math.PI) / 180;
    const len = Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a));
    const dx = (Math.sin(a) * len) / 2;
    const dy = (-Math.cos(a) * len) / 2;
    const g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    g.addColorStop(0, bg.color);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (bg.kind === 'gradient') {
    // «ellipse at 50% 35%» to the farthest corner, drawn as a circle stretched vertically.
    const cx = W / 2;
    const cy = H * 0.35;
    const rx = Math.max(cx, W - cx) * Math.SQRT2;
    const ry = Math.max(cy, H - cy) * Math.SQRT2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, bg.color);
    g.addColorStop(0.45, bg.color);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx);
    ctx.restore();
  } else if (bg.kind === 'image' && bg.image) {
    const img = await loadImage(coverImageFileUrl(bookId, bg.image));
    if (img?.naturalWidth) {
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      const fx = bg.focusX / 100;
      const fy = bg.focusY / 100;
      const ox = (W - dw) * fx;
      const oy = (H - dh) * fy;
      const zoom = bg.zoom * (1 + bg.blur * 0.06);
      ctx.save();
      // CSS: transform-origin at the focus point of the box, then scale.
      ctx.translate(W * fx, H * fy);
      ctx.scale(zoom, zoom);
      ctx.translate(-W * fx, -H * fy);
      if (bg.blur > 0) ctx.filter = `blur(${(bg.blur / 100) * W}px)`;
      ctx.drawImage(img, ox, oy, dw, dh);
      ctx.restore();
    }
  }
  if (bg.dim > 0) {
    if (bg.dimMode === 'flat') {
      ctx.fillStyle = rgba(bg.dimColor, bg.dim);
    } else {
      const g = bg.dimMode === 'bottom' ? ctx.createLinearGradient(0, H, 0, 0) : ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, rgba(bg.dimColor, bg.dim));
      g.addColorStop(0.4, rgba(bg.dimColor, bg.dim * 0.65));
      g.addColorStop(0.8, rgba(bg.dimColor, 0));
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, W, H);
  }
  try {
    return ctx.getImageData(0, 0, W, H);
  } catch {
    return null; // a picture from elsewhere taints the canvas
  }
}

export function findIssues(
  design: CoverDesign,
  boxes: LayerBoxes,
  aspect: number,
  ground: ImageData | null,
): CoverIssue[] {
  const issues: CoverIssue[] = [];
  for (const l of design.layers) {
    const box: Box | undefined = boxes[l.id];
    if (!l.visible || !box || (l.kind === 'text' && !l.text.trim())) continue;
    if (outsideSafe(box, aspect)) issues.push({ layer: l.id, kind: 'safe' });
    if (l.kind === 'text' && ground) {
      const cells = regionColors(ground, box);
      const ratio = textContrast(l.color, cells, { band: l.band, stroke: l.stroke });
      if (ratio < MIN_CONTRAST) issues.push({ layer: l.id, kind: 'contrast', ratio: Math.round(ratio * 10) / 10 });
    }
  }
  return issues;
}

/** The issues of the design being edited, measured a moment after it stops changing. */
export function useCoverIssues(design: CoverDesign, boxes: LayerBoxes, aspect: number, bookId: string): CoverIssue[] {
  const [ground, setGround] = useState<ImageData | null>(null);
  const [issues, setIssues] = useState<CoverIssue[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void paintGround(design.background, bookId, aspect).then((g) => {
        if (live) setGround(g);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [design.background, bookId, aspect]);
  useEffect(() => {
    const t = setTimeout(() => setIssues(findIssues(design, boxes, aspect, ground)), 200);
    return () => clearTimeout(t);
  }, [design, boxes, aspect, ground]);
  return issues;
}
