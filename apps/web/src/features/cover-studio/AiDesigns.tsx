import type { CoverAiOption, CoverAiStatus, CoverDesign } from '@dozabaneh/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { fmtNum } from '../../lib/format';
import { CoverView } from './CoverView';
import { fieldClass } from './controls';

const statusKey = (bookId: string, lang: string) => ['cover-ai', bookId, lang] as const;
const busy = (s?: CoverAiStatus) => s?.state === 'designing' || s?.state === 'painting';

/** The current round of AI designs, followed while it runs. */
export function useCoverAi(bookId: string, lang: string) {
  return useQuery({
    queryKey: statusKey(bookId, lang),
    queryFn: () => api.coverAi(bookId, lang || undefined),
    enabled: Boolean(bookId && lang),
    refetchInterval: (q) => (busy(q.state.data) ? 1500 : false),
  });
}

/**
 * The side panel of «طراحی خودکار» (ADR-048, stage 2): what to ask the art director, how many designs, and who
 * draws the pictures (with the way to connect an illustrator when none is).
 */
export function AiPanel(props: { bookId: string; lang: string; onDesigned: () => void }) {
  const { t } = useTranslation();
  const { bookId, lang } = props;
  const queryClient = useQueryClient();
  const status = useCoverAi(bookId, lang);
  const [request, setRequest] = useState('');
  const [count, setCount] = useState(3);
  const start = useMutation({
    mutationFn: () => api.startCoverAi(bookId, { request, count, ...(lang ? { lang } : {}) }),
    onSuccess: (s) => {
      queryClient.setQueryData(statusKey(bookId, lang), s);
      props.onDesigned();
    },
  });
  const s = status.data;
  const running = busy(s);
  const pending = s?.options.filter((o) => o.image === 'pending').length ?? 0;
  const total = s?.options.filter((o) => o.image !== 'none').length ?? 0;

  return (
    <section className="flex flex-col gap-3" data-testid="ai-panel">
      <p className="text-sm leading-7 text-muted">{t('coverStudio.ai.intro')}</p>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t('coverStudio.ai.request')}
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={t('coverStudio.ai.requestHint')}
          className={`${fieldClass} resize-y leading-7`}
          data-testid="ai-request"
        />
      </label>
      <label className="flex items-center gap-2 whitespace-nowrap text-sm">
        {t('coverStudio.ai.count')}
        <select
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className={`${fieldClass} w-20`}
          data-testid="ai-count"
        >
          {[3, 4, 6].map((n) => (
            <option key={n} value={n}>
              {fmtNum(n)}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="primary"
        icon="sparkle"
        onClick={() => start.mutate()}
        disabled={running || start.isPending}
        data-testid="ai-start"
      >
        {s?.options.length
          ? t('coverStudio.ai.again', { count: fmtNum(count) })
          : t('coverStudio.ai.start', { count: fmtNum(count) })}
      </Button>
      {running ? (
        <p role="status" className="flex items-center gap-2 text-sm" data-testid="ai-progress">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          {s?.state === 'designing'
            ? t('coverStudio.ai.designing')
            : t('coverStudio.ai.painting', { done: fmtNum(total - pending + 1), total: fmtNum(total) })}
        </p>
      ) : null}
      {s?.state === 'failed' ? (
        <p role="alert" className="text-sm text-danger">
          {t('coverStudio.ai.failed')}
        </p>
      ) : null}
      <div className="rounded-lg bg-panel p-3 text-xs leading-6 text-muted" data-testid="ai-painter">
        {s?.painter && s.painter !== 'none' ? (
          t('coverStudio.ai.painterReady', { name: t(`painter.engines.${s.painter}`) })
        ) : (
          <>
            {t('coverStudio.ai.noPainter')}{' '}
            <Link to="/settings#painter" className="text-accent underline" data-testid="ai-connect-painter">
              {t('coverStudio.ai.connectPainter')}
            </Link>
          </>
        )}
      </div>
    </section>
  );
}

/** The designs of the round as large cards under the cover: choose one into the editor, or draw its picture again. */
export function AiResults(props: {
  bookId: string;
  lang: string;
  aspect: number;
  onChoose: (design: CoverDesign) => void;
}) {
  const { t } = useTranslation();
  const { bookId, lang, aspect } = props;
  const queryClient = useQueryClient();
  const status = useCoverAi(bookId, lang);
  const repaint = useMutation({
    mutationFn: (id: string) => api.repaintCoverAi(bookId, id, lang || undefined),
    onSuccess: (s) => queryClient.setQueryData(statusKey(bookId, lang), s),
  });
  const s = status.data;
  if (!s?.options.length) return null;
  const running = busy(s);

  return (
    <section aria-labelledby="ai-results-title" className="flex flex-col gap-3" data-testid="ai-results">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ai-results-title" className="text-base font-bold">
          {t('coverStudio.ai.results')}
        </h2>
        <span className="text-xs text-muted">
          {s.designer === 'basic'
            ? t('coverStudio.ai.byBasic')
            : t('coverStudio.ai.byEngine', {
                engine: t(`engines.names.${s.designer}`, { defaultValue: s.designer ?? '' }),
              })}
        </span>
      </div>
      {s.message?.startsWith('AI_FAILED') ? (
        <p className="text-xs text-warning">{t('coverStudio.ai.engineFailed')}</p>
      ) : null}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {s.options.map((o) => (
          <OptionCard
            key={o.id}
            option={o}
            bookId={bookId}
            aspect={aspect}
            onChoose={() => props.onChoose(o.design)}
            onRepaint={
              s.painter !== 'none' && o.concept.imagePrompt.trim() && !running ? () => repaint.mutate(o.id) : undefined
            }
          />
        ))}
      </ul>
    </section>
  );
}

function OptionCard(props: {
  option: CoverAiOption;
  bookId: string;
  aspect: number;
  onChoose: () => void;
  onRepaint: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const { option: o } = props;
  return (
    <li
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-2.5"
      data-testid={`ai-option-${o.id}`}
    >
      <button
        type="button"
        onClick={props.onChoose}
        className="relative overflow-hidden rounded-[2px] shadow-md outline-none ring-accent hover:ring-2 focus-visible:ring-2"
        aria-label={t('coverStudio.ai.choose', { name: o.concept.name })}
      >
        <CoverView design={o.design} bookId={props.bookId} aspect={props.aspect} uid={o.id} />
        {o.image === 'pending' ? (
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-black/60 py-1.5 text-xs text-white">
            <span className="inline-block size-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            {t('coverStudio.ai.drawing')}
          </span>
        ) : null}
      </button>
      <h3 className="text-sm font-bold">{o.concept.name}</h3>
      <p className="line-clamp-3 text-xs leading-6 text-muted" title={o.concept.rationale}>
        {o.concept.rationale}
      </p>
      {o.image === 'failed' ? (
        <p className="text-xs text-warning" data-testid="ai-image-failed">
          {t(`coverStudio.ai.imageErrors.${o.imageError ?? 'PAINT_FAILED'}`, {
            defaultValue: t('coverStudio.ai.imageErrors.PAINT_FAILED'),
          })}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-1.5">
        <Button variant="primary" icon="check" onClick={props.onChoose} data-testid="ai-choose">
          {t('coverStudio.ai.use')}
        </Button>
        {props.onRepaint ? (
          <Button
            variant="ghost"
            icon="image"
            onClick={props.onRepaint}
            disabled={o.image === 'pending'}
            data-testid="ai-repaint"
          >
            {t('coverStudio.ai.repaint')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
