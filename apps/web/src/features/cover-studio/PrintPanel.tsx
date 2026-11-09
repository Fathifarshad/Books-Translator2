import { COVER_PAPERS, type CoverImage, type CoverPrint, type CoverPrintView } from '@dozabaneh/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { api, coverImageFileUrl, coverPrintPdfUrl, coverPrintPreviewUrl } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { fieldClass, Group, Segmented, Toggle } from './controls';

/**
 * «جلد چاپخانه» (ADR-048, stage 3): the paper and bleed the printer asks for, the spine that follows from them, the
 * back cover's blurb (written by the AI engine or typed), ISBN barcode, price and publisher's logo, a preview of the
 * whole sheet, and the one-page PDF. Changes are saved a moment after the last keystroke.
 */
export function PrintPanel(props: {
  bookId: string;
  lang: string;
  view: CoverPrintView | undefined;
  images: CoverImage[];
  rev: number;
  side: 'front' | 'back';
  onSide: (s: 'front' | 'back') => void;
  onSaved: (v: CoverPrintView) => void;
  onImage: (img: CoverImage) => void;
}) {
  const { t } = useTranslation();
  const { bookId, lang, view } = props;
  const [draft, setDraft] = useState<CoverPrint | null>(null);
  const pending = useRef(false);
  const [wish, setWish] = useState('');

  // The server's copy changes by itself when the blurb is edited on the back cover: follow it, unless typing.
  useEffect(() => {
    if (view && !pending.current) setDraft(view.print);
  }, [view]);

  const save = useMutation({
    mutationFn: (p: CoverPrint) => api.saveCoverPrint(bookId, p, lang || undefined),
    onSuccess: props.onSaved,
  });
  const edit = (patch: Partial<CoverPrint>) => {
    pending.current = true;
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };
  useEffect(() => {
    if (!draft || !pending.current) return;
    const timer = setTimeout(() => {
      pending.current = false;
      save.mutate(draft);
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, save.mutate]);

  const blurb = useMutation({
    mutationFn: () => api.coverBlurb(bookId, { request: wish, lang: lang || undefined }),
    onSuccess: (r) => {
      if (r.blurb) edit({ blurb: r.blurb, tagline: r.tagline });
    },
  });
  const logo = useMutation({
    mutationFn: (f: File) => api.uploadCoverImage(bookId, f),
    onSuccess: (img) => {
      props.onImage(img);
      edit({ logo: img.id });
    },
  });

  if (!view || !draft) return <p className="text-sm text-muted">{t('coverStudio.loading')}</p>;
  const num = (v: number) => fmtNum(Math.round(v * 100) / 100);
  const isbnNote = {
    empty: '',
    valid: t('coverStudio.print.isbnValid'),
    'bad-check': t('coverStudio.print.isbnBadCheck'),
    'bad-format': t('coverStudio.print.isbnBadFormat'),
  }[view.isbn.state];

  return (
    <section className="flex flex-col gap-4" data-testid="print-panel">
      <p className="text-xs leading-6 text-muted">{t('coverStudio.print.intro')}</p>

      <Segmented
        label={t('coverStudio.print.editing')}
        value={props.side}
        onChange={props.onSide}
        options={[
          { value: 'front', label: t('coverStudio.print.front') },
          { value: 'back', label: t('coverStudio.print.back') },
        ]}
        testId="print-side"
      />

      <Group title={t('coverStudio.print.spineGroup')} testId="print-spine">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.paper')}
          <select
            value={draft.paper}
            onChange={(e) => edit({ paper: e.target.value as CoverPrint['paper'], leafMm: null })}
            className={fieldClass}
            data-testid="print-paper"
          >
            {COVER_PAPERS.map((p) => (
              <option key={p} value={p}>
                {t(`coverStudio.print.papers.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.pages', { built: view.builtPages ? fmtNum(view.builtPages) : '—' })}
          <input
            type="number"
            min={4}
            max={4000}
            value={draft.pages ?? ''}
            placeholder={view.builtPages ? String(view.builtPages) : ''}
            onChange={(e) => edit({ pages: e.target.value ? Math.round(Number(e.target.value)) : null })}
            className={fieldClass}
            data-testid="print-pages"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.leaf')}
          <input
            type="number"
            min={0.04}
            max={0.4}
            step={0.01}
            value={draft.leafMm ?? ''}
            placeholder={String(view.leafMm)}
            onChange={(e) => edit({ leafMm: e.target.value ? Number(e.target.value) : null })}
            className={fieldClass}
            data-testid="print-leaf"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.bleed')}
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={draft.bleedMm}
            onChange={(e) => edit({ bleedMm: Math.min(10, Math.max(0, Number(e.target.value) || 0)) })}
            className={fieldClass}
            data-testid="print-bleed"
          />
        </label>
        <Toggle
          label={t('coverStudio.print.cropMarks')}
          checked={draft.cropMarks}
          onChange={(v) => edit({ cropMarks: v })}
          testId="print-crop"
        />
        <Toggle
          label={t('coverStudio.print.spineText')}
          checked={draft.spineText}
          onChange={(v) => edit({ spineText: v })}
          testId="print-spine-text"
        />
        <p className="rounded-lg bg-panel px-3 py-2 text-sm" data-testid="print-spine-result" aria-live="polite">
          {view.spineMm === null
            ? t('coverStudio.print.spineUnknown')
            : t('coverStudio.print.spineIs', {
                spine: num(view.spineMm),
                width: num(view.sheet?.width ?? 0),
                height: num(view.sheet?.height ?? 0),
              })}
          {view.spineMm !== null && view.spineMm < 6 && draft.spineText ? (
            <span className="mt-1 block text-xs text-warning">{t('coverStudio.print.spineThin')}</span>
          ) : null}
        </p>
      </Group>

      <Group title={t('coverStudio.print.backGroup')} testId="print-back">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.wish')}
          <input
            value={wish}
            onChange={(e) => setWish(e.target.value)}
            maxLength={400}
            placeholder={t('coverStudio.print.wishPlaceholder')}
            className={fieldClass}
            data-testid="print-wish"
          />
        </label>
        <Button
          icon="sparkle"
          onClick={() => blurb.mutate()}
          disabled={blurb.isPending}
          data-testid="print-write-blurb"
        >
          {blurb.isPending ? t('coverStudio.print.writing') : t('coverStudio.print.writeBlurb')}
        </Button>
        {blurb.data ? (
          <p className="text-xs leading-6 text-muted" role="status" data-testid="print-blurb-note">
            {t(`coverStudio.print.blurbSource.${blurb.data.source}`)}
          </p>
        ) : null}
        {blurb.isError ? (
          <p role="alert" className="text-xs text-danger">
            {t('bookPdf.errors.generic')}
          </p>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.tagline')}
          <input
            value={draft.tagline}
            onChange={(e) => edit({ tagline: e.target.value })}
            maxLength={160}
            className={fieldClass}
            data-testid="print-tagline"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.blurb')}
          <textarea
            value={draft.blurb}
            onChange={(e) => edit({ blurb: e.target.value })}
            rows={7}
            maxLength={1500}
            className={`${fieldClass} leading-7`}
            data-testid="print-blurb"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.isbn')}
          <input
            dir="ltr"
            value={draft.isbn}
            onChange={(e) => edit({ isbn: e.target.value })}
            maxLength={24}
            placeholder="978-964-…"
            className={fieldClass}
            data-testid="print-isbn"
          />
        </label>
        {isbnNote ? (
          <p
            className={`text-xs ${view.isbn.state === 'valid' ? 'text-success' : 'text-warning'}`}
            role="status"
            data-testid="print-isbn-note"
          >
            {isbnNote}
          </p>
        ) : null}
        <Toggle
          label={t('coverStudio.print.barcode')}
          checked={draft.barcode}
          onChange={(v) => edit({ barcode: v })}
          testId="print-barcode"
        />
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('coverStudio.print.price')}
          <input
            value={draft.price}
            onChange={(e) => edit({ price: e.target.value })}
            maxLength={60}
            placeholder={t('coverStudio.print.pricePlaceholder')}
            className={fieldClass}
            data-testid="print-price"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{t('coverStudio.print.logo')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {props.images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => edit({ logo: draft.logo === img.id ? null : img.id })}
                aria-pressed={draft.logo === img.id}
                aria-label={t('coverStudio.print.logoPick')}
                className="h-12 w-12 overflow-hidden rounded border border-border bg-white aria-pressed:border-accent aria-pressed:ring-2 aria-pressed:ring-accent/40"
                data-testid={`print-logo-${img.id}`}
              >
                <img src={coverImageFileUrl(bookId, img.id)} alt="" className="h-full w-full object-contain" />
              </button>
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:border-accent">
              <Icon name="upload" size={14} />
              {t('coverStudio.print.logoUpload')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) logo.mutate(f);
                  e.target.value = '';
                }}
                data-testid="print-logo-upload"
              />
            </label>
            {draft.logo ? (
              <button
                type="button"
                onClick={() => edit({ logo: null })}
                className="text-xs text-muted underline hover:text-danger"
              >
                {t('coverStudio.print.logoRemove')}
              </button>
            ) : null}
          </div>
        </div>
        <p className="text-xs leading-6 text-muted">{t('coverStudio.print.backHint')}</p>
      </Group>

      <Group title={t('coverStudio.print.sheetGroup')} testId="print-sheet">
        {view.sheet ? (
          <figure className="m-0">
            <iframe
              title={t('coverStudio.print.sheetPreview')}
              src={coverPrintPreviewUrl(bookId, lang || undefined, props.rev)}
              style={{ aspectRatio: `${view.sheet.width} / ${view.sheet.height}` }}
              className="w-full rounded-lg border border-border bg-white shadow-sm"
              data-testid="print-preview"
            />
            <figcaption className="mt-1 text-center text-xs text-muted">
              {t('coverStudio.print.sheetPreview')}
            </figcaption>
          </figure>
        ) : (
          <p className="text-sm text-muted">{t('coverStudio.print.needPages')}</p>
        )}
        {view.sheet ? (
          <a
            href={coverPrintPdfUrl(bookId, lang || undefined)}
            download
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:opacity-90"
            data-testid="print-download"
          >
            <Icon name="download" size={16} />
            {t('coverStudio.print.download')}
          </a>
        ) : null}
        <p className="text-xs leading-6 text-muted">{t('coverStudio.print.downloadHint')}</p>
      </Group>
    </section>
  );
}
