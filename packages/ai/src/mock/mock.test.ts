import { createBookIndex, streamTutorAnswer } from '@dozabaneh/core';
import { type ChatEvent, QuizResultSchema, type TutorEngineInput } from '@dozabaneh/shared';
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { describe, expect, it } from 'vitest';
import { mockQuiz } from './quiz';
import { mockSummary } from './summary';
import { composeMockAnswer, createMockTutorEngine } from './tutor';

const input: TutorEngineInput = {
  question: 'این تکه را برایم توضیح بده.',
  mode: 'default',
  passages: [
    {
      label: 'P1',
      segmentId: 's1',
      nodeId: 'n',
      location: 'x',
      src: 'An algorithm stops. It has steps.',
      tgt: 'الگوریتم پایان می‌یابد. گام دارد.',
    },
    { label: 'P2', segmentId: 's2', nodeId: 'n', location: 'x', src: 'Precision matters.', tgt: 'دقت مهم است.' },
  ],
  glossary: [{ src: 'algorithm', tgt: 'الگوریتم', definition: 'دنباله‌ای از گام‌ها.' }],
  history: [],
  sourceLang: 'en',
  targetLang: 'fa',
  book: { title: 't', authors: [] },
  sectionTitle: 'بخش',
  attempt: 1,
};

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('mock tutor', () => {
  it('composes grounded answers that cite only given labels', () => {
    const { markdown, followups } = composeMockAnswer(input);
    expect(markdown).toContain('[P1]');
    expect(markdown).toContain('[P2]');
    expect(markdown).not.toMatch(/\[P[3-9]\]/);
    expect(markdown).toContain('الگوریتم پایان می‌یابد.');
    expect(followups.length).toBeGreaterThanOrEqual(2);
  });

  it('adapts to modes', () => {
    expect(composeMockAnswer({ ...input, mode: 'quiz' }).markdown).toContain('یک پرسش در هر نوبت');
    expect(composeMockAnswer({ ...input, mode: 'example' }).markdown).toContain('یک مثال');
  });

  it('streams deltas, followups, usage and done', async () => {
    const events = await collect(
      createMockTutorEngine({ delayMs: 0, firstDelayMs: 0 }).streamChat(input, new AbortController().signal),
    );
    expect(events.at(-1)).toEqual({ type: 'done' });
    const text = events.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('');
    expect(text).toBe(composeMockAnswer(input).markdown);
  });

  it('fails mid-stream on the first attempt with #error, succeeds on retry', async () => {
    const engine = createMockTutorEngine({ delayMs: 0, firstDelayMs: 0 });
    const q = { ...input, question: 'چرا؟ #error' };
    const first = await collect(engine.streamChat(q, new AbortController().signal));
    expect(first.some((e) => e.type === 'delta')).toBe(true);
    expect(first.at(-1)).toMatchObject({ type: 'error', code: 'NETWORK', retryable: true });
    const second = await collect(engine.streamChat({ ...q, attempt: 2 }, new AbortController().signal));
    expect(second.at(-1)).toEqual({ type: 'done' });
  });

  it('works end-to-end with the core orchestrator and the sample book', async () => {
    const index = createBookIndex(sampleBook);
    const events = await collect(
      streamTutorAnswer(
        index,
        {
          question: 'مهم‌ترین ایده‌ی این بخش چیست؟',
          context: { bookId: 'bk_sample', nodeId: 'nd_sample_ch2-bits', nodeLabel: 'x', mode: 'default' },
          history: [],
          targetLang: 'fa',
          attempt: 1,
        },
        createMockTutorEngine({ delayMs: 0, firstDelayMs: 0 }),
        new AbortController().signal,
      ),
    );
    const citations = events.find((e) => e.type === 'citations');
    expect(citations?.type === 'citations' && citations.citations.every((c) => c.nodeId === 'nd_sample_ch2-bits')).toBe(
      true,
    );
    expect(citations?.type === 'citations' && citations.citations.length).toBeGreaterThan(0);
  });
});

describe('mock summary and quiz', () => {
  const passages = input.passages;

  it('summarizes with the four labelled parts', () => {
    const { markdown } = mockSummary({ kind: 'section', targetLang: 'fa', passages, glossary: input.glossary });
    for (const label of ['ایده‌ی اصلی', 'نکته‌های کلیدی', 'اصطلاحات کلیدی', 'چرا مهم است']) {
      expect(markdown).toContain(label);
    }
    expect(markdown).toContain('الگوریتم (algorithm)');
  });

  it('builds a valid chapter quiz', () => {
    const glossary = sampleBook.glossary.map((g) => ({ src: g.src, tgt: g.tgt, definition: g.definition ?? '' }));
    const quiz = mockQuiz({ scope: 'chapter', targetLang: 'fa', passages, glossary });
    expect(QuizResultSchema.safeParse(quiz).success).toBe(true);
    expect(quiz.questions.map((q) => q.type)).toEqual(['mcq', 'mcq', 'mcq', 'mcq', 'mcq', 'tf', 'tf', 'short']);
    for (const q of quiz.questions.filter((x) => x.type === 'mcq')) {
      expect(q.options).toHaveLength(4);
      expect(typeof q.answer).toBe('number');
    }
    expect(mockQuiz({ scope: 'chapter', targetLang: 'fa', passages, glossary })).toEqual(quiz);
  });
});
