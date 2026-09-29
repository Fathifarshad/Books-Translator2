import type { SelectionContext } from '@dozabaneh/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { persistStorage, STORAGE_PREFIX } from '../lib/storage';

export type MobileMode = 'target' | 'source' | 'both';

interface ReaderUiState {
  /** Single source of truth for the node the reader shows — the tutor context line binds to it. */
  bookId?: string;
  nodeId?: string;
  showTarget: boolean;
  showSource: boolean;
  mobileMode: MobileMode;
  tocCollapsed: boolean;
  /** Desktop tutor column (persisted per device). */
  tutorOpen: boolean;
  /** Tablet drawer / phone bottom sheet — starts closed so it never covers text on arrival. */
  tutorSheetOpen: boolean;
  tocDrawerOpen: boolean;
  tocWidth: number;
  tutorWidth: number;
  searchOpen: boolean;
  searchQuery: string;
  helpOpen: boolean;
  settingsOpen: boolean;
  editingSegmentId?: string;
  /** Selection waiting in the composer (edit-before-send mode). */
  pendingQuote?: SelectionContext;
  composerFocusTick: number;
  setLocation: (bookId: string, nodeId: string) => void;
  toggleColumn: (col: 'target' | 'source') => void;
  /** Opens/closes the tutor in whatever form the current layout uses. */
  setTutor: (open: boolean) => void;
  isTutorVisible: () => boolean;
  set: (patch: Partial<ReaderUiState>) => void;
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches;

export const TOC_WIDTH = { min: 240, max: 400, initial: 300 };
export const TUTOR_WIDTH = { min: 320, max: 480, initial: 380 };

export const useReaderUi = create<ReaderUiState>()(
  persist(
    (set, get) => ({
      showTarget: true,
      showSource: true,
      mobileMode: 'target',
      tocCollapsed: false,
      tutorOpen: true,
      tutorSheetOpen: false,
      tocDrawerOpen: false,
      tocWidth: TOC_WIDTH.initial,
      tutorWidth: TUTOR_WIDTH.initial,
      searchOpen: false,
      searchQuery: '',
      helpOpen: false,
      settingsOpen: false,
      composerFocusTick: 0,
      setLocation: (bookId, nodeId) => set({ bookId, nodeId }),
      toggleColumn: (col) => {
        const { showTarget, showSource } = get();
        // At least one column stays visible.
        if (col === 'target') set({ showTarget: !showTarget || !showSource });
        else set({ showSource: !showSource || !showTarget });
      },
      setTutor: (open) => (isDesktop() ? set({ tutorOpen: open }) : set({ tutorSheetOpen: open })),
      isTutorVisible: () => (isDesktop() ? get().tutorOpen : get().tutorSheetOpen),
      set: (patch) => set(patch),
    }),
    {
      name: `${STORAGE_PREFIX}reader-ui`,
      storage: persistStorage,
      version: 1,
      // Sizes and panel states persist per device; transient UI does not.
      partialize: (s) => ({
        showTarget: s.showTarget,
        showSource: s.showSource,
        mobileMode: s.mobileMode,
        tocCollapsed: s.tocCollapsed,
        tutorOpen: s.tutorOpen,
        tocWidth: s.tocWidth,
        tutorWidth: s.tutorWidth,
      }),
    },
  ),
);
