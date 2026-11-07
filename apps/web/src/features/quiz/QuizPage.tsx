import { mockQuiz } from '@dozabaneh/ai';
import { type BookIndex, buildSection, glossaryFor } from '@dozabaneh/core';
import { QUIZ_COUNT, QUIZ_LEVELS, type QuizLevel, type QuizQuestion } from '@dozabaneh/shared';
import { getLanguage, stripMarkup } from '@dozabaneh/text';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { LangText } from '../../components/Bdi';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { targetLangOf, useBookBundle, useBookIndex } from '../../data/books';
import { uiLocale } from '../../i18n';
import { api } from '../../lib/api';
import { fmtNum, uiDigits } from '../../lib/format';
import { assistErrorKey } from '../reader/SummaryCard';
import { assistBook, useAssistantEngine } from '../settings/engines';
import { quizSheetMarkdown } from './sheet';

interface Passage {
  label: string;
  nodeId: string;
  segmentId: string;
  src: string;
  tgt?: string;
}

function chapterPassages(index: BookIndex, chapterId: string, lang: string): Passage[] {
  const out: Passage[] = [];
  for (const child of index.childrenOf.get(chapterId) ?? []) {
    const section = buildSection(index, child.id, lang);
    for (const r of section?.rows ?? []) {
      if (r.type === 'heading' || r.status === 'untranslatable') continue;
      out.push({
        label: `P${out.length + 1}`,
        nodeId: child.id,
        segmentId: r.segmentId,
        src: stripMarkup(r.src),
        ...(r.tgt ? { tgt: stripMarkup(r.tgt) } : {}),
      });
    }
  }
  return out;
}

/** A provider reads at most this many passages of a chapter for one quiz. */
const MAX_QUIZ_PASSAGES = 300;

/** Question counts offered next to the level. */
const COUNTS = [5, QUIZ_COUNT.default, 10, 15, QUIZ_COUNT.max] as const;

/** Chapter quiz «آزمون این فصل» (SPEC §13.6), generated on demand by the assistant engine (mock or a provider). */
export function QuizPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bookId = '', chapterId = '' } = useParams();
  const { data: bundle } = useBookBundle(bookId);
  const index = useBookIndex(bundle ?? undefined);
  const [seed, setSeed] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number | boolean | string>>({});
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [level, setLevel] = useState<QuizLevel>('mixed');
  const [count, setCount] = useState<number>(QUIZ_COUNT.default);
  const engine = useAssistantEngine();
  /** A new level or size is a new quiz: earlier answers belong to other questions. */
  const restart = () => {
    setAnswers({});
    setChecked({});
  };

  const data = useMemo(() => {
    if (!index) return undefined;
    const lang = targetLangOf(index);
    const chapter = index.nodeById.get(chapterId);
    if (chapter?.kind !== 'chapter') return undefined;
    const passages = chapterPassages(index, chapterId, lang);
    const text = passages.map((p) => p.src.toLowerCase()).join(' ');
    const glossary = glossaryFor(index, lang)
      .filter((g) => text.includes(g.src.toLowerCase()))
      .map((g) => ({ src: g.src, tgt: g.tgt, ...(g.definition ? { definition: g.definition } : {}) }));
    const mock =
      engine === 'mock'
        ? mockQuiz({ scope: 'chapter', targetLang: lang, passages, glossary, seed: String(seed), level })
        : null;
    return { chapter, passages, glossary, mock, lang };
  }, [index, chapterId, seed, engine, level]);

  const remote = useQuery({
    queryKey: ['quiz', bookId, chapterId, seed, engine, level, count],
    queryFn: () => {
      if (!data || !index) throw new Error('no chapter');
      return api.quiz({
        scope: 'chapter',
        sourceLang: index.book.sourceLang,
        targetLang: data.lang,
        book: assistBook(index.book, data.lang),
        glossary: data.glossary,
        passages: data.passages
          .slice(0, MAX_QUIZ_PASSAGES)
          .map((p) => ({ label: p.label, src: p.src, ...(p.tgt ? { tgt: p.tgt } : {}) })),
        level,
        count,
      });
    },
    enabled: Boolean(data) && engine !== 'mock',
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (!bundle) return null;
  if (!data) return <Navigate to={`/books/${bookId}/read`} replace />;
  const { chapter, passages, lang } = data;
  const quiz = data.mock ?? remote.data;
  const header = (
    <>
      <Link
        to={`/books/${bookId}/read`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
      >
        <Icon name="back" size={16} />
        {t('quiz.backToReading')}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{t('quiz.chapterTitle', { n: uiDigits(chapter.numberLabel ?? '') })}</h1>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Native radios: arrow keys and semantics for free; each input covers its pill. */}
        <fieldset className="flex flex-wrap items-center gap-1.5" data-testid="quiz-level">
          <legend className="sr-only">{t('quiz.level')}</legend>
          <span aria-hidden="true" className="text-sm text-muted">
            {t('quiz.level')}:
          </span>
          {QUIZ_LEVELS.map((l) => (
            <label
              key={l}
              className="relative rounded-full border border-border bg-surface px-3.5 py-1 text-sm text-muted hover:text-text has-checked:border-accent/60 has-checked:bg-accent-soft has-checked:text-accent has-focus-visible:ring-2 has-focus-visible:ring-accent"
            >
              <input
                type="radio"
                name="quiz-level"
                value={l}
                checked={level === l}
                onChange={() => {
                  setLevel(l);
                  restart();
                }}
                className="absolute inset-0 cursor-pointer appearance-none rounded-full outline-none"
              />
              {t(`quiz.levels.${l}`)}
            </label>
          ))}
        </fieldset>
        {engine === 'mock' ? null : (
          <label className="flex items-center gap-1.5 text-sm text-muted">
            {t('quiz.count')}
            <select
              value={count}
              onChange={(e) => {
                setCount(Number(e.target.value));
                restart();
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-text"
            >
              {COUNTS.map((n) => (
                <option key={n} value={n}>
                  {fmtNum(n)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </>
  );

  if (!quiz) {
    return (
      <main id="main" className="mx-auto min-h-dvh max-w-3xl px-5 py-8">
        {header}
        {remote.isError ? (
          <div role="alert" className="mt-6 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            <p>{t(assistErrorKey(remote.error))}</p>
            <Button className="mt-3" icon="history" onClick={() => void remote.refetch()}>
              {t('app.retry')}
            </Button>
          </div>
        ) : (
          <p role="status" className="mt-6 text-muted">
            {t('quiz.generating')}
          </p>
        )}
      </main>
    );
  }
  const score = quiz.questions.filter((q, i) => checked[i] && isCorrect(q, answers[i])).length;
  const gradable = quiz.questions.filter((q) => q.type !== 'short').length;
  const done = Object.keys(checked).length;

  const sourceLink = (label: string) => {
    const p = passages.find((x) => x.label === label);
    return p ? `/books/${bookId}/read/${p.nodeId}?seg=${p.segmentId}` : undefined;
  };

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-3xl px-5 py-8">
      {header}
      <p className="mt-1 text-sm text-muted">
        {t('quiz.answered', { done: fmtNum(done), total: fmtNum(quiz.questions.length) })} ·{' '}
        {t('quiz.score', { score: fmtNum(score), total: fmtNum(gradable) })}
      </p>

      <ol className="mt-6 space-y-5">
        {quiz.questions.map((q, i) => {
          const answer = answers[i];
          const isChecked = Boolean(checked[i]);
          const correct = isChecked && isCorrect(q, answer);
          return (
            <li
              key={`${seed}-${q.type}-${q.question}`}
              className="rounded-2xl border border-border bg-surface p-5"
              data-testid="quiz-question"
            >
              <p className="text-xs text-muted">
                {t('quiz.progress', { n: fmtNum(i + 1), total: fmtNum(quiz.questions.length) })} ·{' '}
                {t(`quiz.difficulty.${q.difficulty}`)}
              </p>
              <p lang={lang} className="mt-2 leading-8 font-medium">
                {q.question}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {q.type === 'mcq'
                  ? q.options?.map((o, oi) => (
                      <label
                        key={o}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-accent has-checked:bg-accent-soft"
                      >
                        <input
                          type="radio"
                          name={`q${seed}-${i}`}
                          checked={answer === oi}
                          disabled={isChecked}
                          onChange={() => setAnswers({ ...answers, [i]: oi })}
                        />
                        {o}
                      </label>
                    ))
                  : null}
                {q.type === 'tf'
                  ? [true, false].map((v) => (
                      <label
                        key={String(v)}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-accent has-checked:bg-accent-soft"
                      >
                        <input
                          type="radio"
                          name={`q${seed}-${i}`}
                          checked={answer === v}
                          disabled={isChecked}
                          onChange={() => setAnswers({ ...answers, [i]: v })}
                        />
                        {v ? t('quiz.true') : t('quiz.false')}
                      </label>
                    ))
                  : null}
                {q.type === 'short' ? (
                  <textarea
                    dir="auto"
                    aria-label={t('quiz.shortPlaceholder')}
                    placeholder={t('quiz.shortPlaceholder')}
                    value={typeof answer === 'string' ? answer : ''}
                    disabled={isChecked}
                    onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                    className="min-h-24 rounded-lg border border-border bg-bg p-2 text-sm outline-none focus:border-accent/60"
                  />
                ) : null}
              </div>
              {!isChecked ? (
                <Button
                  className="mt-3"
                  variant="primary"
                  disabled={answer === undefined || answer === ''}
                  onClick={() => setChecked({ ...checked, [i]: true })}
                >
                  {t('quiz.check')}
                </Button>
              ) : (
                <Feedback
                  question={q}
                  correct={correct}
                  sourceHref={q.sources[0] ? sourceLink(q.sources[0]) : undefined}
                  onSource={(href) => navigate(href)}
                  lang={lang}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button
          icon="history"
          onClick={() => {
            setSeed((s) => s + 1);
            restart();
          }}
        >
          {t('quiz.newQuiz')}
        </Button>
        <Button
          icon="download"
          onClick={() => {
            const title = t('quiz.chapterTitle', { n: uiDigits(chapter.numberLabel ?? '') });
            const md = quizSheetMarkdown(quiz.questions, {
              title: level === 'mixed' ? title : `${title} — ${t(`quiz.levels.${level}`)}`,
              questions: t('quiz.sheet.questions'),
              answers: t('quiz.sheet.answers'),
              difficulty: (q) => t(`quiz.difficulty.${q.difficulty}`),
              trueLabel: t('quiz.true'),
              falseLabel: t('quiz.false'),
              answer: t('quiz.sheet.answer'),
              explanation: t('quiz.explanation'),
              keyPoints: t('quiz.keyPoints'),
              optionMarks: (getLanguage(lang).dir === 'rtl' ? t('quiz.sheet.optionMarksRtl') : 'A,B,C,D,E,F').split(
                ',',
              ),
              num: (n) => fmtNum(n),
              list: (items) => new Intl.ListFormat(uiLocale(), { type: 'unit' }).format(items),
            });
            downloadText(md, `quiz-${chapterId}-${level}.md`);
          }}
        >
          {t('quiz.sheet.download')}
        </Button>
      </div>
    </main>
  );
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function isCorrect(q: QuizQuestion, answer: number | boolean | string | undefined): boolean {
  return q.type === 'short' ? false : answer === q.answer;
}

function Feedback({
  question,
  correct,
  sourceHref,
  onSource,
  lang,
}: {
  question: QuizQuestion;
  correct: boolean;
  sourceHref?: string;
  onSource: (href: string) => void;
  lang: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`mt-3 rounded-xl p-3 text-sm leading-7 ${question.type === 'short' ? 'bg-panel' : correct ? 'bg-success/10' : 'bg-danger-soft'}`}
      role="status"
    >
      {question.type === 'short' ? (
        <>
          <p className="font-bold">{t('quiz.modelAnswer')}</p>
          <p lang={lang}>{String(question.answer)}</p>
          {question.keyPoints?.length ? (
            <p className="mt-1 text-muted">
              {t('quiz.keyPoints')}: {new Intl.ListFormat(uiLocale(), { type: 'unit' }).format(question.keyPoints)}
            </p>
          ) : null}
          <p className="mt-1 text-muted">{t('quiz.selfCheck')}</p>
        </>
      ) : (
        <p className={`font-bold ${correct ? 'text-success' : 'text-danger'}`}>
          {correct ? t('quiz.correct') : t('quiz.incorrect')}
        </p>
      )}
      <p className="mt-1">
        <span className="font-bold">{t('quiz.explanation')}: </span>
        <LangText lang={lang}>{question.explanation}</LangText>
      </p>
      {sourceHref ? (
        <Button variant="ghost" className="mt-1 px-0 text-accent" onClick={() => onSource(sourceHref)}>
          {t('quiz.source')}
        </Button>
      ) : null}
    </div>
  );
}
