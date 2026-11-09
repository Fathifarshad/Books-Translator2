import { newShapeLayer, newTextLayer } from '@dozabaneh/cover';
import { COVER_SHAPES, type CoverDesign, type CoverLayer, type CoverTextRole } from '@dozabaneh/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { type DesignUpdate, updateLayer } from './CoverCanvas';

/** Roles a new text layer can take (the book's own texts are already in the design). */
const NEW_ROLES: CoverTextRole[] = ['subtitle', 'series', 'publisher', 'badge', 'text'];

export function layerName(l: CoverLayer, t: (k: string) => string): string {
  if (l.kind === 'shape') return t(`coverStudio.shapes.${l.shape}`);
  const snippet = l.text.split('\n')[0]?.trim().slice(0, 28);
  return l.role === 'text' && snippet ? snippet : t(`coverStudio.roles.${l.role}`);
}

/**
 * The cover's layers, top first (the last painted is on top): select one, hide or lock it, raise or lower it, add a
 * text (subtitle, series, publisher, a badge, free text) or an ornament.
 */
export function LayersPanel(props: {
  design: CoverDesign;
  selected: string | null;
  onSelect: (id: string) => void;
  update: DesignUpdate;
  texts: Partial<Record<CoverTextRole, string>>;
  issues: Set<string>;
}) {
  const { t } = useTranslation();
  const { design, selected, onSelect, update, texts, issues } = props;
  const [adding, setAdding] = useState<null | 'text' | 'shape'>(null);
  const top = [...design.layers].reverse();

  const move = (id: string, by: 1 | -1) =>
    update((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= d.layers.length) return d;
      const layers = [...d.layers];
      [layers[i], layers[j]] = [layers[j] as CoverLayer, layers[i] as CoverLayer];
      return { ...d, layers };
    });

  const addText = (role: CoverTextRole) => {
    let id = '';
    update((d) => {
      const layer = newTextLayer(d, role, texts[role] || t(`coverStudio.placeholders.${role}`));
      id = layer.id;
      return { ...d, layers: [...d.layers, layer] };
    });
    setAdding(null);
    setTimeout(() => id && onSelect(id), 0);
  };

  const addShape = (shape: (typeof COVER_SHAPES)[number]) => {
    let id = '';
    update((d) => {
      const color = d.background.patternColor;
      const layer = newShapeLayer(d, shape, color);
      id = layer.id;
      return { ...d, layers: [...d.layers, layer] };
    });
    setAdding(null);
    setTimeout(() => id && onSelect(id), 0);
  };

  return (
    <section className="flex flex-col gap-2" aria-labelledby="layers-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="layers-title" className="text-sm font-bold">
          {t('coverStudio.layers')}
        </h2>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            icon="plus"
            onClick={() => setAdding(adding === 'text' ? null : 'text')}
            data-testid="add-text"
          >
            {t('coverStudio.addText')}
          </Button>
          <Button
            variant="ghost"
            icon="layers"
            onClick={() => setAdding(adding === 'shape' ? null : 'shape')}
            data-testid="add-shape"
          >
            {t('coverStudio.addShape')}
          </Button>
        </div>
      </div>
      {adding ? (
        <div className="flex flex-wrap gap-1.5 rounded-lg bg-panel p-2" data-testid="add-menu">
          {adding === 'text'
            ? NEW_ROLES.map((r) => (
                <Button key={r} variant="pill" onClick={() => addText(r)} data-testid={`add-${r}`}>
                  {t(`coverStudio.roles.${r}`)}
                </Button>
              ))
            : COVER_SHAPES.map((s) => (
                <Button key={s} variant="pill" onClick={() => addShape(s)} data-testid={`add-${s}`}>
                  {t(`coverStudio.shapes.${s}`)}
                </Button>
              ))}
        </div>
      ) : null}
      <ul className="flex flex-col gap-0.5" data-testid="layer-list">
        {top.map((l) => {
          const isSel = l.id === selected;
          const empty = l.kind === 'text' && !l.text.trim();
          return (
            <li
              key={l.id}
              className={`group flex items-center gap-1 rounded-lg px-1.5 py-1 text-sm ${isSel ? 'bg-accent-soft' : 'hover:bg-row-hover'}`}
            >
              <button
                type="button"
                onClick={() => onSelect(l.id)}
                aria-current={isSel ? 'true' : undefined}
                className={`min-w-0 flex-1 truncate text-start ${l.visible && !empty ? '' : 'text-muted line-through'}`}
                data-testid={`layer-${l.id}`}
              >
                {issues.has(l.id) ? <Icon name="warning" size={13} className="me-1 inline text-warning" /> : null}
                {layerName(l, t)}
              </button>
              <button
                type="button"
                aria-label={l.visible ? t('coverStudio.hide') : t('coverStudio.show')}
                title={l.visible ? t('coverStudio.hide') : t('coverStudio.show')}
                aria-pressed={!l.visible}
                onClick={() => update((d) => updateLayer(d, l.id, { visible: !l.visible }))}
                className={`rounded p-1 hover:bg-bg ${l.visible ? 'text-muted' : 'text-warning'}`}
                data-testid={`visible-${l.id}`}
              >
                <Icon name="eye" size={15} />
              </button>
              <button
                type="button"
                aria-label={t('coverStudio.lock')}
                title={t('coverStudio.lock')}
                aria-pressed={l.locked}
                onClick={() => update((d) => updateLayer(d, l.id, { locked: !l.locked }))}
                className={`rounded p-1 hover:bg-bg ${l.locked ? 'text-accent' : 'text-muted'}`}
              >
                <Icon name={l.locked ? 'lock' : 'unlock'} size={15} />
              </button>
              <button
                type="button"
                aria-label={t('coverStudio.raise')}
                title={t('coverStudio.raise')}
                onClick={() => move(l.id, 1)}
                className="rounded p-1 text-muted hover:bg-bg"
              >
                <Icon name="mergeUp" size={15} />
              </button>
              <button
                type="button"
                aria-label={t('coverStudio.lower')}
                title={t('coverStudio.lower')}
                onClick={() => move(l.id, -1)}
                className="rounded p-1 text-muted hover:bg-bg"
              >
                <Icon name="mergeDown" size={15} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
