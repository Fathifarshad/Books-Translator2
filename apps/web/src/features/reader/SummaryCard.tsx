import { mockSummary } from '@dozabaneh/ai';
import { glossaryFor } from '@dozabaneh/core';
import { stripMarkup } from '@dozabaneh/text';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../components/ui';
import { languageName } from '../../lib/format';
import { useLibrary } from '../../stores/library';
import { Markdown } from '../tutor/Markdown';
import { useReader } from './context';

/** «چکیده‌ی فارسی این بخش را بساز» → collapsible «چکیده‌ی این بخش» card with «ساخت دوباره» (SPEC §11.2). */
export function SummaryCard() {
  const { t } = useTranslation();
  const { bookId, section, index, targetLang } = useReader();
  const key = `${bookId}|${section.node.id}|${targetLang}`;
  const summary = useLibrary((s) => s.summaries[key]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const translatedRows = section.rows.filter((r) => r.tgt && r.type !== 'heading');

  const build = () => {
    setLoading(true);
    // The mock engine is instant; a short delay keeps the loading state visible like a real engine.
    setTimeout(() => {
      const text = section.rows.map((r) => r.src.toLowerCase()).join(' ');
      const glossary = glossaryFor(index, targetLang)
        .filter((g) => text.includes(g.src.toLowerCase()))
        .map((g) => ({ src: g.src, tgt: g.tgt, ...(g.definition ? { definition: g.definition } : {}) }));
      const { markdown } = mockSummary({
        kind: 'section',
        targetLang,
        glossary,
        passages: translatedRows.map((r, i) => ({
          label: `P${i + 1}`,
          src: stripMarkup(r.src),
          ...(r.tgt ? { tgt: stripMarkup(r.tgt) } : {}),
        })),
      });
      useLibrary.getState().saveSummary(key, { markdown, engine: 'mock', createdAt: new Date().toISOString() });
      setLoading(false);
      setCollapsed(false);
    }, 450);
  };

  if (!summary) {
    return (
      <Button icon="sparkle" onClick={build} disabled={loading || translatedRows.length === 0}>
        {loading ? t('reader.summaryLoading') : t('reader.makeSummary', { language: languageName(targetLang) })}
      </Button>
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
      {collapsed ? null : (
        <div lang={targetLang} className="mt-2 text-[14.5px] leading-7">
          <Markdown text={summary.markdown} citations={[]} renderCitation={() => null} />
        </div>
      )}
    </section>
  );
}
