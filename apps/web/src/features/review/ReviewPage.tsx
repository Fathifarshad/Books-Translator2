import { type DiffOp, diffWords, stripMarkup } from '@dozabaneh/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, Kbd } from '../../components/ui';
import { api, type ReviewAction, type ReviewItem } from '../../lib/api';
import { fmtNum, fmtPct } from '../../lib/format';
import { reviewKey, targetOf, useBookLiveUpdates } from '../pipeline/live';

const QA_KEYS = new Set([
  'empty',
  'markup',
  'numbers',
  'target_script',
  'untranslated',
  'repetition',
  'glossary',
  'name',
  'leftover_chars',
  'latin_punctuation',
  'length',
  'editor',
  'low_confidence',
  'memory',
]);

/** Review queue «صف بازبینی» (SPEC §13.5): flagged or low-confidence segments, keyboard-driven with J/K. */
export function ReviewPage() {
  const { t } = useTranslation();
  const { bookId = '' } = useParams();
  const detail = useQuery({ queryKey: ['book', bookId], queryFn: () => api.book(bookId), enabled: Boolean(bookId) });
  const book = detail.data?.book;
  const lang = book ? targetOf(book) : '';
  const [filter, setFilter] = useState<'flagged' | 'all'>('flagged');
  const review = useQuery({
    queryKey: reviewKey(bookId, lang, filter),
    queryFn: () => api.review(bookId, lang, filter),
    enabled: Boolean(lang),
  });
  useBookLiveUpdates(bookId);
  const items = review.data?.items ?? [];
  const [focus, setFocus] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);

  // J / K by physical key (event.code), so it works with a Persian keyboard layout too (SPEC §11.12).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey)
        return;
      if (e.code !== 'KeyJ' && e.code !== 'KeyK') return;
      e.preventDefault();
      setFocus((f) => {
        const next = Math.max(0, Math.min(items.length - 1, f + (e.code === 'KeyJ' ? 1 : -1)));
        const el = listRef.current?.querySelectorAll<HTMLElement>('[data-review-item]')[next];
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el?.focus({ preventScroll: true });
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length]);

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-4xl px-5 py-8">
      <Link
        to={`/books/${bookId}/pipeline`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
      >
        <Icon name="back" size={16} />
        {t('pipeline.title')}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('review.title')}</h1>
          {book ? (
            <p className="text-sm text-muted">
              <LangText lang={book.sourceLang}>{book.titles[book.sourceLang] ?? ''}</LangText>
            </p>
          ) : null}
        </div>
        <div className="ms-auto flex gap-2">
          {(['flagged', 'all'] as const).map((f) => (
            <Button key={f} variant="pill" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`review.filters.${f}`)}
            </Button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
        <Kbd>J</Kbd> <Kbd>K</Kbd> {t('review.keys')}
      </p>

      {items.length === 0 ? (
        <p
          className="mt-10 rounded-2xl border border-border bg-surface p-6 text-center text-muted"
          data-testid="review-empty"
        >
          {review.isLoading ? t('app.loading') : t('review.empty')}
        </p>
      ) : (
        <ol ref={listRef} className="mt-5 space-y-4" data-testid="review-list">
          {items.map((item, i) => (
            <ReviewCard
              key={item.segmentId}
              item={item}
              bookId={bookId}
              lang={lang}
              srcLang={book?.sourceLang ?? 'en'}
              focused={i === focus}
              position={t('review.position', { index: fmtNum(i + 1), total: fmtNum(items.length) })}
            />
          ))}
        </ol>
      )}
    </main>
  );
}

function ReviewCard({
  item,
  bookId,
  lang,
  srcLang,
  focused,
  position,
}: {
  item: ReviewItem;
  bookId: string;
  lang: string;
  srcLang: string;
  focused: boolean;
  position: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.final ?? item.draft ?? '');
  const [notice, setNotice] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['review', bookId] });
    void queryClient.invalidateQueries({ queryKey: ['pipeline', bookId] });
    void queryClient.invalidateQueries({ queryKey: ['bundle', bookId] });
  };
  const act = useMutation({
    mutationFn: (action: ReviewAction) => api.reviewAction(item.segmentId, lang, action),
    onSuccess: (_r, action) => {
      if (action === 'rerun') setNotice(t('review.queued'));
      refresh();
    },
  });
  const save = useMutation({
    mutationFn: () => api.editTranslation(item.segmentId, lang, text.trim()),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const changed = item.draft !== null && item.final !== null && item.draft !== item.final;
  const reasonOf = (code: string) => t(`review.qa.${QA_KEYS.has(code) ? code : 'other'}`);

  return (
    <li
      data-review-item
      tabIndex={-1}
      className={`rounded-2xl border bg-surface p-4 outline-none ${focused ? 'border-accent/70 ring-2 ring-accent/20' : 'border-border'}`}
      data-testid="review-item"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{position}</span>
        <span className="min-w-0 flex-1 truncate">
          <LangText lang={lang}>{item.location.join(' › ')}</LangText>
        </span>
        {item.confidence !== null ? <span>{t('review.confidence', { percent: fmtPct(item.confidence) })}</span> : null}
        <Link to={`/books/${bookId}/read/${item.nodeId}?seg=${item.segmentId}`} className="text-accent underline">
          {t('review.open')}
        </Link>
      </div>

      {item.flags.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {item.flags.map((f) => (
            <li
              key={`${f.code}-${f.reason}`}
              className={`rounded-full px-2 py-0.5 text-xs ${f.severity === 'high' ? 'bg-danger-soft text-danger' : 'bg-warning/15 text-warning'}`}
              title={f.reason}
            >
              {reasonOf(f.code)}
            </li>
          ))}
        </ul>
      ) : null}
      {item.flags.some((f) => f.code === 'editor') ? (
        <p className="mt-2 text-sm">
          <span className="text-muted">{t('review.reason')}: </span>
          <LangText lang={lang}>{item.flags.find((f) => f.code === 'editor')?.reason ?? ''}</LangText>
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section>
          <h3 className="mb-1 text-xs font-bold text-muted">{t('review.source')}</h3>
          <p className="rounded-xl bg-panel p-3 text-sm leading-7" lang={srcLang} dir="ltr">
            {stripMarkup(item.src)}
          </p>
        </section>
        <section>
          <h3 className="mb-1 text-xs font-bold text-muted">{changed ? t('review.changes') : t('review.final')}</h3>
          {editing ? (
            <div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                lang={lang}
                dir="auto"
                rows={5}
                aria-label={t('review.edit')}
                className="reader-text w-full rounded-xl border border-border bg-bg p-3 text-sm leading-7 outline-none focus:border-accent/60"
              />
              <div className="mt-2 flex gap-2">
                <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !text.trim()}>
                  {t('reader.saveEdit')}
                </Button>
                <Button onClick={() => setEditing(false)}>{t('app.cancel')}</Button>
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-panel p-3 text-sm leading-7" lang={lang} dir="auto" data-testid="review-text">
              {changed ? (
                <Diff ops={diffWords(item.draft ?? '', item.final ?? '')} />
              ) : (
                (item.final ?? item.draft ?? '')
              )}
            </p>
          )}
        </section>
      </div>

      {item.note ? (
        <p className="mt-2 text-sm">
          <span className="text-muted">{t('review.noteLabel')}: </span>
          <LangText lang={lang}>{item.note}</LangText>
        </p>
      ) : null}

      {item.suggestion ? (
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent-soft/40 p-3 text-sm">
          <p className="mb-1 text-xs font-bold text-muted">{t('review.suggestion')}</p>
          <p lang={lang} dir="auto" className="leading-7">
            {item.suggestion}
          </p>
          <div className="mt-2 flex gap-2">
            <Button className="px-2 py-1 text-xs" onClick={() => act.mutate('accept_suggestion')}>
              {t('review.acceptSuggestion')}
            </Button>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => act.mutate('dismiss_suggestion')}>
              {t('review.dismissSuggestion')}
            </Button>
          </div>
        </div>
      ) : null}

      {!editing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.status === 'flagged' ? (
            <Button
              variant="primary"
              icon="check"
              onClick={() => act.mutate('approve')}
              disabled={act.isPending}
              data-testid="review-approve"
            >
              {t('review.accept')}
            </Button>
          ) : null}
          <Button icon="edit" onClick={() => setEditing(true)}>
            {t('review.edit')}
          </Button>
          <Button icon="history" onClick={() => act.mutate('rerun')} disabled={act.isPending}>
            {t('review.rerun')}
          </Button>
          {changed && item.status !== 'user_edited' ? (
            <Button variant="ghost" onClick={() => act.mutate('reject')} disabled={act.isPending}>
              {t('review.reject')}
            </Button>
          ) : null}
          {notice ? (
            <span className="self-center text-sm text-muted" role="status">
              {notice}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Diff({ ops }: { ops: DiffOp[] }) {
  let a = 0;
  let b = 0;
  return (
    <>
      {ops.map((op) => {
        const key = `${op.type}-${a}-${b}`;
        if (op.type !== 'insert') a += op.text.length;
        if (op.type !== 'delete') b += op.text.length;
        return op.type === 'equal' ? (
          <span key={key}>{op.text}</span>
        ) : op.type === 'insert' ? (
          <ins key={key} className="rounded bg-success/15 text-success no-underline">
            {op.text}
          </ins>
        ) : (
          <del key={key} className="rounded bg-danger-soft text-danger">
            {op.text}
          </del>
        );
      })}
    </>
  );
}
