import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, IconButton } from '../../components/ui';
import { languageName, uiDigits } from '../../lib/format';
import { copyText, type Layout } from '../../lib/hooks';
import { useLibrary } from '../../stores/library';
import { type MobileMode, useReaderUi } from '../../stores/reader';
import { useReader } from './context';
import { SummaryCard } from './SummaryCard';

/** Breadcrumb, titles, column toggles, prev/next, ⋯ menu, tutor toggle and summary (SPEC §11.2). */
export function ReaderHeader({ layout, twoColumns }: { layout: Layout; twoColumns: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bookId, section, sourceLang, targetLang } = useReader();
  const ui = useReaderUi();
  const chapter = section.chapter;
  const title = section.node.kind === 'chapter_intro' ? undefined : section.title;
  const go = (id?: string) => id && navigate(`/books/${bookId}/read/${id}`);

  const breadcrumb = (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted" data-testid="breadcrumb">
      {chapter ? (
        <>
          <span>{t('reader.chapter', { n: uiDigits(chapter.numberLabel ?? '') })}</span>
          <span aria-hidden="true">·</span>
          {chapter.title.tgt ? (
            <LangText lang={targetLang}>{chapter.title.tgt}</LangText>
          ) : (
            <LangText lang={sourceLang}>{chapter.title.src}</LangText>
          )}
          <span aria-hidden="true">·</span>
        </>
      ) : null}
      <span>
        {section.pageLabels.from === section.pageLabels.to
          ? t('reader.page', { n: uiDigits(section.pageLabels.from) })
          : t('reader.pages', { from: uiDigits(section.pageLabels.from), to: uiDigits(section.pageLabels.to) })}
      </span>
    </p>
  );

  const columnToggles =
    layout === 'mobile' || !twoColumns ? (
      // Native radios: arrow-key behaviour and semantics for free; the input covers its label.
      <fieldset className="flex rounded-full border border-border bg-surface p-0.5 text-xs">
        <legend className="sr-only">{t('reader.viewMode')}</legend>
        {(
          [
            ['target', languageName(targetLang)],
            ['source', languageName(sourceLang)],
            ['both', t('reader.both')],
          ] as [MobileMode, string][]
        ).map(([mode, label]) => (
          <label
            key={mode}
            className="relative rounded-full px-3 py-1 text-muted has-checked:bg-accent-soft has-checked:text-accent has-focus-visible:ring-2 has-focus-visible:ring-accent"
          >
            <input
              type="radio"
              name="reader-view-mode"
              value={mode}
              checked={ui.mobileMode === mode}
              onChange={() => ui.set({ mobileMode: mode })}
              className="absolute inset-0 cursor-pointer appearance-none rounded-full outline-none"
            />
            {label}
          </label>
        ))}
      </fieldset>
    ) : (
      <div className="flex gap-1.5">
        <Button
          variant="pill"
          aria-pressed={ui.showTarget}
          onClick={() => ui.toggleColumn('target')}
          aria-label={t('reader.columnToggle', { language: languageName(targetLang) })}
        >
          {languageName(targetLang)}
        </Button>
        <Button
          variant="pill"
          aria-pressed={ui.showSource}
          onClick={() => ui.toggleColumn('source')}
          aria-label={t('reader.columnToggle', { language: languageName(sourceLang) })}
        >
          {languageName(sourceLang)}
        </Button>
      </div>
    );

  return (
    <header className="border-b border-border bg-bg/95 px-5 pt-3 pb-3 backdrop-blur md:px-8">
      <div className="flex items-center gap-2">
        {layout !== 'desktop' ? (
          <IconButton icon="menu" label={t('reader.openToc')} onClick={() => ui.set({ tocDrawerOpen: true })} />
        ) : null}
        <div className="min-w-0 flex-1">{breadcrumb}</div>
        <MoreMenu />
        {layout !== 'mobile' ? (
          <Button
            variant="pill"
            aria-pressed={layout === 'desktop' ? ui.tutorOpen : ui.tutorSheetOpen}
            icon="chat"
            onClick={() => ui.setTutor(!(layout === 'desktop' ? ui.tutorOpen : ui.tutorSheetOpen))}
            data-testid="tutor-toggle"
          >
            {t('reader.toggleTutor')}
          </Button>
        ) : null}
      </div>

      <div className="mt-2">
        {title ? (
          <>
            <h1 className="text-xl font-bold leading-9 md:text-2xl" data-testid="section-title">
              {title.tgt ? (
                <LangText lang={targetLang}>{title.tgt}</LangText>
              ) : (
                <LangText lang={sourceLang}>{title.src}</LangText>
              )}
            </h1>
            {title.tgt ? (
              <p className="text-sm text-muted">
                <LangText lang={sourceLang}>{title.src}</LangText>
              </p>
            ) : null}
          </>
        ) : (
          <h1 className="text-xl font-bold leading-9 md:text-2xl" data-testid="section-title">
            {t('reader.chapterIntro')}
          </h1>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {columnToggles}
        <div className="ms-auto flex gap-1.5">
          <Button icon="back" onClick={() => go(section.prevId)} disabled={!section.prevId} data-testid="prev-section">
            {t('reader.prev')}
          </Button>
          <Button
            iconEnd="forward"
            onClick={() => go(section.nextId)}
            disabled={!section.nextId}
            data-testid="next-section"
          >
            {t('reader.next')}
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <SummaryCard />
      </div>
    </header>
  );
}

function MoreMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bookId, section } = useReader();
  const ui = useReaderUi();
  const item =
    'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-row-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
  return (
    <DropdownMenu.Root dir="rtl">
      <DropdownMenu.Trigger asChild>
        <IconButton icon="more" label={t('reader.moreOptions')} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 w-60 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-popover)]"
        >
          <DropdownMenu.Item className={item} disabled>
            <Icon name="book" size={16} />
            {t('reader.viewOriginalPage')}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={item}
            onSelect={() => void copyText(`${window.location.origin}/books/${bookId}/read/${section.node.id}`)}
          >
            <Icon name="link" size={16} />
            {t('reader.copyLink')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => useLibrary.getState().markRead(bookId, section.node.id)}>
            <Icon name="check" size={16} />
            {t('reader.markRead')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => ui.set({ settingsOpen: true })}>
            <Icon name="settings" size={16} />
            {t('reader.displaySettings')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => ui.set({ helpOpen: true })}>
            <Icon name="keyboard" size={16} />
            {t('shortcuts.help')}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={item} onSelect={() => navigate(`/books/${bookId}/pipeline`)}>
            <Icon name="sparkle" size={16} />
            {t('reader.openPipeline')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => navigate(`/books/${bookId}/glossary`)}>
            <Icon name="book" size={16} />
            {t('reader.openGlossaryPage')}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => navigate(`/books/${bookId}/review`)}>
            <Icon name="warning" size={16} />
            {t('reader.openReview')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
