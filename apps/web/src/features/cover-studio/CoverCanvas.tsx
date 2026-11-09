import { type Box, clamp, type Guide, nudge, round, SAFE_MARGIN, safeMarginY, snapBox } from '@dozabaneh/cover';
import type { CoverDesign, CoverExtraLayer, CoverLayer } from '@dozabaneh/shared';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CoverView, type LayerBoxes } from './CoverView';

export type DesignUpdate = (fn: (d: CoverDesign) => CoverDesign, key?: string) => void;

export const updateLayer = (d: CoverDesign, id: string, patch: Partial<CoverLayer>): CoverDesign => ({
  ...d,
  layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as CoverLayer) : l)),
});

/**
 * The cover being edited: click a layer to select it, drag it (it snaps to the centre, the thirds, the safe area and
 * the other layers — hold Alt to place it freely), widen it from its sides, move it with the arrow keys (Shift: in
 * larger steps), Delete removes it. The dashed frame is the safe area: type outside it may be cut by the binder.
 */
export function CoverCanvas(props: {
  design: CoverDesign;
  bookId: string;
  extraLayer?: ((l: CoverExtraLayer) => string) | undefined;
  aspect: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  update: DesignUpdate;
  onRemove: (id: string) => void;
  guides: boolean;
  /** Layers outside the safe area or hard to read: outlined in the warning colour. */
  flagged: Set<string>;
  boxes: LayerBoxes;
  onLayout: (boxes: LayerBoxes) => void;
}) {
  const { t } = useTranslation();
  const { design, bookId, aspect, selected, onSelect, update, onRemove, guides, flagged, boxes, onLayout, extraLayer } =
    props;
  const frame = useRef<HTMLDivElement>(null);
  const [snapGuides, setSnapGuides] = useState<Guide[]>([]);
  const drag = useRef<null | {
    id: string;
    mode: 'move' | 'left' | 'right';
    px: number;
    py: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }>(null);

  const visible = design.layers.filter(
    (l) => l.visible && (l.kind !== 'text' || l.text.trim()) && boxes[l.id] !== undefined,
  );

  const begin = (e: PointerEvent, layer: CoverLayer, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    onSelect(layer.id);
    frame.current?.focus({ preventScroll: true });
    if (layer.locked) return;
    const box = boxes[layer.id];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      id: layer.id,
      mode,
      px: e.clientX,
      py: e.clientY,
      x: layer.x,
      y: layer.y,
      w: layer.w,
      h: box?.h ?? 5,
    };
  };

  const move = (e: PointerEvent) => {
    const d = drag.current;
    const rect = frame.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dx = ((e.clientX - d.px) / rect.width) * 100;
    const dy = ((e.clientY - d.py) / rect.height) * 100;
    if (d.mode === 'move') {
      const others: Box[] = visible
        .filter((l) => l.id !== d.id)
        .flatMap((l) => (boxes[l.id] ? [boxes[l.id] as Box] : []));
      const free = { x: d.x + dx, y: d.y + dy, w: d.w, h: d.h };
      const s = e.altKey ? { x: round(free.x), y: round(free.y), guides: [] } : snapBox(free, others, aspect);
      setSnapGuides(s.guides);
      update((des) => updateLayer(des, d.id, { x: clamp(s.x, -20, 120), y: clamp(s.y, -20, 120) }), `move:${d.id}`);
    } else {
      // Sides widen the layer symmetrically around its centre.
      const w = clamp(round(d.w + (d.mode === 'right' ? 2 * dx : -2 * dx)), 4, 140);
      update((des) => updateLayer(des, d.id, { w }), `width:${d.id}`);
    }
  };

  const end = () => {
    drag.current = null;
    setSnapGuides([]);
  };

  const onKey = (e: KeyboardEvent) => {
    const layer = design.layers.find((l) => l.id === selected);
    if (!layer) return;
    if (e.key === 'Escape') return onSelect(null);
    if ((e.key === 'Delete' || e.key === 'Backspace') && !layer.locked) {
      e.preventDefault();
      return onRemove(layer.id);
    }
    if (layer.locked) return;
    const next = nudge(layer, e.key, e.shiftKey);
    if (next) {
      e.preventDefault();
      update((d) => updateLayer(d, layer.id, next), `nudge:${layer.id}`);
    }
  };

  const my = safeMarginY(aspect);
  return (
    <div
      ref={frame}
      // A cover is a picture: its x runs left to right whatever the language of the page.
      dir="ltr"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas takes the arrow keys for the selected layer
      tabIndex={0}
      role="application"
      aria-label={t('coverStudio.canvas')}
      onKeyDown={onKey}
      onPointerDown={() => onSelect(null)}
      className="relative mx-auto w-full touch-none rounded-sm shadow-[0_8px_30px_rgb(0_0_0/0.25)] outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      data-testid="cover-canvas"
    >
      <CoverView
        design={design}
        bookId={bookId}
        aspect={aspect}
        onLayout={onLayout}
        extraLayer={extraLayer}
        uid="edit"
        testId="cover-render"
      />
      <div className="pointer-events-none absolute inset-0">
        {guides ? (
          <div
            className="absolute border border-dashed border-sky-400/80"
            style={{ inset: `${my}% ${SAFE_MARGIN}%` }}
            data-testid="safe-area"
          />
        ) : null}
        {snapGuides.map((g) => (
          <div
            key={`${g.axis}${g.at}`}
            className={`absolute ${g.kind === 'safe' ? 'bg-sky-400' : 'bg-fuchsia-500'}`}
            style={
              g.axis === 'x'
                ? { insetInlineStart: `${g.at}%`, top: 0, bottom: 0, width: 1 }
                : { top: `${g.at}%`, insetInline: 0, height: 1 }
            }
          />
        ))}
      </div>
      {visible.map((l) => {
        const b = boxes[l.id] as Box;
        const isSel = l.id === selected;
        return (
          <div
            key={l.id}
            className={`absolute ${l.locked ? 'cursor-default' : 'cursor-move'} rounded-[2px] ${
              isSel
                ? 'outline outline-2 outline-accent'
                : flagged.has(l.id)
                  ? 'outline outline-2 outline-dashed outline-warning'
                  : 'hover:outline hover:outline-1 hover:outline-accent/70'
            }`}
            style={{
              insetInlineStart: `${b.x - b.w / 2}%`,
              top: `${b.y - b.h / 2}%`,
              width: `${b.w}%`,
              height: `${b.h}%`,
            }}
            onPointerDown={(e) => begin(e, l, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            data-testid={`hit-${l.id}`}
          >
            {isSel && !l.locked
              ? (['left', 'right'] as const).map((side) => (
                  <span
                    key={side}
                    className="absolute top-1/2 h-5 w-2.5 -translate-y-1/2 cursor-ew-resize rounded-sm border border-accent bg-white"
                    style={side === 'left' ? { insetInlineStart: -6 } : { insetInlineEnd: -6 }}
                    onPointerDown={(e) => begin(e, l, side)}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                    data-testid={`handle-${side}`}
                  />
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}
