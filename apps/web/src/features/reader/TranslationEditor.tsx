import { getTranslation } from '@dozabaneh/core';
import { type DiffOp, diffWords } from '@dozabaneh/text';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useReader } from './context';
import { applyServerTranslation } from './edits';

/**
 * Inline editor for one translated paragraph (SPEC §9.8/§11.7): shows a word diff against the current
 * text, an optional reason, and saves a revision on the server; the segment becomes `user_edited`.
 */
export function TranslationEditor({ segmentId, onClose }: { segmentId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { bookId, index, targetLang } = useReader();
  const current = getTranslation(index, segmentId, targetLang);
  const original = current?.text ?? '';
  const [text, setText] = useState(original);
  const [reason, setReason] = useState('');
  const revisionsKey = ['revisions', segmentId, targetLang] as const;
  const revisions = useQuery({ queryKey: revisionsKey, queryFn: () => api.revisions(segmentId, targetLang) });
  const lastUserEdit = revisions.data?.revisions.find((r) => r.actor === 'user' && r.before !== null);
  const ops = diffWords(original, text);
  const changed = text.trim() !== original.trim() && text.trim().length > 0;

  const edit = useMutation({
    mutationFn: ({ value, kind }: { value: string; kind: string }) =>
      api.editTranslation(segmentId, targetLang, value, kind),
    onSuccess: (res) => {
      applyServerTranslation(bookId, res.translation);
      void queryClient.invalidateQueries({ queryKey: revisionsKey });
      onClose();
    },
  });
  const save = () => edit.mutate({ value: text.trim(), kind: reason.trim() || 'edit' });

  return (
    <div className="mt-1 rounded-xl border border-accent/40 bg-surface p-3" data-testid="translation-editor">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        lang={targetLang}
        dir="auto"
        aria-label={t('reader.editTranslation')}
        className="reader-text min-h-28 w-full resize-y rounded-lg border border-border bg-bg p-2 outline-none focus:border-accent/60"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && changed) save();
        }}
        // biome-ignore lint/a11y/noAutofocus: the editor opens on an explicit user action
        autoFocus
      />
      {changed ? (
        <figure className="mt-2 rounded-lg bg-panel p-2 text-sm leading-7" aria-label={t('reader.editDiff')}>
          {diffParts(ops).map((op) =>
            op.type === 'equal' ? (
              <span key={op.key}>{op.text}</span>
            ) : op.type === 'insert' ? (
              <ins key={op.key} className="rounded bg-success/15 text-success no-underline">
                {op.text}
              </ins>
            ) : (
              <del key={op.key} className="rounded bg-danger-soft text-danger">
                {op.text}
              </del>
            ),
          )}
        </figure>
      ) : null}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('reader.editReason')}
        aria-label={t('reader.editReason')}
        className="mt-2 w-full rounded-lg border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent/60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={!changed || edit.isPending}>
          {t('reader.saveEdit')}
        </Button>
        <Button onClick={onClose}>{t('app.cancel')}</Button>
        {edit.isError ? (
          <span role="alert" className="text-sm text-danger">
            {t('reader.editFailed')}
          </span>
        ) : null}
        {lastUserEdit?.before ? (
          <Button
            variant="ghost"
            icon="history"
            className="ms-auto"
            disabled={edit.isPending}
            onClick={() => edit.mutate({ value: lastUserEdit.before as string, kind: 'undo' })}
          >
            {t('reader.undoEdit')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Diff ops keyed by their offsets in the old/new text (stable and unique). */
function diffParts(ops: DiffOp[]): (DiffOp & { key: string })[] {
  let a = 0;
  let b = 0;
  return ops.map((op) => {
    const key = `${op.type}-${a}-${b}`;
    if (op.type !== 'insert') a += op.text.length;
    if (op.type !== 'delete') b += op.text.length;
    return { ...op, key };
  });
}
