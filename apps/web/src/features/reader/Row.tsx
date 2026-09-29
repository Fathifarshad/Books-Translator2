import type { SectionRow } from '@dozabaneh/core';
import { dirOf, localizeDigits, stripMarkup } from '@dozabaneh/text';
import { Popover } from 'radix-ui';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/ui';
import { copyText } from '../../lib/hooks';
import { useSettings } from '../../stores/settings';
import { askTutor } from '../tutor/TutorPanel';
import { useReader } from './context';
import { RichText } from './RichText';
import { TranslationEditor } from './TranslationEditor';

export type RowLayout = 'two' | 'target' | 'source' | 'interleaved';

interface RowProps {
  row: SectionRow;
  layout: RowLayout;
  editing: boolean;
  flash: boolean;
}

const TEXT_TYPES = new Set(['heading', 'paragraph', 'list_item', 'quote', 'caption', 'footnote']);

/** One aligned segment pair — target cell, source cell and the paragraph tool gutter (SPEC §11.4/§11.7). */
export function Row({ row, layout, editing, flash }: RowProps) {
  const { t } = useTranslation();
  const { bookId, sourceLang, targetLang, editSegment } = useReader();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Code, equations, tables and figures span both columns as one LTR block.
  if (!TEXT_TYPES.has(row.type)) {
    return (
      <div id={`seg-${row.segmentId}`} data-seg-id={row.segmentId} className={`row py-3 ${flash ? 'row-flash' : ''}`}>
        <SpanningBlock row={row} />
      </div>
    );
  }

  const showTargetCell = layout !== 'source';
  const gridClass =
    layout === 'two'
      ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem]'
      : 'grid grid-cols-[minmax(0,1fr)_2.25rem]';

  const cell = (side: 'target' | 'source', content: ReactNode, extra = '') => {
    const lang = side === 'target' ? targetLang : sourceLang;
    return (
      <div
        data-col={side}
        lang={lang}
        dir={dirOf(lang)}
        className={`reader-text min-w-0 px-5 py-3 ${extra} ${cellType(row)}`}
      >
        {content}
      </div>
    );
  };

  const targetContent = editing ? (
    <TranslationEditor segmentId={row.segmentId} onClose={() => editSegment(undefined)} />
  ) : row.tgt !== undefined ? (
    <Marker row={row} lang={targetLang}>
      <RichText text={row.tgt} lang={targetLang} side="target" />
    </Marker>
  ) : (
    <p className="text-sm text-muted italic">{row.status === 'queued' ? t('reader.queued') : ''}</p>
  );

  const sourceContent = (
    <Marker row={row} lang={sourceLang}>
      <RichText text={row.src} lang={sourceLang} side="source" />
    </Marker>
  );

  const interleavedSource = layout === 'interleaved' || (layout === 'target' && showOriginal);

  return (
    <div
      id={`seg-${row.segmentId}`}
      data-seg-id={row.segmentId}
      data-tools-open={toolsOpen || undefined}
      className={`row group relative ${gridClass} border-b border-border/50 transition-colors hover:bg-row-hover focus-within:bg-row-hover ${
        flash ? 'row-flash' : ''
      } ${row.type === 'footnote' ? 'text-[0.9em]' : ''}`}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return;
        pressTimer.current = setTimeout(() => setToolsOpen((v) => !v), 500);
      }}
      onPointerUp={() => clearTimeout(pressTimer.current)}
      onPointerCancel={() => clearTimeout(pressTimer.current)}
      onPointerMove={() => clearTimeout(pressTimer.current)}
    >
      {interleavedSource ? (
        <div className="min-w-0">
          {showTargetCell ? cell('target', targetContent) : null}
          {cell('source', sourceContent, '-mt-2 pt-0 text-[0.88em] text-muted')}
        </div>
      ) : (
        <>
          {showTargetCell ? cell('target', targetContent) : null}
          {layout === 'two' || layout === 'source'
            ? cell('source', sourceContent, layout === 'two' ? 'border-s border-border' : '')
            : null}
        </>
      )}
      <RowTools
        row={row}
        visible={toolsOpen}
        onAsk={() =>
          askTutor(bookId, t('tutor.explainSelection'), {
            selection: {
              text: stripMarkup(row.tgt ?? row.src),
              lang: row.tgt ? targetLang : sourceLang,
              segmentIds: [row.segmentId],
            },
          })
        }
        onEdit={row.tgt !== undefined ? () => editSegment(row.segmentId) : undefined}
        onToggleOriginal={layout === 'target' ? () => setShowOriginal((v) => !v) : undefined}
        originalShown={showOriginal}
      />
    </div>
  );
}

function cellType(row: SectionRow): string {
  switch (row.type) {
    case 'heading':
      return 'font-bold text-[1.12em] pt-6';
    case 'quote':
      return 'border-s-2 border-accent/40 ms-5 ps-4 text-[0.97em] text-text/90';
    case 'caption':
      return 'text-[0.9em] text-muted';
    case 'footnote':
      return 'text-[0.88em] text-muted';
    default:
      return '';
  }
}

/** List bullets / footnote numbers on the correct (logical start) side. */
function Marker({ row, lang, children }: { row: SectionRow; lang: string; children: ReactNode }) {
  if (row.type === 'heading') return <h3 className="font-bold">{children}</h3>;
  if (row.type === 'list_item') {
    const level = row.meta.level ?? 0;
    return (
      <div className="flex gap-2" style={{ paddingInlineStart: `${level * 1.25}rem` }}>
        <span aria-hidden="true" className="select-none text-accent">
          {row.meta.ordered ? localizeDigits(row.meta.marker ?? '•', lang) : '•'}
        </span>
        <p className="min-w-0 flex-1">{children}</p>
      </div>
    );
  }
  if (row.type === 'footnote') {
    return (
      <p>
        <sup className="me-1 font-semibold text-accent">{localizeDigits(row.meta.footnoteId ?? '', lang)}</sup>
        {children}
      </p>
    );
  }
  if (row.type === 'quote') return <blockquote>{children}</blockquote>;
  return <p>{children}</p>;
}

function SpanningBlock({ row }: { row: SectionRow }) {
  const { t } = useTranslation();
  const { index } = useReader();
  if (row.type === 'code') {
    return (
      <pre
        dir="ltr"
        lang="zxx"
        className="mx-5 overflow-x-auto rounded-xl border border-border bg-panel p-4 font-mono text-[13.5px] leading-6"
      >
        <code>{row.src}</code>
      </pre>
    );
  }
  if (row.type === 'figure') {
    const label = index.book.pageLabels[row.page] ?? String(row.page + 1);
    return (
      <figure className="mx-5 flex items-center gap-3 rounded-xl border border-dashed border-border bg-panel/60 p-5 text-sm text-muted">
        <Icon name="image" size={28} />
        <figcaption>
          {t('reader.figurePlaceholder', {
            id: localizeDigits(row.meta.figureId ?? '', 'fa'),
            page: localizeDigits(label, 'fa'),
          })}
          <span className="block text-xs">{t('reader.pdfLater')}</span>
        </figcaption>
      </figure>
    );
  }
  return (
    <pre dir="ltr" className="mx-5 overflow-x-auto rounded-xl bg-panel p-4 font-mono text-sm">
      {row.src}
    </pre>
  );
}

interface RowToolsProps {
  row: SectionRow;
  visible: boolean;
  onAsk: () => void;
  onEdit?: () => void;
  onToggleOriginal?: () => void;
  originalShown: boolean;
}

function RowTools({ row, visible, onAsk, onEdit, onToggleOriginal, originalShown }: RowToolsProps) {
  const { t } = useTranslation();
  const showNotes = useSettings((s) => s.showNotes);
  const hideable = `transition-opacity ${visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`;
  // Absolutely positioned so the tool stack never changes the row height (rows stay aligned).
  return (
    <div className="relative">
      <div className="absolute inset-x-0 top-2 z-10 flex flex-col items-center gap-0.5">
        {row.flags.length > 0 ? (
          <InfoPopover icon="warning" label={t('reader.qaFlag')} tone="warning" testId="qa-flag">
            {row.flags.map((f) => (
              <p key={f.code}>{f.reason}</p>
            ))}
          </InfoPopover>
        ) : null}
        {row.note && showNotes ? (
          <InfoPopover icon="info" label={t('reader.noteLabel')} tone="muted" testId="translator-note">
            <p>{row.note}</p>
          </InfoPopover>
        ) : null}
        {row.status === 'user_edited' ? (
          <span role="img" title={t('reader.edited')} aria-label={t('reader.edited')} className="text-accent">
            <Icon name="edit" size={14} />
          </span>
        ) : null}
        <div className={`flex flex-col items-center gap-0.5 rounded-lg bg-surface/90 shadow-sm ${hideable}`}>
          <IconButton icon="chat" label={t('reader.askAboutParagraph')} className="size-8" onClick={onAsk} />
          {onEdit ? (
            <IconButton icon="edit" label={t('reader.editTranslation')} className="size-8" onClick={onEdit} />
          ) : null}
          {onToggleOriginal ? (
            <IconButton
              icon="eye"
              label={originalShown ? t('reader.hideSource') : t('reader.showSource')}
              className="size-8"
              aria-pressed={originalShown}
              onClick={onToggleOriginal}
            />
          ) : null}
          <IconButton
            icon="copy"
            label={t('app.copy')}
            className="size-8"
            onClick={() => void copyText(stripMarkup(row.tgt ?? row.src))}
          />
        </div>
      </div>
    </div>
  );
}

function InfoPopover({
  icon,
  label,
  tone,
  testId,
  children,
}: {
  icon: 'warning' | 'info';
  label: string;
  tone: 'warning' | 'muted';
  testId: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-testid={testId}
          className={`inline-flex size-8 items-center justify-center rounded-lg hover:bg-surface ${
            tone === 'warning' ? 'text-warning' : 'text-muted'
          }`}
        >
          <Icon name={icon} size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={4}
          collisionPadding={12}
          className="z-50 max-w-xs rounded-xl border border-border bg-surface p-3 text-sm leading-7 shadow-[var(--shadow-popover)]"
        >
          <p className="mb-1 text-xs font-bold text-muted">{label}</p>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
