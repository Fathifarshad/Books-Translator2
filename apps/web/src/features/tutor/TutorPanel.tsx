import { buildSection, chapterOf, glossaryFor } from '@dozabaneh/core';
import type { Citation, SelectionContext, TutorMode } from '@dozabaneh/shared';
import { DropdownMenu } from 'radix-ui';
import { type CSSProperties, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Isolate } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, IconButton } from '../../components/ui';
import { currentBookIndex, targetLangOf } from '../../data/books';
import { fmtNum, uiDigits } from '../../lib/format';
import { useOnline } from '../../lib/hooks';
import { useReaderUi } from '../../stores/reader';
import { Markdown } from './Markdown';
import { nodeLabelFor, retryAnswer, sendQuestion, stopStreaming, tutorEngineId } from './runner';
import { type ChatMessage, type Conversation, conversationsForBook, useTutor } from './store';

interface TutorPanelProps {
  bookId: string;
  onClose: () => void;
}

/** Sends a question with a context captured *now* from the reader store (bug §4.2-2). */
export function askTutor(
  bookId: string,
  question: string,
  opts: { selection?: SelectionContext; mode?: TutorMode } = {},
) {
  const nodeId = useReaderUi.getState().nodeId;
  if (!nodeId) return;
  useReaderUi.getState().setTutor(true);
  void sendQuestion({
    bookId,
    question,
    context: {
      bookId,
      nodeId,
      nodeLabel: nodeLabelFor(bookId, nodeId),
      mode: opts.mode ?? 'default',
      ...(opts.selection ? { selection: opts.selection } : {}),
    },
  });
}

export function TutorPanel({ bookId, onClose }: TutorPanelProps) {
  const { t } = useTranslation();
  const nodeId = useReaderUi((s) => s.nodeId);
  const pendingQuote = useReaderUi((s) => s.pendingQuote);
  const composerFocusTick = useReaderUi((s) => s.composerFocusTick);
  const setUi = useReaderUi((s) => s.set);
  const conversations = useTutor((s) => s.conversations);
  const activeId = useTutor((s) => s.active[bookId]);
  const conversation: Conversation | undefined = activeId ? conversations[activeId] : undefined;
  const messages = conversation?.messages ?? [];
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<TutorMode>('default');
  const online = useOnline();
  const engineId = tutorEngineId();
  const needsNetwork = engineId === 'anthropic' || engineId === 'openai';
  const streamingMsg = messages.find((m) => m.status === 'streaming');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextLabel = nodeId ? nodeLabelFor(bookId, nodeId) : '';

  const keyTerm = useMemo(() => {
    const index = currentBookIndex(bookId);
    if (!index || !nodeId) return undefined;
    const lang = targetLangOf(index);
    const section = buildSection(index, nodeId, lang);
    const text = section?.rows.map((r) => r.src.toLowerCase()).join(' ') ?? '';
    return glossaryFor(index, lang).find((g) => text.includes(g.src.toLowerCase()))?.tgt;
  }, [bookId, nodeId]);

  // Keep the newest message in view while streaming.
  const lastContent = messages.at(-1)?.content;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the last message grows
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastContent]);

  useEffect(() => {
    if (composerFocusTick > 0) inputRef.current?.focus();
  }, [composerFocusTick]);

  const send = (question: string, overrideMode?: TutorMode) => {
    const q = question.trim();
    if (!q || streamingMsg || (needsNetwork && !online)) return;
    askTutor(bookId, q, {
      mode: overrideMode ?? mode,
      ...(pendingQuote ? { selection: pendingQuote } : {}),
    });
    setDraft('');
    setMode('default');
    setUi({ pendingQuote: undefined });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const chips: { label: string; mode: TutorMode }[] = [
    { label: t('tutor.chips.simpler'), mode: 'simpler' },
    { label: t('tutor.chips.mainIdea'), mode: 'default' },
    { label: t('tutor.chips.example'), mode: 'example' },
    { label: t('tutor.chips.quizMe'), mode: 'quiz' },
    ...(keyTerm ? [{ label: t('tutor.chips.term', { term: keyTerm }), mode: 'default' as TutorMode }] : []),
  ];

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const liveText = streamingMsg
    ? t('tutor.writing')
    : lastAssistant?.status === 'complete'
      ? t('tutor.answerReady')
      : '';

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <header className="border-b border-border px-4 pt-3 pb-2">
        <div className="flex items-center gap-1">
          <h2 className="text-[15px] font-bold">{t('tutor.title')}</h2>
          <span className="ms-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted">
            {t(`tutor.engine.${engineId === 'anthropic' || engineId === 'openai' ? 'api' : engineId}`)}
          </span>
          <div className="ms-auto flex items-center">
            <Button
              variant="ghost"
              className="text-xs"
              onClick={() => useTutor.getState().newConversation(bookId)}
              disabled={Boolean(streamingMsg)}
            >
              {t('tutor.newChat')}
            </Button>
            <HistoryMenu bookId={bookId} />
            <IconButton icon="close" label={t('tutor.close')} onClick={onClose} />
          </div>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted" data-testid="tutor-context">
          {t('tutor.context', { label: '' })}
          <Isolate>{contextLabel}</Isolate>
        </p>
      </header>

      <div
        ref={listRef}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-4"
        data-testid="tutor-messages"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2.5">
            <p className="mb-2 text-[15px] text-text">{t('tutor.welcome')}</p>
            {chips.map((c) => (
              <Button key={c.label} variant="chip" className="justify-start" onClick={() => send(c.label, c.mode)}>
                {c.label}
              </Button>
            ))}
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((m) => (
              <li key={m.id}>
                {m.role === 'user' ? (
                  <UserBubble message={m} />
                ) : (
                  <AssistantMessage
                    message={m}
                    bookId={bookId}
                    conversationId={conversation?.id ?? ''}
                    onFollowup={(q) => send(q)}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        <div aria-live="polite" className="sr-only-live">
          {liveText}
        </div>
      </div>

      <footer className="border-t border-border bg-panel px-3 pt-2 pb-3">
        {pendingQuote ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-border bg-surface p-2 text-xs">
            <p className="line-clamp-2 flex-1 text-muted" lang={pendingQuote.lang} dir="auto">
              {pendingQuote.text}
            </p>
            <IconButton
              icon="close"
              label={t('tutor.removeQuote')}
              size={14}
              className="size-6"
              onClick={() => setUi({ pendingQuote: undefined })}
            />
          </div>
        ) : null}
        <div className="mb-2 flex gap-1.5">
          {(['simpler', 'deeper'] as const).map((m) => (
            <Button
              key={m}
              variant="pill"
              className="px-2.5 py-0.5 text-xs"
              aria-pressed={mode === m}
              onClick={() => setMode(mode === m ? 'default' : m)}
            >
              {t(`tutor.modes.${m}`)}
            </Button>
          ))}
        </div>
        {needsNetwork && !online ? <p className="mb-2 text-xs text-danger">{t('tutor.offline')}</p> : null}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-surface p-1.5 focus-within:border-accent/60">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            dir="auto"
            aria-label={t('tutor.placeholder')}
            placeholder={t('tutor.placeholder')}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted"
            style={{ fieldSizing: 'content' } as CSSProperties}
          />
          {streamingMsg ? (
            <IconButton icon="stop" label={t('tutor.stop')} onClick={() => stopStreaming(streamingMsg.id)} />
          ) : (
            <IconButton
              icon="send"
              label={t('tutor.send')}
              className="bg-accent text-on-accent hover:bg-accent-hover hover:text-on-accent"
              disabled={!draft.trim() || (needsNetwork && !online)}
              onClick={() => send(draft)}
            />
          )}
        </div>
      </footer>
    </div>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  const selection = message.context?.selection;
  return (
    <div className="ms-6 rounded-xl bg-accent-soft/70 px-3 py-2.5 text-sm">
      {selection ? (
        <blockquote
          lang={selection.lang}
          dir="auto"
          className="mb-2 line-clamp-4 border-s-2 border-accent/50 ps-2 text-[13px] text-muted"
        >
          {selection.text}
        </blockquote>
      ) : null}
      <p dir="auto" className="whitespace-pre-wrap">
        {message.content}
      </p>
      {message.context ? (
        <p className="mt-1.5 text-[11px] text-muted" data-testid="message-context">
          <Isolate>{message.context.nodeLabel}</Isolate>
        </p>
      ) : null}
    </div>
  );
}

function AssistantMessage({
  message,
  bookId,
  conversationId,
  onFollowup,
}: {
  message: ChatMessage;
  bookId: string;
  conversationId: string;
  onFollowup: (q: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const streaming = message.status === 'streaming';

  const citationLabel = (c: Citation) => {
    const index = currentBookIndex(bookId);
    if (!index) return c.label;
    const lang = targetLangOf(index);
    const section = buildSection(index, c.nodeId, lang);
    const row = section?.rows.find((r) => r.segmentId === c.segmentId);
    const chapter = chapterOf(index, c.nodeId);
    const location = chapter?.numberLabel
      ? t('reader.chapter', { n: uiDigits(chapter.numberLabel) })
      : (section?.title.tgt ?? section?.title.src ?? '');
    return t('tutor.citation', { location, n: fmtNum(row?.paragraphNumber ?? 0) });
  };

  const go = (c: Citation) => navigate(`/books/${bookId}/read/${c.nodeId}?seg=${c.segmentId}`);

  return (
    <div className="text-[14.5px] leading-7" data-testid="assistant-message" data-status={message.status}>
      {message.content ? (
        <Markdown
          text={message.content}
          citations={message.citations}
          renderCitation={(c, label) =>
            c ? (
              <button
                type="button"
                onClick={() => go(c)}
                className="mx-0.5 inline-flex translate-y-[-2px] items-center rounded-full bg-accent-soft px-1.5 text-[11px] leading-5 text-accent hover:bg-accent hover:text-on-accent"
                aria-label={citationLabel(c)}
                title={citationLabel(c)}
              >
                {fmtNum(Number(label.slice(1)))}
              </button>
            ) : streaming ? (
              <span className="mx-0.5 rounded-full bg-border px-1.5 text-[11px] text-muted">…</span>
            ) : null
          }
        />
      ) : streaming ? (
        <p className="animate-pulse text-muted">{t('tutor.writing')}</p>
      ) : null}

      {message.status === 'error' ? (
        <div role="alert" className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
          <p className="text-danger">
            {t('tutor.incomplete', { reason: t(`tutor.errors.${message.errorCode ?? 'UNKNOWN'}`) })}
          </p>
          <Button className="mt-2" icon="history" onClick={() => void retryAnswer(conversationId, message.id)}>
            {t('app.retry')}
          </Button>
        </div>
      ) : null}
      {message.status === 'stopped' ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted">
          <span>{t('tutor.stopped')}</span>
          <Button variant="ghost" onClick={() => void retryAnswer(conversationId, message.id)}>
            {t('app.retry')}
          </Button>
        </div>
      ) : null}

      {message.citations.length > 0 && !streaming ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" data-testid="citations">
          <span className="text-muted">{t('tutor.sources')}:</span>
          {message.citations.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => go(c)}
              className="rounded-full border border-border bg-surface px-2 py-0.5 text-text hover:border-accent/60 hover:text-accent"
              data-testid="citation-chip"
              data-node-id={c.nodeId}
            >
              {citationLabel(c)}
            </button>
          ))}
        </div>
      ) : null}

      {message.status === 'complete' && message.followups.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5" title={t('tutor.followups')}>
          {message.followups.map((f) => (
            <Button key={f} variant="chip" className="px-2.5 py-1 text-xs" onClick={() => onFollowup(f)}>
              {f}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HistoryMenu({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const conversations = useTutor((s) => s.conversations);
  const activeId = useTutor((s) => s.active[bookId]);
  const list = conversationsForBook(conversations, bookId);
  return (
    <DropdownMenu.Root dir="rtl">
      <DropdownMenu.Trigger asChild>
        <IconButton icon="history" label={t('tutor.history')} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 max-h-80 w-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-popover)]"
        >
          {list.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">{t('tutor.noHistory')}</p>
          ) : (
            list.map((c) => (
              <DropdownMenu.Item
                key={c.id}
                onSelect={() => useTutor.getState().setActive(bookId, c.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-row-hover ${
                  c.id === activeId ? 'text-accent' : ''
                }`}
              >
                <span className="flex-1 truncate" dir="auto">
                  {c.title || t('tutor.untitled')}
                </span>
                <span className="text-[11px] text-muted">
                  {fmtNum(c.messages.filter((m) => m.role === 'user').length)}
                </span>
              </DropdownMenu.Item>
            ))
          )}
          {activeId && conversations[activeId]?.messages.length ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                onSelect={() => exportConversation(conversations[activeId] as Conversation)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-row-hover"
              >
                <Icon name="download" size={16} />
                {t('tutor.exportChat')}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => useTutor.getState().deleteConversation(activeId)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft"
              >
                <Icon name="trash" size={16} />
                {t('tutor.deleteChat')}
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function exportConversation(conv: Conversation) {
  const lines = conv.messages.map((m) => {
    const quote = m.context?.selection ? `> ${m.context.selection.text.replace(/\n/g, '\n> ')}\n\n` : '';
    return `### ${m.role === 'user' ? 'Q' : 'A'}\n\n${quote}${m.content}\n`;
  });
  const blob = new Blob([`# ${conv.title}\n\n${lines.join('\n')}`], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${conv.id}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
