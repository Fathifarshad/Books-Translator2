import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { coverImageDownloadUrl, coverMockupDownloadUrl } from '../../lib/api';
import { Group, Segmented } from './controls';

const PRESETS = ['shop', 'square', 'print', 'mockup'] as const;

/**
 * «خروجی تصویر» (ADR-048, stage 4): the front cover as a PNG or JPG — the shop size, a square for social media and
 * the full print resolution. The server photographs the design with the same browser that prints the book.
 */
export function ExportPanel(props: { bookId: string; lang: string }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  return (
    <section className="flex flex-col gap-4" data-testid="export-panel">
      <Group title={t('coverStudio.export.group')} testId="export-images">
        <Segmented
          label={t('coverStudio.export.format')}
          value={format}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
          ]}
          onChange={setFormat}
          testId="export-format"
        />
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {PRESETS.map((preset) => (
            <li
              key={preset}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              data-testid={`export-${preset}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{t(`coverStudio.export.${preset}.title`)}</div>
                <div className="text-xs leading-6 text-muted">{t(`coverStudio.export.${preset}.hint`)}</div>
              </div>
              <a
                href={
                  preset === 'mockup'
                    ? coverMockupDownloadUrl(props.bookId, props.lang || undefined, format)
                    : coverImageDownloadUrl(props.bookId, props.lang || undefined, preset, format)
                }
                download
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
                data-testid={`export-${preset}-download`}
              >
                <Icon name="download" size={16} />
                {t('coverStudio.export.download')}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-6 text-muted">{t('coverStudio.export.note')}</p>
      </Group>
    </section>
  );
}
