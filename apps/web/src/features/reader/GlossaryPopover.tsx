import { getLanguage } from '@dozabaneh/text';
import { autoUpdate, FloatingPortal, flip, offset, shift, size, useFloating } from '@floating-ui/react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { useReaderUi } from '../../stores/reader';
import { askTutor } from '../tutor/TutorPanel';
import { useReader } from './context';

const OPEN_DELAY = 300;
const CLOSE_DELAY = 150;

/**
 * One popover for every glossary term in the reader (SPEC §11.5). Positioned with Floating UI
 * (flip/shift) against the reader area and rendered in a portal, so it never overlaps the TOC — fixes
 * prototype bug §4.2-4. Hover with a 300 ms delay on desktop, tap on touch, focus from the keyboard.
 */
export function GlossaryPopover({ boundaryRef }: { boundaryRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const { glossary, bookId, sourceLang, targetLang } = useReader();
  const [termId, setTermId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Set while we return focus to the term after Escape, so that focus does not reopen the card. */
  const restoringFocus = useRef(false);

  const { refs, floatingStyles } = useFloating({
    open: Boolean(termId),
    placement: 'top',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ boundary: boundaryRef.current ?? 'clippingAncestors', padding: 8 }),
      shift({ boundary: boundaryRef.current ?? 'clippingAncestors', padding: 8 }),
      size({
        boundary: boundaryRef.current ?? 'clippingAncestors',
        padding: 8,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.min(340, availableWidth)}px`;
        },
      }),
    ],
  });

  const close = useCallback(() => {
    clearTimeout(openTimer.current);
    anchor?.setAttribute('aria-expanded', 'false');
    setTermId(null);
    setAnchor(null);
  }, [anchor]);

  const open = useCallback(
    (el: HTMLElement) => {
      clearTimeout(closeTimer.current);
      anchor?.setAttribute('aria-expanded', 'false');
      el.setAttribute('aria-expanded', 'true');
      refs.setReference(el);
      setAnchor(el);
      setTermId(el.dataset.termId ?? null);
    },
    [anchor, refs],
  );

  useEffect(() => {
    const root = boundaryRef.current;
    if (!root) return;
    const termOf = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('[data-term-id]') : null);
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = termOf(e);
      if (!el) return;
      clearTimeout(closeTimer.current);
      clearTimeout(openTimer.current);
      openTimer.current = setTimeout(() => open(el), OPEN_DELAY);
    };
    const onOut = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !termOf(e)) return;
      clearTimeout(openTimer.current);
      closeTimer.current = setTimeout(close, CLOSE_DELAY);
    };
    const onClick = (e: MouseEvent) => {
      const el = termOf(e);
      if (!el) return;
      e.preventDefault();
      if (el === anchor) close();
      else open(el);
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = termOf(e);
      if (restoringFocus.current) {
        restoringFocus.current = false;
        return;
      }
      if (el && e.target instanceof HTMLElement && e.target.matches(':focus-visible')) open(el);
    };
    root.addEventListener('pointerover', onOver);
    root.addEventListener('pointerout', onOut);
    root.addEventListener('click', onClick);
    root.addEventListener('focusin', onFocusIn);
    return () => {
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerout', onOut);
      root.removeEventListener('click', onClick);
      root.removeEventListener('focusin', onFocusIn);
    };
  }, [boundaryRef, open, close, anchor]);

  useEffect(() => {
    if (!termId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        if (anchor && document.activeElement !== anchor) {
          restoringFocus.current = true;
          anchor.focus();
        }
      }
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!refs.floating.current?.contains(target) && !anchor?.contains(target)) close();
    };
    const scroller = boundaryRef.current?.querySelector('[data-reader-scroll]');
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    scroller?.addEventListener('scroll', close, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      scroller?.removeEventListener('scroll', close);
    };
  }, [termId, anchor, close, refs.floating, boundaryRef]);

  const term = termId ? glossary.get(termId) : undefined;
  if (!term) return null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        role="dialog"
        aria-label={term.tgt}
        data-testid="glossary-popover"
        className="z-50 w-max rounded-xl border border-border bg-surface p-3.5 text-sm shadow-[var(--shadow-popover)]"
        onPointerEnter={() => clearTimeout(closeTimer.current)}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') closeTimer.current = setTimeout(close, CLOSE_DELAY);
        }}
      >
        <p lang={sourceLang} dir={getLanguage(sourceLang).dir} className="font-mono text-xs text-muted">
          {term.src}
        </p>
        <p lang={targetLang} dir={getLanguage(targetLang).dir} className="mt-1 text-base font-bold">
          {term.tgt}
        </p>
        {term.definition ? (
          <p lang={targetLang} className="mt-1.5 leading-7 text-text">
            {term.definition}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            className="px-2 py-1 text-xs"
            onClick={() => {
              useReaderUi.getState().set({ searchOpen: true, searchQuery: term.tgt });
              close();
            }}
          >
            {t('glossary.allOccurrences')}
          </Button>
          <Button
            variant="primary"
            className="px-2 py-1 text-xs"
            onClick={() => {
              askTutor(bookId, t('tutor.askTerm', { term: term.tgt }));
              close();
            }}
          >
            {t('glossary.askTutor')}
          </Button>
        </div>
      </div>
    </FloatingPortal>
  );
}
