import { buildSection, firstReadable, glossaryFor } from '@dozabaneh/core';
import { createGlossaryMatcher, isolate } from '@dozabaneh/text';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { BOTTOM_SHEET_RESERVE, BottomSheet } from '../../components/BottomSheet';
import { Drawer } from '../../components/Drawer';
import { Button, IconButton } from '../../components/ui';
import { targetLangOf, useBookBundle, useBookIndex } from '../../data/books';
import { useLayout, useTwoColumns } from '../../lib/hooks';
import { useLibrary } from '../../stores/library';
import { TOC_WIDTH, TUTOR_WIDTH, useReaderUi } from '../../stores/reader';
import { readerCssVars, useSettings } from '../../stores/settings';
import { TutorPanel } from '../tutor/TutorPanel';
import { ReaderContext, type ReaderContextValue } from './context';
import { DisplaySettingsDialog, ShortcutsDialog } from './Dialogs';
import { GlossaryPopover } from './GlossaryPopover';
import { ReaderHeader } from './ReaderHeader';
import type { RowLayout } from './Row';
import { SearchDialog } from './SearchDialog';
import { SectionView } from './SectionView';
import { SelectionToolbar } from './SelectionToolbar';
import { TocSidebar } from './TocSidebar';
import { useShortcuts } from './useShortcuts';

/**
 * The reader: [TOC][target][source][tutor] in DOM (logical) order, which renders right → left in the RTL
 * shell exactly like the prototype (SPEC §11.1). TOC, reader and tutor scroll independently.
 */
export function ReaderPage() {
  const { t } = useTranslation();
  const { bookId = '', nodeId } = useParams();
  const { data: bundle, isLoading } = useBookBundle(bookId);
  const index = useBookIndex(bundle ?? undefined);
  const savedNode = useLibrary((s) => s.progress[bookId]?.nodeId);

  if (isLoading) return <p className="p-8 text-muted">{t('app.loading')}</p>;
  if (!index) return <Navigate to="/" replace />;

  const target = nodeId ? firstReadable(index, nodeId) : undefined;
  if (!nodeId || !target) {
    const fallback = (savedNode && firstReadable(index, savedNode)) || index.readingOrder[0];
    return fallback ? <Navigate to={`/books/${bookId}/read/${fallback.id}`} replace /> : null;
  }
  if (target.id !== nodeId) return <Navigate to={`/books/${bookId}/read/${target.id}`} replace />;
  return <Reader bookId={bookId} index={index} nodeId={nodeId} />;
}

function Reader({
  bookId,
  index,
  nodeId,
}: {
  bookId: string;
  index: NonNullable<ReturnType<typeof useBookIndex>>;
  nodeId: string;
}) {
  const { t } = useTranslation();
  const layout = useLayout();
  const twoColumns = useTwoColumns();
  const ui = useReaderUi();
  const settings = useSettings();
  const mainRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const targetLang = targetLangOf(index);
  const sourceLang = index.book.sourceLang;
  const section = useMemo(() => buildSection(index, nodeId, targetLang), [index, nodeId, targetLang]);

  useEffect(() => {
    const store = useReaderUi.getState();
    store.setLocation(bookId, nodeId);
    store.set({ editingSegmentId: undefined, tocDrawerOpen: false });
    useLibrary.getState().setPosition(bookId, nodeId);
  }, [bookId, nodeId]);

  const ctx = useMemo<ReaderContextValue | null>(() => {
    if (!section) return null;
    const terms = glossaryFor(index, targetLang);
    return {
      bookId,
      index,
      section,
      sourceLang,
      targetLang,
      glossary: new Map(terms.map((g) => [g.id, g])),
      matchers: {
        source: createGlossaryMatcher(
          terms.map((g) => ({ id: g.id, text: g.src })),
          sourceLang,
        ),
        target: createGlossaryMatcher(
          terms.map((g) => ({ id: g.id, text: g.tgt })),
          targetLang,
        ),
      },
      editSegment: (segmentId) => useReaderUi.getState().set({ editingSegmentId: segmentId }),
    };
  }, [bookId, index, section, sourceLang, targetLang]);

  // Document title from the section (isolated runs so mixed-direction titles stay intact).
  useEffect(() => {
    if (!section) return;
    const title = section.title.tgt ?? section.title.src;
    document.title = `${isolate(title || t('reader.chapterIntro'))} — ${t('app.name')}`;
  }, [section, t]);

  useShortcuts(bookId, index);

  if (!section || !ctx) return <p className="p-8 text-muted">{t('reader.notReadable')}</p>;

  const rowLayout: RowLayout =
    layout === 'mobile' || !twoColumns
      ? ui.mobileMode === 'both'
        ? 'interleaved'
        : ui.mobileMode
      : ui.showTarget && ui.showSource
        ? 'two'
        : ui.showTarget
          ? 'target'
          : 'source';

  const toc = (
    <TocSidebar
      onNavigate={() => ui.set({ tocDrawerOpen: false })}
      onCollapse={layout === 'desktop' ? () => ui.set({ tocCollapsed: true }) : undefined}
    />
  );
  const tutor = <TutorPanel bookId={bookId} onClose={() => ui.setTutor(false)} />;
  const showTocColumn = layout === 'desktop' && !ui.tocCollapsed;
  const showTutorColumn = layout === 'desktop' && ui.tutorOpen;

  const gridColumns = [
    showTocColumn ? `${ui.tocWidth}px` : null,
    'minmax(0, 1fr)',
    showTutorColumn ? `${ui.tutorWidth}px` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ReaderContext.Provider value={ctx}>
      <div
        className={`grid h-dvh overflow-hidden ${settings.justify ? 'justify' : ''}`}
        style={{ gridTemplateColumns: gridColumns, ...(readerCssVars(settings) as CSSProperties) }}
      >
        {showTocColumn ? (
          <div className="relative min-h-0 border-e border-border">
            {toc}
            <ResizeHandle
              side="end"
              label={t('reader.resizeToc')}
              width={ui.tocWidth}
              limits={TOC_WIDTH}
              onResize={(w) => ui.set({ tocWidth: w })}
            />
          </div>
        ) : null}

        <main
          ref={mainRef}
          id="main"
          className="relative flex min-h-0 min-w-0 flex-col bg-bg"
          data-testid="reader-main"
        >
          {layout === 'desktop' && ui.tocCollapsed ? (
            <IconButton
              icon="sidebar"
              label={t('reader.expandToc')}
              className="absolute top-3 start-2 z-10"
              onClick={() => ui.set({ tocCollapsed: false })}
            />
          ) : null}
          <div
            ref={scrollRef}
            data-reader-scroll
            className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
            style={layout === 'mobile' && ui.tutorSheetOpen ? { paddingBottom: BOTTOM_SHEET_RESERVE } : undefined}
          >
            <div className={layout === 'desktop' && ui.tocCollapsed ? 'ps-10' : ''}>
              <ReaderHeader layout={layout} twoColumns={twoColumns} />
            </div>
            <SectionView layout={rowLayout} scrollRef={scrollRef} />
          </div>
          {layout === 'mobile' && !ui.tutorSheetOpen ? (
            <div
              className="border-t border-border bg-panel px-4 py-2"
              style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
            >
              <Button
                variant="primary"
                icon="chat"
                className="w-full"
                onClick={() => ui.set({ tutorSheetOpen: true })}
                data-testid="open-tutor"
              >
                {t('tutor.open')}
              </Button>
            </div>
          ) : null}
          <GlossaryPopover boundaryRef={mainRef} />
          <SelectionToolbar containerRef={mainRef} />
        </main>

        {showTutorColumn ? (
          <aside
            aria-label={t('tutor.title')}
            className="relative min-h-0 border-s border-border"
            data-testid="tutor-column"
          >
            <ResizeHandle
              side="start"
              label={t('reader.resizeTutor')}
              width={ui.tutorWidth}
              limits={TUTOR_WIDTH}
              onResize={(w) => ui.set({ tutorWidth: w })}
            />
            {tutor}
          </aside>
        ) : null}
      </div>

      {layout !== 'desktop' ? (
        <Drawer
          open={ui.tocDrawerOpen}
          onOpenChange={(o) => ui.set({ tocDrawerOpen: o })}
          side="start"
          title={t('reader.toc')}
        >
          {toc}
        </Drawer>
      ) : null}
      {layout === 'tablet' ? (
        <Drawer
          open={ui.tutorSheetOpen}
          onOpenChange={(o) => ui.set({ tutorSheetOpen: o })}
          side="end"
          title={t('tutor.title')}
          width="min(92vw, 420px)"
        >
          <aside aria-label={t('tutor.title')} className="h-full">
            {tutor}
          </aside>
        </Drawer>
      ) : null}
      {layout === 'mobile' ? (
        <BottomSheet
          open={ui.tutorSheetOpen}
          onClose={() => ui.set({ tutorSheetOpen: false })}
          label={t('tutor.title')}
        >
          <aside aria-label={t('tutor.title')} className="h-full">
            {tutor}
          </aside>
        </BottomSheet>
      ) : null}

      <SearchDialog />
      <DisplaySettingsDialog />
      <ShortcutsDialog />
    </ReaderContext.Provider>
  );
}

/** Drag handle on a column edge; widths persist per device. Keyboard: arrow keys resize. */
function ResizeHandle({
  side,
  label,
  width,
  limits,
  onResize,
}: {
  side: 'start' | 'end';
  label: string;
  width: number;
  limits: { min: number; max: number };
  onResize: (w: number) => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const rtl = document.documentElement.dir === 'rtl';
  // Moving the pointer towards the reader grows the column: for the TOC (start column) that is the
  // inline-end direction, for the tutor (end column) the inline-start direction.
  const sign = (side === 'end' ? 1 : -1) * (rtl ? -1 : 1);
  const clamp = (w: number) => Math.max(limits.min, Math.min(limits.max, w));
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focusable/draggable; role=separator is the ARIA pattern
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={width}
      tabIndex={0}
      className={`absolute inset-y-0 z-10 w-1.5 cursor-col-resize hover:bg-accent/30 focus-visible:bg-accent/40 ${side === 'end' ? '-end-1' : '-start-1'}`}
      onPointerDown={(e: ReactPointerEvent) => {
        start.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(clamp(start.current.w + sign * (e.clientX - start.current.x)));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 16;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          onResize(clamp(width + dir * step * sign));
        }
      }}
    />
  );
}
