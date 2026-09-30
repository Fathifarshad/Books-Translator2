import { type ReactNode, useRef, useState } from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

const SNAPS = [0.45, 0.92] as const;

/**
 * Non-modal bottom sheet for the tutor on phones (SPEC §11.1): snap points ~45% / ~92% of the dynamic
 * viewport, drag the handle to switch; the reader reserves bottom padding so text stays reachable.
 */
export function BottomSheet({ open, onClose, label, children }: BottomSheetProps) {
  const [snap, setSnap] = useState<0 | 1>(0);
  const [dragOffset, setDragOffset] = useState(0);
  const start = useRef<number | null>(null);

  if (!open) return null;
  const height = `calc(${SNAPS[snap] * 100}dvh - ${dragOffset}px)`;

  return (
    <section
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-border bg-panel shadow-[var(--shadow-popover)]"
      style={{ height, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <button
        type="button"
        aria-label={label}
        className="flex h-6 w-full touch-none items-center justify-center"
        onClick={() => setSnap(snap === 0 ? 1 : 0)}
        onPointerDown={(e) => {
          start.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current !== null) setDragOffset(e.clientY - start.current);
        }}
        onPointerUp={() => {
          if (start.current === null) return;
          const moved = dragOffset;
          start.current = null;
          setDragOffset(0);
          if (moved < -40) setSnap(1);
          else if (moved > 120 && snap === 0) onClose();
          else if (moved > 40) setSnap(0);
        }}
      >
        <span className="h-1 w-10 rounded-full bg-border" />
      </button>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export const BOTTOM_SHEET_RESERVE = '45dvh';
