import { coverFontFamily } from '@dozabaneh/cover';
import type { CoverFont } from '@dozabaneh/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { ensureCoverFonts } from './CoverView';

/**
 * Choosing a typeface: every name is written in its own face with a sample word, the app's free faces first and then
 * the Persian faces installed on this computer; type to filter. A face loads only when its row is drawn.
 */
export function FontPicker(props: {
  fonts: CoverFont[];
  value: string;
  onChange: (id: string) => void;
  sample: string;
}) {
  const { t } = useTranslation();
  const { fonts, value, onChange, sample } = props;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = fonts.find((f) => f.id === value);

  useEffect(() => {
    if (!open) return;
    ensureCoverFonts();
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (f: CoverFont) =>
      !needle ||
      f.family.toLowerCase().includes(needle) ||
      t(`coverStudio.fontNames.${f.id}`, { defaultValue: '' }).includes(q.trim());
    return (['bundled', 'system'] as const).map((source) => ({
      source,
      fonts: fonts.filter((f) => f.source === source && match(f)),
    }));
  }, [fonts, q, t]);

  const label = (f: CoverFont) => t(`coverStudio.fontNames.${f.id}`, { defaultValue: f.family });

  return (
    <div ref={box} className="flex flex-col gap-1">
      <span className="text-xs text-muted">{t('coverStudio.font')}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-start text-base"
        style={{ fontFamily: coverFontFamily(value) }}
        data-testid="font-picker"
      >
        <span className="truncate">{current ? label(current) : value}</span>
        <Icon name="chevronDown" size={15} className="shrink-0 text-muted" />
      </button>
      {open ? (
        <div className="mt-1 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <input
            // biome-ignore lint/a11y/noAutofocus: the list opens to be searched
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('coverStudio.fontSearch')}
            className="mb-2 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent/60"
            data-testid="font-search"
          />
          <div id={listId} role="listbox" aria-label={t('coverStudio.font')} className="max-h-80 overflow-y-auto">
            {groups.map((g) =>
              g.fonts.length ? (
                // biome-ignore lint/a11y/useSemanticElements: an option group inside a listbox, not a form fieldset
                <div key={g.source} role="group" aria-label={t(`coverStudio.fontSource.${g.source}`)}>
                  <div className="sticky top-0 bg-surface px-1.5 py-1 text-xs font-bold text-muted">
                    {t(`coverStudio.fontSource.${g.source}`)}
                  </div>
                  {g.fonts.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="option"
                      aria-selected={f.id === value}
                      onClick={() => {
                        onChange(f.id);
                        setOpen(false);
                      }}
                      className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-start hover:bg-row-hover aria-selected:bg-accent-soft"
                      data-testid={`font-${f.id}`}
                    >
                      <span className="truncate text-lg" style={{ fontFamily: coverFontFamily(f.id) }}>
                        {sample}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{label(f)}</span>
                    </button>
                  ))}
                </div>
              ) : null,
            )}
            {groups.every((g) => !g.fonts.length) ? (
              <p className="p-2 text-sm text-muted">{t('coverStudio.noFonts')}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
