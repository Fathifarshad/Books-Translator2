import type { BookIndex } from '@dozabaneh/core';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { uiDir } from '../../i18n';
import { isTypingTarget } from '../../lib/hooks';
import { useReaderUi } from '../../stores/reader';

/**
 * Reader keyboard shortcuts (SPEC §11.12). Matched on `event.code` so they work with any keyboard layout.
 * ← / → follow the reading direction: in an RTL UI ← goes to the next section.
 * Neighbours are computed from the URL at key time (navigations render in a transition, so closures
 * captured at render time can be one section behind).
 */
export function useShortcuts(bookId: string, index: BookIndex) {
  const navigate = useNavigate();
  useEffect(() => {
    const step = (delta: 1 | -1) => {
      const nodeId = window.location.pathname.split('/').filter(Boolean).at(-1);
      const pos = index.readingOrder.findIndex((n) => n.id === nodeId);
      const target = pos >= 0 ? index.readingOrder[pos + delta] : undefined;
      if (target) navigate(`/books/${bookId}/read/${target.id}`);
    };
    const onKey = (e: KeyboardEvent) => {
      const ui = useReaderUi.getState();
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault();
        ui.set({ searchOpen: true });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[role="tree"], [role="separator"]')) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const rtl = uiDir() === 'rtl';
      switch (e.code) {
        case 'ArrowLeft':
          if (window.getSelection()?.isCollapsed === false) return;
          step(rtl ? 1 : -1);
          break;
        case 'ArrowRight':
          if (window.getSelection()?.isCollapsed === false) return;
          step(rtl ? -1 : 1);
          break;
        case 'KeyT':
          ui.setTutor(!ui.isTutorVisible());
          break;
        case 'Digit1':
          ui.toggleColumn('target');
          break;
        case 'Digit2':
          ui.toggleColumn('source');
          break;
        case 'Slash':
          if (!e.shiftKey) return;
          ui.set({ helpOpen: true });
          break;
        case 'Escape':
          ui.set({ tocDrawerOpen: false, editingSegmentId: undefined });
          return;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bookId, index, navigate]);
}
