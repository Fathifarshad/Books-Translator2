import { buildToc, type NodeTranslationStatus, type TocEntry } from '@dozabaneh/core';
import { dirOf } from '@dozabaneh/text';
import { Popover } from 'radix-ui';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { IconButton, ProgressBar } from '../../components/ui';
import { progressRatio } from '../../data/books';
import { uiDir } from '../../i18n';
import { fmtNum, fmtPct, uiDigits } from '../../lib/format';
import { useLibrary } from '../../stores/library';
import { useReaderUi } from '../../stores/reader';
import { useSettings } from '../../stores/settings';
import { useReader } from './context';

const STATUS_ICON: Record<NodeTranslationStatus, string> = {
  final: '✓',
  in_progress: '◐',
  not_started: '○',
  needs_review: '⚠',
  waiting_agent: '⏸',
};
const STATUS_KEY: Record<NodeTranslationStatus, string> = {
  final: 'final',
  in_progress: 'inProgress',
  not_started: 'notStarted',
  needs_review: 'needsReview',
  waiting_agent: 'waitingAgent',
};
const STATUS_COLOR: Record<NodeTranslationStatus, string> = {
  final: 'text-success',
  in_progress: 'text-accent',
  not_started: 'text-muted',
  needs_review: 'text-warning',
  waiting_agent: 'text-muted',
};

interface FlatItem {
  key: string;
  entry?: TocEntry;
  /** Virtual «آزمون این فصل» item. */
  quizFor?: TocEntry;
  level: number;
  parentKey?: string;
}

/** TOC sidebar «فهرست» (SPEC §11.3): book info, counter, search, tree with legend-backed indicators. */
export function TocSidebar({ onNavigate, onCollapse }: { onNavigate?: () => void; onCollapse?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bookId, index, section, sourceLang, targetLang } = useReader();
  const tocTitles = useSettings((s) => s.tocTitles);
  const readIds = useLibrary((s) => s.progress[bookId]?.readNodeIds);
  const read = useMemo(() => new Set(readIds ?? []), [readIds]);
  const toc = useMemo(() => buildToc(index, targetLang), [index, targetLang]);
  const { ratio, done, total } = progressRatio(index);
  const currentChapter = section.chapter?.id;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(currentChapter ? [currentChapter] : []));
  const [focusKey, setFocusKey] = useState<string>(section.node.id);
  const treeRef = useRef<HTMLDivElement>(null);
  const book = index.book;

  // The current chapter auto-expands and the current section scrolls into view.
  useEffect(() => {
    if (currentChapter) setExpanded((prev) => (prev.has(currentChapter) ? prev : new Set([...prev, currentChapter])));
    setFocusKey(section.node.id);
    const el = treeRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentChapter, section.node.id]);

  const flat: FlatItem[] = [];
  for (const e of toc) {
    flat.push({ key: e.id, entry: e, level: 1 });
    if (e.kind === 'chapter' && expanded.has(e.id)) {
      for (const c of e.children) flat.push({ key: c.id, entry: c, level: 2, parentKey: e.id });
      flat.push({ key: `quiz-${e.id}`, quizFor: e, level: 2, parentKey: e.id });
    }
  }

  const open = (item: FlatItem) => {
    if (item.quizFor) navigate(`/books/${bookId}/quiz/${item.quizFor.id}`);
    else if (item.entry?.targetId) navigate(`/books/${bookId}/read/${item.entry.targetId}`);
    onNavigate?.();
  };

  const toggle = (id: string, force?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const on = force ?? !next.has(id);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = flat.findIndex((f) => f.key === focusKey);
    const item = flat[i];
    if (!item) return;
    const rtl = uiDir() === 'rtl';
    const expandKey = rtl ? 'ArrowLeft' : 'ArrowRight';
    const collapseKey = rtl ? 'ArrowRight' : 'ArrowLeft';
    let next: string | undefined;
    if (e.key === 'ArrowDown') next = flat[i + 1]?.key;
    else if (e.key === 'ArrowUp') next = flat[i - 1]?.key;
    else if (e.key === 'Home') next = flat[0]?.key;
    else if (e.key === 'End') next = flat.at(-1)?.key;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(item);
      return;
    } else if (e.key === expandKey && item.entry?.kind === 'chapter') toggle(item.entry.id, true);
    else if (e.key === collapseKey) {
      if (item.entry?.kind === 'chapter' && expanded.has(item.entry.id)) toggle(item.entry.id, false);
      else if (item.parentKey) next = item.parentKey;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    if (next) {
      setFocusKey(next);
      requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-key="${next}"]`)?.focus());
    }
  };

  const titleOf = (entry: TocEntry) => {
    const { src, tgt } = entry.title;
    const showTgt = tocTitles !== 'source' && tgt;
    return (
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-2">
          {entry.kind === 'chapter' && entry.numberLabel ? (
            <span>{t('reader.chapterPrefix', { n: uiDigits(entry.numberLabel) })} </span>
          ) : null}
          {entry.kind === 'chapter_intro' ? (
            t('reader.chapterIntro')
          ) : showTgt ? (
            <LangText lang={targetLang}>{tgt}</LangText>
          ) : (
            <LangText lang={sourceLang}>{src}</LangText>
          )}
        </span>
        {tocTitles === 'both' && showTgt && entry.kind !== 'chapter_intro' ? (
          // The run's own direction on the truncating box keeps the ellipsis at the run's end, while
          // alignment follows the UI start side.
          <span
            lang={sourceLang}
            dir={dirOf(sourceLang)}
            className={`block truncate text-[11px] text-muted ${dirOf(sourceLang) === uiDir() ? 'text-start' : 'text-end'}`}
          >
            {src}
          </span>
        ) : null}
      </span>
    );
  };

  return (
    <nav aria-label={t('reader.toc')} className="flex h-full min-h-0 flex-col bg-panel">
      <div className="border-b border-border px-4 pt-3 pb-3">
        <div className="flex items-center">
          <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
            <Icon name="back" size={14} />
            {t('reader.backToLibrary')}
          </Link>
          {onCollapse ? (
            <IconButton
              icon="sidebar"
              label={t('reader.collapseToc')}
              className="ms-auto size-8"
              onClick={onCollapse}
            />
          ) : null}
        </div>
        <h2 className="mt-2 text-lg font-bold leading-8">
          <LangText lang={targetLang}>{book.titles[targetLang] ?? book.titles[sourceLang] ?? ''}</LangText>
        </h2>
        <p className="text-xs text-muted">
          <LangText lang={sourceLang}>{book.titles[sourceLang] ?? ''}</LangText>
        </p>
        <p className="mt-1 text-[11px] text-muted" data-testid="book-meta">
          <LangText lang={sourceLang}>
            {[book.authors.join(' & '), [book.publisher, book.year].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(' — ')}
          </LangText>
        </p>
        <p className="mt-2 text-xs text-muted" data-testid="translated-counter">
          {t('reader.translatedCounter', { percent: fmtPct(ratio), done: fmtNum(done), total: fmtNum(total) })}
        </p>
        <div className="mt-1.5">
          <ProgressBar
            value={ratio}
            label={t('reader.translatedCounter', { percent: fmtPct(ratio), done: fmtNum(done), total: fmtNum(total) })}
          />
        </div>
        <button
          type="button"
          onClick={() => useReaderUi.getState().set({ searchOpen: true })}
          className="mt-3 flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-start text-sm text-muted hover:border-accent/50"
          data-testid="toc-search"
        >
          <Icon name="search" size={16} />
          <span className="flex-1 truncate">{t('reader.search')}</span>
        </button>
      </div>

      <div
        ref={treeRef}
        role="tree"
        aria-label={t('reader.toc')}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2"
        onKeyDown={onKeyDown}
        data-testid="toc-tree"
      >
        {flat.map((item) => {
          const entry = item.entry;
          const isChapter = entry?.kind === 'chapter';
          const current = entry?.id === section.node.id;
          const isRead = entry ? read.has(entry.id) : false;
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled once by the tree (roving tabindex)
            <div
              key={item.key}
              role="treeitem"
              data-key={item.key}
              aria-level={item.level}
              aria-expanded={isChapter ? expanded.has(entry.id) : undefined}
              aria-current={current ? 'page' : undefined}
              aria-selected={current}
              tabIndex={item.key === focusKey ? 0 : -1}
              onFocus={() => setFocusKey(item.key)}
              onClick={() => {
                if (isChapter) toggle(entry.id, true);
                open(item);
              }}
              className={`group flex cursor-pointer items-start gap-1.5 rounded-lg py-1.5 text-[13.5px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                item.level === 2 ? 'ps-6 pe-2' : 'ps-1 pe-2'
              } ${current ? 'bg-accent-soft font-medium text-accent' : 'text-text hover:bg-row-hover'}`}
            >
              {isChapter ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(entry.id);
                  }}
                  className="mt-1 text-muted"
                >
                  <Icon name={expanded.has(entry.id) ? 'chevronDown' : 'chevronBack'} size={14} />
                </button>
              ) : item.level === 1 ? (
                <span className="w-3.5" />
              ) : null}
              <span className="min-w-0 flex-1">
                {item.quizFor ? (
                  <span className="inline-flex items-center gap-1 text-muted">
                    <Icon name="quiz" size={14} />
                    {t('reader.chapterQuiz')}
                  </span>
                ) : entry ? (
                  titleOf(entry)
                ) : null}
              </span>
              {entry && !isChapter ? (
                <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[12px]">
                  <span
                    role="img"
                    className={STATUS_COLOR[entry.status]}
                    title={t(`reader.status.${STATUS_KEY[entry.status]}`)}
                    aria-label={t(`reader.status.${STATUS_KEY[entry.status]}`)}
                    data-status={entry.status}
                  >
                    {STATUS_ICON[entry.status]}
                  </span>
                  <span
                    role="img"
                    className={isRead ? 'text-accent' : 'text-muted'}
                    title={t(`reader.status.${isRead ? 'read' : 'unread'}`)}
                    aria-label={t(`reader.status.${isRead ? 'read' : 'unread'}`)}
                  >
                    {isRead ? '●' : '○'}
                  </span>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border px-4 py-2">
        <StatusLegend />
      </div>
    </nav>
  );
}

/** Tooltip legend for the TOC indicators — fixes prototype bug §4.2-8. */
export function StatusLegend() {
  const { t } = useTranslation();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent"
          data-testid="legend-button"
        >
          <Icon name="info" size={14} />
          {t('reader.legend')}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 w-60 rounded-xl border border-border bg-surface p-3 text-sm shadow-[var(--shadow-popover)]"
          data-testid="legend"
        >
          <p className="mb-1.5 text-xs font-bold text-muted">{t('reader.legendTranslation')}</p>
          <ul className="space-y-1">
            {(Object.keys(STATUS_ICON) as NodeTranslationStatus[]).map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className={`w-4 text-center ${STATUS_COLOR[s]}`}>{STATUS_ICON[s]}</span>
                {t(`reader.status.${STATUS_KEY[s]}`)}
              </li>
            ))}
          </ul>
          <p className="mt-3 mb-1.5 text-xs font-bold text-muted">{t('reader.legendReading')}</p>
          <ul className="space-y-1">
            <li className="flex items-center gap-2">
              <span className="w-4 text-center text-accent">●</span>
              {t('reader.status.read')}
            </li>
            <li className="flex items-center gap-2">
              <span className="w-4 text-center text-muted">○</span>
              {t('reader.status.unread')}
            </li>
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
