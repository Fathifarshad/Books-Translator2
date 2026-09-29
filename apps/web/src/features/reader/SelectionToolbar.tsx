import type { SelectionContext } from '@dozabaneh/shared';
import { autoUpdate, FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../components/ui';
import { copyText, useCoarsePointer } from '../../lib/hooks';
import { useReaderUi } from '../../stores/reader';
import { useSettings } from '../../stores/settings';
import { askTutor } from '../tutor/TutorPanel';
import { useReader } from './context';

interface Captured extends SelectionContext {
  column: 'target' | 'source';
  range: Range;
}

/**
 * Floating toolbar over a text selection inside ONE reader column (SPEC §11.6): «بپرس درباره‌ی این»,
 * «از این تکه سؤال بساز», copy and — in the target column — «پیشنهاد اصلاح ترجمه».
 */
export function SelectionToolbar({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const { bookId, editSegment } = useReader();
  const coarse = useCoarsePointer();
  const editBeforeSend = useSettings((s) => s.editBeforeSend);
  const [sel, setSel] = useState<Captured | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { refs, floatingStyles } = useFloating({
    open: Boolean(sel),
    placement: coarse ? 'bottom' : 'top',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const capture = useCallback(() => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSel(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const cellOf = (n: Node | null) =>
      (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('[data-col]') ?? null;
    const a = cellOf(selection.anchorNode);
    const f = cellOf(selection.focusNode);
    const text = selection.toString().trim();
    // Only selections inside one text column of the reader, at least 2 characters.
    if (!a || !f || a.dataset.col !== f.dataset.col || !container.contains(a) || text.length < 2) {
      setSel(null);
      return;
    }
    const segmentIds = [...container.querySelectorAll<HTMLElement>('[data-seg-id]')]
      .filter((row) => range.intersectsNode(row))
      .map((row) => row.dataset.segId as string);
    const column = a.dataset.col as 'target' | 'source';
    refs.setReference({
      getBoundingClientRect: () => range.getBoundingClientRect(),
      getClientRects: () => range.getClientRects(),
    });
    setSel({ text, lang: a.lang, segmentIds, column, range });
  }, [containerRef, refs]);

  useEffect(() => {
    const onChange = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(capture, coarse ? 300 : 120);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null);
    };
    const scroller = containerRef.current?.querySelector('[data-reader-scroll]') ?? containerRef.current;
    const onScroll = () => setSel(null);
    document.addEventListener('selectionchange', onChange);
    document.addEventListener('keydown', onKey);
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('selectionchange', onChange);
      document.removeEventListener('keydown', onKey);
      scroller?.removeEventListener('scroll', onScroll);
    };
  }, [capture, coarse, containerRef]);

  if (!sel) return null;
  const selection: SelectionContext = { text: sel.text, lang: sel.lang, segmentIds: sel.segmentIds };
  const done = () => {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  const ask = (question: string, mode: 'default' | 'quiz') => {
    if (editBeforeSend) {
      useReaderUi.getState().setTutor(true);
      useReaderUi.getState().set({
        pendingQuote: selection,
        composerFocusTick: useReaderUi.getState().composerFocusTick + 1,
      });
    } else {
      askTutor(bookId, question, { selection, mode });
    }
    done();
  };

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        role="toolbar"
        aria-label={t('reader.askAboutThis')}
        data-testid="selection-toolbar"
        className="z-50 flex items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-popover)]"
        onPointerDown={(e) => e.preventDefault()}
      >
        <Button
          variant="primary"
          className="px-3 py-1.5 text-[13px]"
          onClick={() => ask(t('tutor.explainSelection'), 'default')}
        >
          {t('reader.askAboutThis')}
        </Button>
        <Button variant="ghost" className="text-[13px]" onClick={() => ask(t('tutor.quizSelection'), 'quiz')}>
          {t('reader.quizSelection')}
        </Button>
        <IconButton
          icon="copy"
          label={t('app.copy')}
          className="size-8"
          onClick={() => {
            void copyText(sel.text);
            done();
          }}
        />
        {sel.column === 'target' && sel.segmentIds[0] ? (
          <IconButton
            icon="edit"
            label={t('reader.suggestFix')}
            className="size-8"
            onClick={() => {
              editSegment(sel.segmentIds[0]);
              done();
            }}
          />
        ) : null}
      </div>
    </FloatingPortal>
  );
}
