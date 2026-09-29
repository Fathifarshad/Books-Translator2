import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Kbd } from '../../components/ui';
import { languageName } from '../../lib/format';
import { useReaderUi } from '../../stores/reader';
import { DisplaySettingsForm } from '../settings/DisplaySettingsForm';
import { useReader } from './context';

function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-3 top-[6dvh] z-50 mx-auto max-h-[88dvh] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-popover)]"
        >
          <div className="mb-4 flex items-center">
            <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon="close" label={t('app.close')} className="ms-auto" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DisplaySettingsDialog() {
  const { t } = useTranslation();
  const { sourceLang, targetLang } = useReader();
  const open = useReaderUi((s) => s.settingsOpen);
  const set = useReaderUi((s) => s.set);
  return (
    <Modal open={open} onOpenChange={(o) => set({ settingsOpen: o })} title={t('reader.displaySettings')}>
      <DisplaySettingsForm sourceLang={sourceLang} targetLang={targetLang} />
    </Modal>
  );
}

/** Shortcut help «?» (SPEC §11.12). Keys match `event.code`, so they work with a Persian layout too. */
export function ShortcutsDialog() {
  const { t } = useTranslation();
  const { sourceLang, targetLang } = useReader();
  const open = useReaderUi((s) => s.helpOpen);
  const set = useReaderUi((s) => s.set);
  const rows: [ReactNode, string][] = [
    [<Kbd key="l">←</Kbd>, t('shortcuts.next')],
    [<Kbd key="r">→</Kbd>, t('shortcuts.prev')],
    [
      <span key="k" className="inline-flex gap-1">
        <Kbd>Ctrl/⌘</Kbd>
        <Kbd>K</Kbd>
      </span>,
      t('shortcuts.search'),
    ],
    [<Kbd key="t">T</Kbd>, t('shortcuts.toggleTutor')],
    [<Kbd key="1">1</Kbd>, t('shortcuts.toggleColumn', { language: languageName(targetLang) })],
    [<Kbd key="2">2</Kbd>, t('shortcuts.toggleColumn', { language: languageName(sourceLang) })],
    [<Kbd key="e">Esc</Kbd>, t('shortcuts.close')],
    [<Kbd key="q">?</Kbd>, t('shortcuts.title')],
  ];
  return (
    <Modal open={open} onOpenChange={(o) => set({ helpOpen: o })} title={t('shortcuts.title')}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={label} className="border-b border-border last:border-0">
              <td className="py-2 pe-4">{keys}</td>
              <td className="py-2">{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
