import { mockSummary } from '@dozabaneh/ai';
import { glossaryFor } from '@dozabaneh/core';
import { stripMarkup } from '@dozabaneh/text';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { languageName } from '../../lib/format';
import { useLibrary } from '../../stores/library';
import { assistBook, useAssistantEngine } from '../settings/engines';
import { Markdown } from '../tutor/Markdown';
import { useReader } from './context';

/** i18n key for a failed assistant request (summary, quiz). */
export function assistErrorKey(err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'UNKNOWN';
  if (code === 'PROVIDER_RATE_LIMIT') return 'assist.errors.rateLimit';
  if (code === 'PROVIDER_NOT_READY' || code === 'ASSISTANT_IS_LOCAL') return 'assist.errors.notReady';
  if (code === 'NETWORK' || code === 'PROVIDER_NETWORK') return 'assist.errors.network';
  return 'assist.errors.failed';
}

/** «چکیده‌ی فارسی این بخش را بساز» → collapsible «چکیده‌ی این بخش» card with «ساخت دوباره» (SPEC §11.2). */
export function SummaryCard() {
  const { t } = useTranslation();
  const { bookId, section, index, targetLang } = useReader();
  const key = `${bookId}|${section.node.id}|${targetLang}`;
  const summary = useLibrary((s) => s.summaries[key]);
  const engine = useAssistantEngine();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const translatedRows = section.rows.filter((r) => r.tgt && r.type !== 'heading');

  const build = () => {
    setLoading(true);
    setError(null);
    const text = section.rows.map((r) => r.src.toLowerCase()).join(' ');
    const glossary = glossaryFor(index, targetLang)
      .filter((g) => text.includes(g.src.toLowerCase()))
      .map((g) => ({ src: g.src, tgt: g.tgt, ...(g.definition ? { definition: g.definition } : {}) }));
    const passages = translatedRows.map((r, i) => ({
      label: `P${i + 1}`,
      src: stripMarkup(r.src),
      ...(r.tgt ? { tgt: stripMarkup(r.tgt) } : {}),
    }));
    const save = (markdown: string, by: string) => {
      useLibrary.getState().saveSummary(key, { markdown, engine: by, createdAt: new Date().toISOString() });
      setLoading(false);
      setCollapsed(false);
    };
    if (engine !== 'mock') {
      api
        .summary({
          kind: 'section',
          sourceLang: index.book.sourceLang,
          targetLang,
          book: assistBook(index.book, targetLang),
          glossary,
          passages,
        })
        .then((res) => save(res.markdown, res.engine))
        .catch((err: unknown) => {
          setLoading(false);
          setError(assistErrorKey(err));
        });
      return;
    }
    // The mock engine is instant; a short delay keeps the loading state visible like a real engine.
    setTimeout(() => save(mockSummary({ kind: 'section', targetLang, glossary, passages }).markdown, 'mock'), 450);
  };
  const errorLine = error ? (
    <p role="alert" className="mt-2 text-sm text-danger">
      {t(error)}
    </p>
  ) : null;

  if (!summary) {
    return (
      <div>
        <Button icon="sparkle" onClick={build} disabled={loading || translatedRows.length === 0}>
          {loading ? t('reader.summaryLoading') : t('reader.makeSummary', { language: languageName(targetLang) })}
        </Button>
        {errorLine}
      </div>
    );
  }

  return (
    <section
      className="rounded-xl border border-border bg-surface p-4"
      aria-label={t('reader.summary')}
      data-testid="summary-card"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold">{t('reader.summary')}</h2>
        <Button variant="ghost" className="ms-auto text-xs" onClick={build} disabled={loading}>
          {loading ? t('reader.summaryLoading') : t('reader.regenerate')}
        </Button>
        <IconButton
          icon="chevronDown"
          label={collapsed ? t('reader.summaryExpand') : t('reader.summaryCollapse')}
          aria-expanded={!collapsed}
          className={collapsed ? '' : 'rotate-180'}
          onClick={() => setCollapsed((v) => !v)}
        />
      </div>
      {errorLine}
      {collapsed ? null : (
        <div lang={targetLang} className="mt-2 text-[14.5px] leading-7">
          <Markdown text={summary.markdown} citations={[]} renderCitation={() => null} />
        </div>
      )}
    </section>
  );
}
