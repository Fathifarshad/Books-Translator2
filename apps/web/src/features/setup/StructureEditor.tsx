import { createBookIndex, nodeTitle } from '@dozabaneh/core';
import type { BookBundle, SegmentRecord, TocNodeRecord } from '@dozabaneh/shared';
import { dirOf, stripMarkup } from '@dozabaneh/text';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../components/ui';
import { booksKey, bundleKey } from '../../data/books';
import { api } from '../../lib/api';
import { fmtNum, uiDigits } from '../../lib/format';

type Op =
  | { op: 'rename'; nodeId: string; title: string }
  | { op: 'skip'; nodeId: string; skip: boolean }
  | { op: 'promote' | 'demote'; nodeId: string }
  | { op: 'merge'; nodeId: string; with: 'prev' | 'next' }
  | { op: 'split'; nodeId: string; segmentId: string };

/**
 * Structure review tree (SPEC §8.8): rename, change level, merge with previous/next, split at a paragraph,
 * «این بخش ترجمه نشود», preview of the first/last paragraphs with page numbers.
 */
export function StructureEditor({ bundle }: { bundle: BookBundle }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = useMemo(() => createBookIndex(bundle), [bundle]);
  const src = bundle.book.sourceLang;
  const bookId = bundle.book.id;

  const run = async (op: Op) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.structure(bookId, op);
      if (res.bundle) queryClient.setQueryData(bundleKey(bookId), res.bundle);
      void queryClient.invalidateQueries({ queryKey: booksKey });
    } catch {
      setError(t('setup.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const segmentsOf = (id: string) => index.segmentsByNode.get(id) ?? [];
  const label = (i: number) => uiDigits(bundle.book.pageLabels[i] ?? String(i + 1));

  return (
    <div className="rounded-2xl border border-border bg-surface" data-testid="structure-editor" aria-busy={busy}>
      {error ? (
        <p role="alert" className="border-b border-border bg-danger-soft px-4 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul>
        {bundle.nodes.map((node, i) => (
          <NodeRow
            key={node.id}
            node={node}
            title={nodeTitle(index, node, src).src}
            lang={src}
            segments={segmentsOf(node.id)}
            pages={
              node.pageStart === node.pageEnd
                ? t('setup.pageShort', { n: label(node.pageStart) })
                : t('setup.pagesShort', { from: label(node.pageStart), to: label(node.pageEnd) })
            }
            first={i === 0}
            last={i === bundle.nodes.length - 1}
            busy={busy}
            run={run}
            pageLabel={label}
          />
        ))}
      </ul>
    </div>
  );
}

interface RowProps {
  node: TocNodeRecord;
  title: string;
  lang: string;
  segments: SegmentRecord[];
  pages: string;
  first: boolean;
  last: boolean;
  busy: boolean;
  run: (op: Op) => Promise<void>;
  pageLabel: (i: number) => string;
}

function NodeRow({ node, title, lang, segments, pages, first, last, busy, run, pageLabel }: RowProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [panel, setPanel] = useState<'none' | 'preview' | 'split'>('none');
  const body = segments.filter((s) => s.type !== 'heading' && s.src);
  const firstPara = body[0];
  const lastPara = body.length > 1 ? body.at(-1) : undefined;

  return (
    <li
      className={`border-b border-border/70 px-4 py-3 last:border-0 ${node.skip ? 'bg-panel/70' : ''}`}
      style={{ paddingInlineStart: `${1 + node.depth * 1.5}rem` }}
      data-testid="structure-node"
      data-node-id={node.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted">
          {t(`setup.kinds.${node.kind}`)}
          {node.numberLabel ? ` ${uiDigits(node.numberLabel)}` : ''}
        </span>
        {editing ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run({ op: 'rename', nodeId: node.id, title: draft }).then(() => setEditing(false));
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              lang={lang}
              dir={dirOf(lang)}
              aria-label={t('setup.rename')}
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent/60"
              // biome-ignore lint/a11y/noAutofocus: rename starts from an explicit click
              autoFocus
            />
            <Button type="submit" variant="primary" className="px-2 py-1 text-xs" disabled={busy || !draft.trim()}>
              {t('setup.saveTitle')}
            </Button>
            <Button className="px-2 py-1 text-xs" onClick={() => setEditing(false)}>
              {t('app.cancel')}
            </Button>
          </form>
        ) : (
          <>
            <span
              className={`min-w-0 flex-1 truncate font-medium ${node.skip ? 'line-through decoration-muted' : ''}`}
              data-testid="node-title"
            >
              <bdi lang={lang} dir={dirOf(lang)}>
                {title || '—'}
              </bdi>
            </span>
            <IconButton
              icon="edit"
              label={t('setup.rename')}
              className="size-8"
              disabled={busy}
              onClick={() => {
                setDraft(title);
                setEditing(true);
              }}
            />
          </>
        )}
        <span className="text-xs text-muted">{pages}</span>
        <span className="text-xs text-muted">{t('setup.segmentsCount', { n: fmtNum(segments.length) })}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <label className="me-2 inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={node.skip}
            disabled={busy}
            onChange={(e) => void run({ op: 'skip', nodeId: node.id, skip: e.target.checked })}
          />
          {t('setup.doNotTranslate')}
        </label>
        <IconButton
          icon="outdent"
          label={t('setup.promote')}
          className="size-8"
          disabled={busy || node.depth === 0}
          onClick={() => void run({ op: 'promote', nodeId: node.id })}
        />
        <IconButton
          icon="indent"
          label={t('setup.demote')}
          className="size-8"
          disabled={busy || first}
          onClick={() => void run({ op: 'demote', nodeId: node.id })}
        />
        <IconButton
          icon="mergeUp"
          label={t('setup.mergePrev')}
          className="size-8"
          disabled={busy || first}
          onClick={() => void run({ op: 'merge', nodeId: node.id, with: 'prev' })}
        />
        <IconButton
          icon="mergeDown"
          label={t('setup.mergeNext')}
          className="size-8"
          disabled={busy || last}
          onClick={() => void run({ op: 'merge', nodeId: node.id, with: 'next' })}
        />
        <IconButton
          icon="scissors"
          label={t('setup.splitHere')}
          className="size-8"
          aria-pressed={panel === 'split'}
          disabled={busy || segments.length < 2}
          onClick={() => setPanel(panel === 'split' ? 'none' : 'split')}
        />
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          aria-expanded={panel === 'preview'}
          onClick={() => setPanel(panel === 'preview' ? 'none' : 'preview')}
        >
          {panel === 'preview' ? t('setup.hidePreview') : t('setup.preview')}
        </Button>
      </div>

      {panel === 'preview' ? (
        <div className="mt-2 space-y-2 rounded-xl bg-panel p-3 text-sm" lang={lang} dir={dirOf(lang)}>
          {[firstPara, lastPara]
            .filter((s): s is SegmentRecord => Boolean(s))
            .map((s) => (
              <p key={s.id} className="line-clamp-3">
                <span className="me-2 text-xs text-muted">{t('reader.page', { n: pageLabel(s.page) })}</span>
                {stripMarkup(s.src)}
              </p>
            ))}
        </div>
      ) : null}

      {panel === 'split' ? (
        <div className="mt-2 rounded-xl bg-panel p-3 text-sm">
          <p className="mb-2 text-xs text-muted">{t('setup.splitPick')}</p>
          <ol className="max-h-64 space-y-1 overflow-y-auto" lang={lang} dir={dirOf(lang)}>
            {segments.slice(1).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={busy}
                  className="w-full truncate rounded-lg px-2 py-1 text-start hover:bg-surface"
                  onClick={() =>
                    void run({ op: 'split', nodeId: node.id, segmentId: s.id }).then(() => setPanel('none'))
                  }
                >
                  <span className="me-2 text-xs text-muted">{s.type === 'heading' ? '§' : '¶'}</span>
                  {stripMarkup(s.src).slice(0, 120) || s.type}
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
}
