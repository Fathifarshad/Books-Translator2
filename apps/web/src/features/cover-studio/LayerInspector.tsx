import { gridPosition, type Horizontal, type Vertical } from '@dozabaneh/cover';
import {
  COVER_SHAPES,
  type CoverDesign,
  type CoverFont,
  type CoverLayer,
  type CoverShapeLayer,
  type CoverTextLayer,
  type CoverTextRole,
} from '@dozabaneh/shared';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { fmtNum } from '../../lib/format';
import { type DesignUpdate, updateLayer } from './CoverCanvas';
import type { LayerBoxes } from './CoverView';
import { ColorField, fieldClass, Group, Segmented, Slider, Toggle } from './controls';
import { FontPicker } from './FontPicker';

const H: Horizontal[] = ['right', 'center', 'left'];
const V: Vertical[] = ['top', 'middle', 'bottom'];
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Colours already in the design, offered as swatches. */
export function designColors(d: CoverDesign): string[] {
  return [
    d.background.color,
    d.background.color2,
    d.background.patternColor,
    '#ffffff',
    '#111111',
    ...d.layers.map((l) => l.color),
  ];
}

/** The nine positions of the layout grid (right to left as the page reads). */
function PositionGrid(props: {
  layer: CoverLayer;
  box: { w: number; h: number };
  aspect: number;
  onPlace: (p: { x: number; y: number }) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{t('coverStudio.position')}</span>
      <div className="grid w-28 grid-cols-3 gap-1" data-testid="position-grid">
        {V.flatMap((v) =>
          H.map((h) => (
            <button
              key={`${v}-${h}`}
              type="button"
              aria-label={t('coverStudio.placeAt', {
                v: t(`coverStudio.vertical.${v}`),
                h: t(`coverStudio.horizontal.${h}`),
              })}
              title={t('coverStudio.placeAt', {
                v: t(`coverStudio.vertical.${v}`),
                h: t(`coverStudio.horizontal.${h}`),
              })}
              onClick={() => props.onPlace(gridPosition(props.box, h, v, props.aspect))}
              disabled={props.layer.locked}
              className="flex h-7 items-center justify-center rounded border border-border bg-bg hover:border-accent/60 disabled:opacity-40"
              data-testid={`place-${v}-${h}`}
            >
              <span className="size-1.5 rounded-full bg-muted" />
            </button>
          )),
        )}
      </div>
    </div>
  );
}

export function LayerInspector(props: {
  design: CoverDesign;
  layer: CoverLayer;
  update: DesignUpdate;
  fonts: CoverFont[];
  texts: Partial<Record<CoverTextRole, string>>;
  boxes: LayerBoxes;
  aspect: number;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { design, layer, update, boxes, aspect } = props;
  const set = (patch: Partial<CoverLayer>, key?: string) =>
    update((d) => updateLayer(d, layer.id, patch), key ? `${key}:${layer.id}` : undefined);
  const box = boxes[layer.id] ?? { w: layer.w, h: 6 };
  const swatches = designColors(design);

  const common = (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <PositionGrid layer={layer} box={box} aspect={aspect} onPlace={(p) => set(p)} />
        <div className="grid min-w-36 flex-1 grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('coverStudio.x')}
            <input
              type="number"
              step={0.5}
              value={layer.x}
              onChange={(e) => set({ x: Number(e.target.value) }, 'x')}
              className={fieldClass}
              data-testid="layer-x"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {t('coverStudio.y')}
            <input
              type="number"
              step={0.5}
              value={layer.y}
              onChange={(e) => set({ y: Number(e.target.value) }, 'y')}
              className={fieldClass}
              data-testid="layer-y"
            />
          </label>
        </div>
      </div>
      <Slider
        label={t('coverStudio.width')}
        value={layer.w}
        min={4}
        max={120}
        step={0.5}
        onChange={(w) => set({ w }, 'w')}
        format={(v) => t('audio.percent', { percent: fmtNum(Math.round(v)) })}
        testId="layer-width"
      />
      <Slider
        label={t('coverStudio.opacity')}
        value={layer.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(opacity) => set({ opacity }, 'opacity')}
        format={(v) => t('audio.percent', { percent: fmtNum(Math.round(v * 100)) })}
      />
    </>
  );

  return (
    <section className="flex flex-col gap-3" aria-label={t('coverStudio.properties')} data-testid="inspector">
      <div className="flex flex-wrap items-center gap-1">
        <Toggle label={t('coverStudio.visible')} checked={layer.visible} onChange={(visible) => set({ visible })} />
        <span className="ms-auto" />
        <Button variant="ghost" icon="copy" onClick={() => props.onDuplicate(layer.id)} data-testid="duplicate-layer">
          {t('coverStudio.duplicate')}
        </Button>
        <Button variant="ghost" icon="trash" onClick={() => props.onRemove(layer.id)} data-testid="remove-layer">
          {t('coverStudio.remove')}
        </Button>
      </div>
      {layer.kind === 'text' ? (
        <TextProps {...props} layer={layer} set={set} swatches={swatches} common={common} />
      ) : (
        <ShapeProps layer={layer} set={set} swatches={swatches} common={common} />
      )}
    </section>
  );
}

function TextProps(props: {
  layer: CoverTextLayer;
  set: (patch: Partial<CoverTextLayer>, key?: string) => void;
  fonts: CoverFont[];
  texts: Partial<Record<CoverTextRole, string>>;
  swatches: string[];
  common: ReactNode;
}) {
  const { t } = useTranslation();
  const { layer, set, fonts, texts, swatches, common } = props;
  const font = fonts.find((f) => f.id === layer.font);
  const weights = font && font.weights.length > 1 ? font.weights : WEIGHTS;
  const bookText = layer.role !== 'text' ? texts[layer.role] : undefined;
  const sample =
    layer.text
      .split('\n')
      .find((s) => s.trim())
      ?.trim()
      .slice(0, 26) || t('coverStudio.fontSample');

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-xs text-muted">
          {t(`coverStudio.roles.${layer.role}`)}
          {bookText !== undefined && bookText !== layer.text ? (
            <button
              type="button"
              onClick={() => set({ text: bookText })}
              className="text-accent hover:underline"
              data-testid="reset-text"
            >
              {t('coverStudio.bookText')}
            </button>
          ) : null}
        </span>
        <textarea
          value={layer.text}
          onChange={(e) => set({ text: e.target.value }, 'text')}
          rows={Math.min(5, Math.max(2, layer.text.split('\n').length))}
          dir="auto"
          className={`${fieldClass} resize-y leading-7`}
          data-testid="layer-text"
        />
        {layer.lineStyle === 'credit' ? (
          <span className="text-xs text-muted">{t('coverStudio.creditHint')}</span>
        ) : null}
      </label>

      <FontPicker fonts={fonts} value={layer.font} onChange={(id) => set({ font: id })} sample={sample} />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.weight')}
          <select
            value={layer.weight}
            onChange={(e) => set({ weight: Number(e.target.value) })}
            className={fieldClass}
            data-testid="layer-weight"
          >
            {[...new Set([...weights, layer.weight])]
              .sort((a, b) => a - b)
              .map((w) => (
                <option key={w} value={w}>
                  {t(`coverStudio.weights.${w}`, { defaultValue: fmtNum(w) })}
                </option>
              ))}
          </select>
        </label>
        <ColorField
          label={t('coverStudio.color')}
          value={layer.color}
          onChange={(color) => set({ color }, 'color')}
          swatches={swatches}
          testId="layer-color"
        />
      </div>
      <Slider
        label={t('coverStudio.size')}
        value={layer.size}
        min={0.6}
        max={16}
        step={0.05}
        onChange={(size) => set({ size }, 'size')}
        testId="layer-size"
      />
      <Segmented
        label={t('coverStudio.align')}
        value={layer.align}
        onChange={(align) => set({ align })}
        options={(['right', 'center', 'left'] as const).map((a) => ({
          value: a,
          label: t(`coverStudio.aligns.${a}`),
          icon: (
            <span className="inline-flex items-center gap-1">
              <Icon name={a === 'right' ? 'alignRight' : a === 'left' ? 'alignLeft' : 'alignCenter'} size={15} />
              <span className="sr-only">{t(`coverStudio.aligns.${a}`)}</span>
            </span>
          ),
        }))}
        testId="layer-align"
      />
      {common}

      <Group title={t('coverStudio.typography')} open={false}>
        <Slider
          label={t('coverStudio.lineHeight')}
          value={layer.lineHeight}
          min={0.8}
          max={2.6}
          step={0.05}
          onChange={(lineHeight) => set({ lineHeight }, 'lh')}
        />
        <Slider
          label={t('coverStudio.letterSpacing')}
          value={layer.letterSpacing}
          min={-0.05}
          max={0.5}
          step={0.01}
          onChange={(letterSpacing) => set({ letterSpacing }, 'ls')}
        />
        <Segmented
          label={t('coverStudio.lineStyle')}
          value={layer.lineStyle}
          onChange={(lineStyle) => set({ lineStyle })}
          options={(['uniform', 'credit'] as const).map((v) => ({ value: v, label: t(`coverStudio.lineStyles.${v}`) }))}
        />
        {layer.lineStyle === 'credit' ? (
          <ColorField
            label={t('coverStudio.accent')}
            value={layer.accent}
            onChange={(accent) => set({ accent }, 'accent')}
            swatches={swatches}
          />
        ) : null}
      </Group>

      <Group
        title={t('coverStudio.effects')}
        open={Boolean(layer.stroke || layer.shadow || layer.band)}
        testId="effects"
      >
        <Toggle
          label={t('coverStudio.shadow')}
          checked={Boolean(layer.shadow)}
          onChange={(on) => set({ shadow: on ? { color: '#000000', blur: 0.35, offset: 0.06, opacity: 0.55 } : null })}
          testId="toggle-shadow"
        />
        {layer.shadow ? (
          <div className="flex flex-col gap-2 ps-5">
            <ColorField
              label={t('coverStudio.color')}
              value={layer.shadow.color}
              onChange={(color) =>
                set({ shadow: { ...(layer.shadow as NonNullable<CoverTextLayer['shadow']>), color } }, 'sc')
              }
            />
            <Slider
              label={t('coverStudio.blur')}
              value={layer.shadow.blur}
              min={0}
              max={1.5}
              step={0.05}
              onChange={(blur) =>
                set({ shadow: { ...(layer.shadow as NonNullable<CoverTextLayer['shadow']>), blur } }, 'sb')
              }
            />
            <Slider
              label={t('coverStudio.offset')}
              value={layer.shadow.offset}
              min={0}
              max={0.4}
              step={0.01}
              onChange={(offset) =>
                set({ shadow: { ...(layer.shadow as NonNullable<CoverTextLayer['shadow']>), offset } }, 'so')
              }
            />
            <Slider
              label={t('coverStudio.opacity')}
              value={layer.shadow.opacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(opacity) =>
                set({ shadow: { ...(layer.shadow as NonNullable<CoverTextLayer['shadow']>), opacity } }, 'sa')
              }
            />
          </div>
        ) : null}
        <Toggle
          label={t('coverStudio.stroke')}
          checked={Boolean(layer.stroke)}
          onChange={(on) => set({ stroke: on ? { color: '#000000', width: 0.03 } : null })}
          testId="toggle-stroke"
        />
        {layer.stroke ? (
          <div className="flex flex-col gap-2 ps-5">
            <ColorField
              label={t('coverStudio.color')}
              value={layer.stroke.color}
              onChange={(color) =>
                set({ stroke: { ...(layer.stroke as NonNullable<CoverTextLayer['stroke']>), color } }, 'kc')
              }
              swatches={swatches}
            />
            <Slider
              label={t('coverStudio.strokeWidth')}
              value={layer.stroke.width}
              min={0.005}
              max={0.15}
              step={0.005}
              onChange={(width) =>
                set({ stroke: { ...(layer.stroke as NonNullable<CoverTextLayer['stroke']>), width } }, 'kw')
              }
            />
          </div>
        ) : null}
        <Toggle
          label={t('coverStudio.band')}
          checked={Boolean(layer.band)}
          onChange={(on) => set({ band: on ? { color: '#000000', opacity: 0.55, padding: 0.6, radius: 0.15 } : null })}
          testId="toggle-band"
        />
        {layer.band ? (
          <div className="flex flex-col gap-2 ps-5">
            <ColorField
              label={t('coverStudio.color')}
              value={layer.band.color}
              onChange={(color) =>
                set({ band: { ...(layer.band as NonNullable<CoverTextLayer['band']>), color } }, 'bc')
              }
              swatches={swatches}
            />
            <Slider
              label={t('coverStudio.opacity')}
              value={layer.band.opacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(opacity) =>
                set({ band: { ...(layer.band as NonNullable<CoverTextLayer['band']>), opacity } }, 'ba')
              }
            />
            <Slider
              label={t('coverStudio.padding')}
              value={layer.band.padding}
              min={0}
              max={2}
              step={0.05}
              onChange={(padding) =>
                set({ band: { ...(layer.band as NonNullable<CoverTextLayer['band']>), padding } }, 'bp')
              }
            />
            <Slider
              label={t('coverStudio.radius')}
              value={layer.band.radius}
              min={0}
              max={1}
              step={0.05}
              onChange={(radius) =>
                set({ band: { ...(layer.band as NonNullable<CoverTextLayer['band']>), radius } }, 'br')
              }
            />
          </div>
        ) : null}
      </Group>
    </>
  );
}

function ShapeProps(props: {
  layer: CoverShapeLayer;
  set: (patch: Partial<CoverShapeLayer>, key?: string) => void;
  swatches: string[];
  common: ReactNode;
}) {
  const { t } = useTranslation();
  const { layer, set, swatches, common } = props;
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t('coverStudio.shape')}
        <select
          value={layer.shape}
          onChange={(e) => set({ shape: e.target.value as CoverShapeLayer['shape'] })}
          className={fieldClass}
        >
          {COVER_SHAPES.map((s) => (
            <option key={s} value={s}>
              {t(`coverStudio.shapes.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <ColorField
        label={t('coverStudio.color')}
        value={layer.color}
        onChange={(color) => set({ color }, 'color')}
        swatches={swatches}
      />
      <Slider
        label={t('coverStudio.thickness')}
        value={layer.thickness}
        min={0.2}
        max={6}
        step={0.1}
        onChange={(thickness) => set({ thickness }, 'th')}
      />
      {common}
    </>
  );
}
