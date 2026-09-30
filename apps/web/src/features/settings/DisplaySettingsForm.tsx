import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { languageName } from '../../lib/format';
import {
  FONT_SIZES,
  type LineHeight,
  type Theme,
  type TocTitleMode,
  type UnderlineMode,
  useSettings,
} from '../../stores/settings';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-bold">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Choice<T extends string | number | boolean>({
  value,
  current,
  onChange,
  children,
}: {
  value: T;
  current: T;
  onChange: (v: T) => void;
  children: ReactNode;
}) {
  return (
    <Button variant="pill" aria-pressed={value === current} onClick={() => onChange(value)}>
      {children}
    </Button>
  );
}

/** Display settings (SPEC §11.11), shared by the reader dialog and the Settings page. */
export function DisplaySettingsForm({
  sourceLang = 'en',
  targetLang = 'fa',
}: {
  sourceLang?: string;
  targetLang?: string;
}) {
  const { t } = useTranslation();
  const s = useSettings();
  const fontLabels = t('settings.fontSizes', { returnObjects: true }) as string[];
  return (
    <div className="flex flex-col gap-5">
      <Field label={t('settings.theme')}>
        {(['light', 'sepia', 'dark', 'system'] as Theme[]).map((v) => (
          <Choice key={v} value={v} current={s.theme} onChange={(theme) => s.set({ theme })}>
            {t(`settings.themes.${v}`)}
          </Choice>
        ))}
      </Field>
      <Field label={t('settings.fontSize')}>
        {FONT_SIZES.map((px, i) => (
          <Choice key={px} value={i} current={s.fontSize} onChange={(fontSize) => s.set({ fontSize })}>
            {fontLabels[i] ?? String(px)}
          </Choice>
        ))}
      </Field>
      <Field label={t('settings.lineHeight')}>
        {(['compact', 'normal', 'relaxed'] as LineHeight[]).map((v) => (
          <Choice key={v} value={v} current={s.lineHeight} onChange={(lineHeight) => s.set({ lineHeight })}>
            {t(`settings.lineHeights.${v}`)}
          </Choice>
        ))}
      </Field>
      <Field label={t('settings.justify')}>
        <Choice value={true} current={s.justify} onChange={(justify) => s.set({ justify })}>
          {t('settings.on')}
        </Choice>
        <Choice value={false} current={s.justify} onChange={(justify) => s.set({ justify })}>
          {t('settings.off')}
        </Choice>
      </Field>
      <Field label={t('settings.underline')}>
        {(['all', 'firstPerParagraph', 'off'] as UnderlineMode[]).map((v) => (
          <Choice key={v} value={v} current={s.underline} onChange={(underline) => s.set({ underline })}>
            {t(`settings.underlineModes.${v}`)}
          </Choice>
        ))}
      </Field>
      <Field label={t('settings.tocTitles')}>
        {(['target', 'source', 'both'] as TocTitleMode[]).map((v) => (
          <Choice key={v} value={v} current={s.tocTitles} onChange={(tocTitles) => s.set({ tocTitles })}>
            {v === 'both' ? t('settings.tocTitleBoth') : languageName(v === 'target' ? targetLang : sourceLang)}
          </Choice>
        ))}
      </Field>
      <Field label={t('settings.notes')}>
        <Choice value={true} current={s.showNotes} onChange={(showNotes) => s.set({ showNotes })}>
          {t('settings.on')}
        </Choice>
        <Choice value={false} current={s.showNotes} onChange={(showNotes) => s.set({ showNotes })}>
          {t('settings.off')}
        </Choice>
      </Field>
      <Field label={t('settings.editBeforeSend')}>
        <Choice value={true} current={s.editBeforeSend} onChange={(editBeforeSend) => s.set({ editBeforeSend })}>
          {t('settings.on')}
        </Choice>
        <Choice value={false} current={s.editBeforeSend} onChange={(editBeforeSend) => s.set({ editBeforeSend })}>
          {t('settings.off')}
        </Choice>
      </Field>
    </div>
  );
}
