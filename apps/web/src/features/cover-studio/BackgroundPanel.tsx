import { applyTheme, THEMES } from '@dozabaneh/cover';
import {
  COVER_BG_KINDS,
  COVER_DIM_MODES,
  COVER_FRAMES,
  COVER_PATTERNS,
  COVER_THEMES,
  type CoverBackground,
  type CoverDesign,
  type CoverImage,
} from '@dozabaneh/shared';
import { type ChangeEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { coverImageFileUrl } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import type { DesignUpdate } from './CoverCanvas';
import { ColorField, fieldClass, Group, Segmented, Slider } from './controls';
import { designColors } from './LayerInspector';

/**
 * The ground of the cover: a colour, a gradient, or one of the book's images (uploaded here; drawn by AI in stage 2)
 * with the point kept in view, enlargement, blur and a darkening that keeps type readable; a palette applied in one
 * click; the star field and the frame.
 */
export function BackgroundPanel(props: {
  bookId: string;
  design: CoverDesign;
  update: DesignUpdate;
  images: CoverImage[];
  onUpload: (file: File) => void;
  uploading: boolean;
  uploadFailed: boolean;
  onRemoveImage: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { bookId, design, update, images } = props;
  const bg = design.background;
  const set = (patch: Partial<CoverBackground>, key?: string) =>
    update((d) => ({ ...d, background: { ...d.background, ...patch } }), key ? `bg:${key}` : undefined);
  const file = useRef<HTMLInputElement>(null);
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) props.onUpload(f);
    e.target.value = '';
  };
  const swatches = designColors(design);

  return (
    <section className="flex flex-col gap-3" data-testid="background-panel">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted">{t('coverStudio.palettes')}</span>
        <div className="flex flex-wrap gap-2">
          {COVER_THEMES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => update((d) => applyTheme(d, THEMES[id]))}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/60"
              data-testid={`palette-${id}`}
            >
              <span
                className="inline-block size-5 rounded border border-black/10"
                style={{ background: `linear-gradient(135deg, ${THEMES[id].bg} 60%, ${THEMES[id].ornament} 60%)` }}
              />
              {t(`bookPdf.themes.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <Segmented
        label={t('coverStudio.ground')}
        value={bg.kind}
        onChange={(kind) => set({ kind })}
        options={COVER_BG_KINDS.map((k) => ({ value: k, label: t(`coverStudio.groundKinds.${k}`) }))}
        testId="ground-kind"
      />

      {bg.kind !== 'image' ? (
        <div className="grid grid-cols-2 gap-3">
          <ColorField
            label={t('coverStudio.color1')}
            value={bg.color}
            onChange={(color) => set({ color }, 'c1')}
            swatches={swatches}
            testId="bg-color"
          />
          {bg.kind === 'gradient' ? (
            <ColorField
              label={t('coverStudio.color2')}
              value={bg.color2}
              onChange={(color2) => set({ color2 }, 'c2')}
              swatches={swatches}
            />
          ) : null}
        </div>
      ) : null}
      {bg.kind === 'gradient' ? (
        <>
          <Segmented
            label={t('coverStudio.gradient')}
            value={bg.gradient}
            onChange={(gradient) => set({ gradient })}
            options={(['radial', 'linear'] as const).map((g) => ({ value: g, label: t(`coverStudio.gradients.${g}`) }))}
          />
          {bg.gradient === 'linear' ? (
            <Slider
              label={t('coverStudio.angle')}
              value={bg.angle}
              min={0}
              max={360}
              step={5}
              onChange={(angle) => set({ angle }, 'angle')}
              format={(v) => `${fmtNum(v)}°`}
            />
          ) : null}
        </>
      ) : null}

      {bg.kind === 'image' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={onFile}
              data-testid="bg-file"
            />
            <Button icon="upload" onClick={() => file.current?.click()} disabled={props.uploading}>
              {props.uploading ? t('bookPdf.uploading') : t('coverStudio.uploadImage')}
            </Button>
            <span className="text-xs text-muted">{t('coverStudio.imageHint')}</span>
          </div>
          {props.uploadFailed ? (
            <p role="alert" className="text-sm text-danger">
              {t('bookPdf.uploadFailed')}
            </p>
          ) : null}
          {images.length ? (
            <ul className="grid grid-cols-4 gap-2" data-testid="image-gallery">
              {images.map((img) => (
                <li key={img.id} className="relative">
                  <button
                    type="button"
                    onClick={() => set({ image: img.id })}
                    aria-pressed={bg.image === img.id}
                    className={`block aspect-[3/4] w-full overflow-hidden rounded border-2 ${bg.image === img.id ? 'border-accent' : 'border-transparent'}`}
                    aria-label={t('coverStudio.useImage')}
                  >
                    <img src={coverImageFileUrl(bookId, img.id)} alt="" className="size-full object-cover" />
                  </button>
                  {bg.image !== img.id ? (
                    <button
                      type="button"
                      onClick={() => props.onRemoveImage(img.id)}
                      aria-label={t('coverStudio.removeImage')}
                      title={t('coverStudio.removeImage')}
                      className="absolute end-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{t('coverStudio.noImages')}</p>
          )}
          {bg.image ? (
            <>
              <Slider
                label={t('coverStudio.focusX')}
                value={bg.focusX}
                min={0}
                max={100}
                step={1}
                onChange={(focusX) => set({ focusX }, 'fx')}
                format={(v) => t('audio.percent', { percent: fmtNum(Math.round(v)) })}
              />
              <Slider
                label={t('coverStudio.focusY')}
                value={bg.focusY}
                min={0}
                max={100}
                step={1}
                onChange={(focusY) => set({ focusY }, 'fy')}
                format={(v) => t('audio.percent', { percent: fmtNum(Math.round(v)) })}
              />
              <Slider
                label={t('coverStudio.zoom')}
                value={bg.zoom}
                min={1}
                max={3}
                step={0.05}
                onChange={(zoom) => set({ zoom }, 'zoom')}
                format={(v) => `×${fmtNum(Math.round(v * 100) / 100)}`}
              />
              <Slider
                label={t('coverStudio.blur')}
                value={bg.blur}
                min={0}
                max={3}
                step={0.05}
                onChange={(blur) => set({ blur }, 'blur')}
              />
            </>
          ) : null}
          <Group title={t('coverStudio.dim')} open>
            <Slider
              label={t('coverStudio.dimAmount')}
              value={bg.dim}
              min={0}
              max={0.9}
              step={0.05}
              onChange={(dim) => set({ dim }, 'dim')}
              format={(v) => t('audio.percent', { percent: fmtNum(Math.round(v * 100)) })}
              testId="bg-dim"
            />
            <Segmented
              label={t('coverStudio.dimMode')}
              value={bg.dimMode}
              onChange={(dimMode) => set({ dimMode })}
              options={COVER_DIM_MODES.map((m) => ({ value: m, label: t(`coverStudio.dimModes.${m}`) }))}
            />
            <ColorField
              label={t('coverStudio.dimColor')}
              value={bg.dimColor}
              onChange={(dimColor) => set({ dimColor }, 'dc')}
              swatches={swatches}
            />
          </Group>
        </div>
      ) : null}

      <Group title={t('coverStudio.ornaments')} open>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.pattern')}
          <select
            value={bg.pattern}
            onChange={(e) => set({ pattern: e.target.value as CoverBackground['pattern'] })}
            className={fieldClass}
            data-testid="bg-pattern"
          >
            {COVER_PATTERNS.map((p) => (
              <option key={p} value={p}>
                {t(`coverStudio.patterns.${p}`)}
              </option>
            ))}
          </select>
        </label>
        {bg.pattern !== 'none' ? (
          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label={t('coverStudio.color')}
              value={bg.patternColor}
              onChange={(patternColor) => set({ patternColor }, 'pc')}
              swatches={swatches}
            />
            <Slider
              label={t('coverStudio.opacity')}
              value={bg.patternOpacity}
              min={0.02}
              max={1}
              step={0.02}
              onChange={(patternOpacity) => set({ patternOpacity }, 'po')}
              format={(v) => t('audio.percent', { percent: fmtNum(Math.round(v * 100)) })}
            />
          </div>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.frame')}
          <select
            value={bg.frame}
            onChange={(e) => set({ frame: e.target.value as CoverBackground['frame'] })}
            className={fieldClass}
            data-testid="bg-frame"
          >
            {COVER_FRAMES.map((f) => (
              <option key={f} value={f}>
                {t(`coverStudio.frames.${f}`)}
              </option>
            ))}
          </select>
        </label>
        {bg.frame !== 'none' ? (
          <ColorField
            label={t('coverStudio.color')}
            value={bg.frameColor}
            onChange={(frameColor) => set({ frameColor }, 'frc')}
            swatches={swatches}
          />
        ) : null}
      </Group>
    </section>
  );
}
