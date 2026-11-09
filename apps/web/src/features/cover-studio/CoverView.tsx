import {
  type Box,
  backgroundMarkup,
  COVER_STYLE,
  coverFontFamily,
  layersMarkup,
  type RenderEnv,
} from '@dozabaneh/cover';
import type { CoverDesign } from '@dozabaneh/shared';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { coverImageFileUrl, fontsCssUrl } from '../../lib/api';

/**
 * A cover drawn by the same renderer the book is printed with (ADR-048), inside a shadow root so the app's own CSS
 * cannot touch it. The fonts' `@font-face` rules live in the document (a shadow root cannot declare fonts) and every
 * face is loaded only when a layer uses it. `onLayout` reports where each layer landed, in % of the cover, for the
 * editor's handles and checks.
 */
export function ensureCoverFonts(): void {
  if (document.getElementById('cv-fonts')) return;
  const link = document.createElement('link');
  link.id = 'cv-fonts';
  link.rel = 'stylesheet';
  link.href = fontsCssUrl();
  document.head.appendChild(link);
}

export function coverEnv(bookId: string): RenderEnv {
  return { imageUrl: (id) => coverImageFileUrl(bookId, id), fontFamily: coverFontFamily };
}

export type LayerBoxes = Record<string, Box>;

const SHADOW_CSS = `${COVER_STYLE}
:host { display: block; }
.cv-cover { position: absolute; inset: 0; }
.cv-bgwrap, .cv-layers { position: absolute; inset: 0; }`;

export function CoverView(props: {
  design: CoverDesign;
  bookId: string;
  /** Width ÷ height of the page. */
  aspect: number;
  onLayout?: (boxes: LayerBoxes) => void;
  className?: string;
  uid?: string;
  testId?: string;
}) {
  const { design, bookId, aspect, onLayout, className = '', uid = 'view', testId } = props;
  const host = useRef<HTMLDivElement>(null);
  const parts = useRef<{ bg: HTMLDivElement; layers: HTMLDivElement } | null>(null);
  const layout = useRef(onLayout);
  layout.current = onLayout;
  const env = useMemo(() => coverEnv(bookId), [bookId]);
  const bg = useMemo(() => backgroundMarkup(design.background, env, uid), [design.background, env, uid]);
  const layers = useMemo(() => layersMarkup(design, env), [design, env]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || parts.current) return;
    ensureCoverFonts();
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${SHADOW_CSS}</style><div class="cv-cover"><div class="cv-bgwrap"></div><div class="cv-layers"></div></div>`;
    parts.current = {
      bg: root.querySelector('.cv-bgwrap') as HTMLDivElement,
      layers: root.querySelector('.cv-layers') as HTMLDivElement,
    };
  }, []);

  const measure = useRef(() => {});
  measure.current = () => {
    const el = host.current;
    const root = el?.shadowRoot;
    if (!el || !root || !layout.current) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const boxes: LayerBoxes = {};
    for (const node of root.querySelectorAll<HTMLElement>('[data-layer]')) {
      const b = node.getBoundingClientRect();
      const id = node.dataset.layer ?? '';
      boxes[id] = {
        x: ((b.left + b.width / 2 - r.left) / r.width) * 100,
        y: ((b.top + b.height / 2 - r.top) / r.height) * 100,
        w: (b.width / r.width) * 100,
        h: (b.height / r.height) * 100,
      };
    }
    layout.current(boxes);
  };

  useLayoutEffect(() => {
    if (parts.current && parts.current.bg.innerHTML !== bg) parts.current.bg.innerHTML = bg;
  }, [bg]);

  useLayoutEffect(() => {
    if (!parts.current) return;
    parts.current.layers.innerHTML = layers;
    measure.current();
  }, [layers]);

  // Type that arrives later (a font loaded, the frame resized) moves the layers: measure again.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const again = () => measure.current();
    const ro = new ResizeObserver(again);
    ro.observe(el);
    document.fonts?.addEventListener?.('loadingdone', again);
    const t = setTimeout(again, 400);
    return () => {
      ro.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', again);
      clearTimeout(t);
    };
  }, []);

  return (
    <div
      ref={host}
      className={`relative overflow-hidden bg-white ${className}`}
      style={{ aspectRatio: String(aspect) }}
      data-testid={testId}
    />
  );
}
