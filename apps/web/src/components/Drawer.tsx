import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Logical side: `start` is the right edge in RTL, `end` the left edge. */
  side: 'start' | 'end';
  title: string;
  children: ReactNode;
  width?: string;
}

/** Modal side drawer used for the TOC and tutor on tablet/mobile (SPEC §11.1). */
export function Drawer({ open, onOpenChange, side, title, children, width = 'min(88vw, 360px)' }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className={`fixed inset-y-0 z-50 flex flex-col bg-panel shadow-[var(--shadow-popover)] outline-none ${
            side === 'start' ? 'start-0 border-e' : 'end-0 border-s'
          } border-border`}
          style={{ width, paddingBlock: 'env(safe-area-inset-top) env(safe-area-inset-bottom)' }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
