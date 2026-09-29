import type { TranslationRecord } from '@dozabaneh/shared';
import { useMutation } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { uiDigits } from '../../lib/format';
import { useLibrary } from '../../stores/library';
import { useReaderUi } from '../../stores/reader';
import { AgentHint } from '../pipeline/AgentHint';
import { usePipeline } from '../pipeline/live';
import { useReader } from './context';
import { Row, type RowLayout } from './Row';

/**
 * The rows of one section in ONE scroll container, so paired paragraphs always start at the same height
 * (SPEC §11.4). Also: untranslated banner, deep-link flash, reading progress, end-of-chapter card.
 */
export function SectionView({ layout, scrollRef }: { layout: RowLayout; scrollRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { bookId, section, index, targetLang } = useReader();
  const editing = useReaderUi((s) => s.editingSegmentId);
  const [flashId, setFlashId] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const seg = params.get('seg');

  // Deep link: /books/:bookId/read/:nodeId?seg=<id> scrolls to the row and flashes it for ~2 s.
  useEffect(() => {
    if (!seg) return;
    const el = document.getElementById(`seg-${seg}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setFlashId(seg);
    const timer = setTimeout(() => {
      setFlashId(null);
      setParams(
        (p) => {
          p.delete('seg');
          return p;
        },
        { replace: true },
      );
    }, 2000);
    return () => clearTimeout(timer);
  }, [seg, setParams]);

  // New section: start at the top unless a deep link targets a row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the section changes
  useEffect(() => {
    seen.current = new Set();
    if (!params.get('seg')) scrollRef.current?.scrollTo({ top: 0 });
  }, [section.node.id]);

  // Reading progress: a section is read when ≥ 90% of its rows were seen or its end was reached.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>('[data-seg-id]')];
    const nodeId = section.node.id;
    const lib = useLibrary.getState();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) seen.current.add((e.target as HTMLElement).dataset.segId as string);
        }
        const last = rows.at(-1)?.dataset.segId;
        if (seen.current.size >= rows.length * 0.9 || (last && seen.current.has(last))) lib.markRead(bookId, nodeId);
        const top = rows.find((r) => r.getBoundingClientRect().bottom > root.getBoundingClientRect().top + 8);
        lib.setPosition(bookId, nodeId, top?.dataset.segId);
      },
      { root, threshold: 0.6 },
    );
    for (const r of rows) io.observe(r);
    return () => io.disconnect();
  }, [bookId, section.node.id, scrollRef]);

  const pending = section.rows.filter((r) => r.status === 'pending' || r.status === 'queued');
  const translatable = section.rows.filter((r) => r.status !== 'untranslatable');
  const notStarted =
    pending.length > 0 && pending.length === translatable.length && pending.every((r) => r.status === 'pending');
  const inProgress = pending.length > 0 && !notStarted;

  // The sample book reveals translations it already ships; real books move the section to the front of the queue.
  const canSimulate = pending.some(
    (r) =>
      index.translations.has(`${r.segmentId}|${targetLang}`) &&
      index.translations.get(`${r.segmentId}|${targetLang}`)?.text,
  );
  const translating = index.book.status === 'translating';
  const pipeline = usePipeline(bookId, translating ? targetLang : undefined);
  const [queued, setQueued] = useState(false);
  const prioritize = useMutation({
    mutationFn: () => api.prioritize(bookId, section.node.id, targetLang),
    onSuccess: () => setQueued(true),
  });

  const translateNow = () => {
    // Mock pipeline: queue every pending segment, then finish them one by one (progressive availability).
    const lib = useLibrary.getState();
    const now = () => new Date().toISOString();
    const records = (status: TranslationRecord['status']) =>
      pending.flatMap((r) => {
        const base = index.translations.get(`${r.segmentId}|${targetLang}`);
        return base ? [{ ...base, status, engine: 'mock', updatedAt: now() }] : [];
      });
    lib.setStatus(bookId, records('queued'));
    const queue = records('final');
    queue.forEach((rec, i) => {
      setTimeout(() => useLibrary.getState().setStatus(bookId, [{ ...rec, updatedAt: now() }]), 700 * (i + 1));
    });
  };

  const chapter = section.chapter;
  const nextId = section.nextId;

  return (
    <div className="mx-auto w-full" style={{ maxWidth: layout === 'two' ? '1180px' : '760px' }}>
      {notStarted ? (
        <div
          className="mx-5 my-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft/60 p-4"
          data-testid="untranslated-banner"
        >
          <p className="flex-1 text-sm">{t('reader.notTranslated')}</p>
          {canSimulate ? (
            <Button variant="primary" onClick={translateNow}>
              {t('reader.translateNow')}
            </Button>
          ) : translating ? (
            <Button
              variant="primary"
              onClick={() => prioritize.mutate()}
              disabled={prioritize.isPending || queued}
              data-testid="translate-now"
            >
              {t('reader.translateNow')}
            </Button>
          ) : (
            <Link
              to={`/books/${bookId}/setup`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
              data-testid="start-translation-link"
            >
              {t('reader.startTranslation')}
            </Link>
          )}
          {queued ? (
            <p className="w-full text-sm" role="status">
              {t('reader.translateQueued')}
            </p>
          ) : null}
          {translating && pipeline.data?.agent.pending ? (
            <AgentHint count={pipeline.data.agent.pending} className="w-full" />
          ) : null}
        </div>
      ) : inProgress ? (
        <div className="mx-5 my-3 space-y-2">
          <p className="text-sm text-muted" role="status">
            {t('reader.translating')}
          </p>
          {translating && pipeline.data?.agent.pending ? <AgentHint count={pipeline.data.agent.pending} /> : null}
        </div>
      ) : null}

      <ul className="pb-6">
        {section.rows.map((row) => (
          <li key={row.segmentId}>
            <Row row={row} layout={layout} editing={editing === row.segmentId} flash={flashId === row.segmentId} />
          </li>
        ))}
      </ul>

      {section.endsChapter && chapter ? (
        <div
          className="mx-5 mb-10 rounded-2xl border border-border bg-panel p-6 text-center"
          data-testid="end-of-chapter"
        >
          <p className="text-lg font-bold">{t('reader.endOfChapter', { n: uiDigits(chapter.numberLabel ?? '') })}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon="quiz" onClick={() => navigate(`/books/${bookId}/quiz/${chapter.id}`)}>
              {t('reader.startQuiz')}
            </Button>
            {nextId ? (
              <Button iconEnd="forward" onClick={() => navigate(`/books/${bookId}/read/${nextId}`)}>
                {t('reader.nextChapter')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
