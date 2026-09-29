import type { GlossaryKind } from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from 'radix-ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button, IconButton } from '../../components/ui';
import { api, type GlossaryTermRow } from '../../lib/api';
import { fmtNum, languageName } from '../../lib/format';
import { glossaryKey, targetOf, useBookLiveUpdates } from '../pipeline/live';

const KINDS: GlossaryKind[] = ['concept', 'term', 'person', 'org', 'place', 'work', 'acronym'];
const STATUSES = ['proposed', 'approved', 'locked'] as const;
const field = 'rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/60';

/** Glossary «واژه‌نامه» (SPEC §13.4): filters, inline edit, bulk approve, add, apply a changed equivalent. */
export function GlossaryPage() {
  const { t } = useTranslation();
  const { bookId = '' } = useParams();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['book', bookId], queryFn: () => api.book(bookId), enabled: Boolean(bookId) });
  const book = detail.data?.book;
  const lang = book ? targetOf(book) : '';
  const glossary = useQuery({
    queryKey: glossaryKey(bookId, lang),
    queryFn: () => api.glossary(bookId, lang),
    enabled: Boolean(lang),
  });
  useBookLiveUpdates(bookId);
  // «ویرایش» in the reader's glossary card opens this page filtered to that term.
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState<'all' | (typeof STATUSES)[number]>('all');
  const [kind, setKind] = useState<'all' | GlossaryKind>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [applyTerm, setApplyTerm] = useState<GlossaryTermRow | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: glossaryKey(bookId, lang) });
  const approve = useMutation({
    mutationFn: (ids?: string[]) => api.approveGlossary(bookId, lang, ids),
    onSuccess: () => {
      setSelected(new Set());
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['pipeline', bookId] });
    },
  });
  const apply = useMutation({
    mutationFn: (termId: string) => api.applyTerm(bookId, termId),
    onSuccess: (r) => setNotice(t('glossary.applied', { count: fmtNum(r.segments) })),
  });

  const terms = glossary.data?.terms ?? [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return terms.filter(
      (g) =>
        (status === 'all' || g.status === status) &&
        (kind === 'all' || g.kind === kind) &&
        (!q || g.src.toLowerCase().includes(q) || g.tgt.includes(q) || g.alternatives.some((a) => a.includes(q))),
    );
  }, [terms, query, status, kind]);
  const proposedSelected = [...selected].filter((id) => terms.find((g) => g.id === id)?.status === 'proposed');

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-6xl px-5 py-8">
      <Link
        to={`/books/${bookId}/pipeline`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
      >
        <Icon name="back" size={16} />
        {t('pipeline.title')}
      </Link>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('glossary.title')}</h1>
          {book ? (
            <p className="text-sm text-muted">
              <LangText lang={book.sourceLang}>{book.titles[book.sourceLang] ?? ''}</LangText> ·{' '}
              {t('glossary.count', { count: fmtNum(terms.length) })}
            </p>
          ) : null}
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <Button icon="plus" onClick={() => setAdding(true)} data-testid="add-term">
            {t('glossary.add')}
          </Button>
          {proposedSelected.length ? (
            <Button icon="check" onClick={() => approve.mutate(proposedSelected)} disabled={approve.isPending}>
              {t('glossary.approveSelected')}
            </Button>
          ) : null}
          {terms.some((g) => g.status === 'proposed') ? (
            <Button
              variant="primary"
              icon="check"
              onClick={() => approve.mutate(undefined)}
              disabled={approve.isPending}
              data-testid="approve-all"
            >
              {t('glossary.approveAll')}
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p className="mt-4 rounded-xl bg-accent-soft/60 px-4 py-2 text-sm" role="status">
          {notice}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('glossary.search')}
          aria-label={t('glossary.search')}
          className={`${field} min-w-48 flex-1`}
          type="search"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className={field}
          aria-label={t('glossary.status')}
        >
          <option value="all">{t('glossary.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`glossary.${s}`)}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className={field}
          aria-label={t('glossary.kind')}
        >
          <option value="all">{t('glossary.all')}</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`glossary.kinds.${k}`)}
            </option>
          ))}
        </select>
      </div>

      {adding && book ? (
        <TermForm
          srcLang={book.sourceLang}
          lang={lang}
          onCancel={() => setAdding(false)}
          onSave={async (values) => {
            await api.createTerm(bookId, lang, { ...values, status: 'approved' });
            setAdding(false);
            await refresh();
          }}
        />
      ) : null}

      {terms.length === 0 ? (
        <p className="mt-8 text-muted">{glossary.isLoading ? t('app.loading') : t('glossary.empty')}</p>
      ) : visible.length === 0 ? (
        <p className="mt-8 text-muted">{t('glossary.noMatch')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[760px] text-sm" data-testid="glossary-table">
            <thead className="bg-panel text-xs text-muted">
              <tr>
                <th className="w-10 px-3 py-2 text-start">
                  <input
                    type="checkbox"
                    aria-label={t('glossary.selectAll')}
                    checked={visible.length > 0 && visible.every((g) => selected.has(g.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((g) => g.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-2 text-start">
                  {t('glossary.source', { language: languageName(book?.sourceLang ?? 'en') })}
                </th>
                <th className="px-3 py-2 text-start">{t('glossary.target', { language: languageName(lang) })}</th>
                <th className="px-3 py-2 text-start">{t('glossary.alternatives')}</th>
                <th className="px-3 py-2 text-start">{t('glossary.definition')}</th>
                <th className="px-3 py-2 text-start">{t('glossary.kind')}</th>
                <th className="px-3 py-2 text-start">{t('glossary.occurrences')}</th>
                <th className="px-3 py-2 text-start">{t('glossary.status')}</th>
                <th className="w-24 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((g) =>
                editing === g.id ? (
                  <tr key={g.id} className="border-t border-border/70">
                    <td colSpan={9} className="p-3">
                      <TermForm
                        srcLang={g.srcLang}
                        lang={lang}
                        initial={g}
                        onCancel={() => setEditing(null)}
                        onSave={async (values) => {
                          const res = await api.updateTerm(bookId, g.id, values);
                          setEditing(null);
                          await refresh();
                          if (res.changedEquivalent && g.status !== 'proposed') setApplyTerm(res.term);
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={g.id} className="border-t border-border/70 align-top" data-testid="glossary-row">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={t('glossary.select', { term: g.src })}
                        checked={selected.has(g.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(g.id);
                          else next.delete(g.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <LangText lang={g.srcLang}>{g.src}</LangText>
                    </td>
                    <td className="px-3 py-2">
                      <LangText lang={lang}>{g.tgt}</LangText>
                    </td>
                    <td className="px-3 py-2 text-muted">
                      <LangText lang={lang}>{g.alternatives.join(t('glossary.listSeparator'))}</LangText>
                    </td>
                    <td className="max-w-72 px-3 py-2 text-muted">
                      <span className="line-clamp-2">
                        <LangText lang={lang}>{g.definition ?? ''}</LangText>
                      </span>
                    </td>
                    <td className="px-3 py-2">{t(`glossary.kinds.${g.kind}`)}</td>
                    <td className="px-3 py-2">{fmtNum(g.occurrences)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${g.status === 'proposed' ? 'bg-warning/15 text-warning' : 'bg-accent-soft text-accent'}`}
                      >
                        {t(`glossary.${g.status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <IconButton
                          icon="edit"
                          label={t('glossary.edit')}
                          className="size-8"
                          onClick={() => setEditing(g.id)}
                        />
                        <IconButton
                          icon="trash"
                          label={t('glossary.delete')}
                          className="size-8"
                          onClick={() => void api.deleteTerm(bookId, g.id).then(refresh)}
                        />
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog.Root open={Boolean(applyTerm)} onOpenChange={(open) => !open && setApplyTerm(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <AlertDialog.Content className="fixed inset-x-3 top-[20dvh] z-50 mx-auto max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-popover)]">
            <AlertDialog.Title className="text-lg font-bold">{t('glossary.applyToText')}</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted">
              {t('glossary.applyPrompt', { term: applyTerm?.src ?? '' })}
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button>{t('app.cancel')}</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button variant="primary" onClick={() => applyTerm && apply.mutate(applyTerm.id)}>
                  {t('glossary.applyToText')}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}

interface TermValues {
  src: string;
  tgt: string;
  alternatives: string[];
  definition: string | null;
  kind: GlossaryKind;
}

function TermForm({
  srcLang,
  lang,
  initial,
  onSave,
  onCancel,
}: {
  srcLang: string;
  lang: string;
  initial?: GlossaryTermRow;
  onSave: (values: TermValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [src, setSrc] = useState(initial?.src ?? '');
  const [tgt, setTgt] = useState(initial?.tgt ?? '');
  const [alternatives, setAlternatives] = useState(initial?.alternatives.join(t('glossary.listSeparator')) ?? '');
  const [definition, setDefinition] = useState(initial?.definition ?? '');
  const [kind, setKind] = useState<GlossaryKind>(initial?.kind ?? 'term');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 grid gap-2 rounded-xl border border-accent/40 bg-surface p-3 sm:grid-cols-2"
      data-testid="term-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(false);
        onSave({
          src: src.trim(),
          tgt: tgt.trim(),
          alternatives: alternatives
            .split(/[\u{060C},]/u)
            .map((a) => a.trim())
            .filter(Boolean),
          definition: definition.trim() || null,
          kind,
        })
          .catch(() => setError(true))
          .finally(() => setBusy(false));
      }}
    >
      <input
        value={src}
        onChange={(e) => setSrc(e.target.value)}
        lang={srcLang}
        dir="ltr"
        placeholder={t('glossary.srcPlaceholder')}
        aria-label={t('glossary.srcPlaceholder')}
        className={field}
        required
      />
      <input
        value={tgt}
        onChange={(e) => setTgt(e.target.value)}
        lang={lang}
        dir="auto"
        placeholder={t('glossary.tgtPlaceholder')}
        aria-label={t('glossary.tgtPlaceholder')}
        className={field}
        required
      />
      <input
        value={alternatives}
        onChange={(e) => setAlternatives(e.target.value)}
        lang={lang}
        dir="auto"
        placeholder={t('glossary.alternativesHint')}
        aria-label={t('glossary.alternatives')}
        className={field}
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as GlossaryKind)}
        className={field}
        aria-label={t('glossary.kind')}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`glossary.kinds.${k}`)}
          </option>
        ))}
      </select>
      <textarea
        value={definition}
        onChange={(e) => setDefinition(e.target.value)}
        lang={lang}
        dir="auto"
        rows={2}
        placeholder={t('glossary.definition')}
        aria-label={t('glossary.definition')}
        className={`${field} sm:col-span-2`}
      />
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={busy || !src.trim() || !tgt.trim()}>
          {t('glossary.save')}
        </Button>
        <Button onClick={onCancel}>{t('glossary.cancel')}</Button>
        {error ? (
          <span role="alert" className="self-center text-sm text-danger">
            {t('setup.actionFailed')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
