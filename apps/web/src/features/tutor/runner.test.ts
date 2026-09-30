import { createMockTutorEngine } from '@dozabaneh/ai';
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { beforeEach, describe, expect, it } from 'vitest';
import { bundleKey, queryClient } from '../../data/books';
import '../../i18n';
import { nodeLabelFor, retryAnswer, sendQuestion, setTutorEngine } from './runner';
import { useTutor } from './store';

const BOOK = 'bk_sample';

function context(nodeId: string) {
  return { bookId: BOOK, nodeId, nodeLabel: nodeLabelFor(BOOK, nodeId), mode: 'default' as const };
}

function messages() {
  const { conversations, active } = useTutor.getState();
  const id = active[BOOK];
  return id ? (conversations[id]?.messages ?? []) : [];
}

describe('tutor runner', () => {
  beforeEach(() => {
    queryClient.setQueryData(bundleKey(BOOK), sampleBook);
    useTutor.setState({ conversations: {}, active: {} });
    setTutorEngine(createMockTutorEngine({ delayMs: 0, firstDelayMs: 0 }));
  });

  it('labels nodes as «فصل n · section» at send time', () => {
    expect(nodeLabelFor(BOOK, 'nd_sample_ch1-speed')).toBe('فصل ۱ · چه سرعتی کافی است؟');
    expect(nodeLabelFor(BOOK, 'nd_sample_ch2-intro')).toBe('فصل ۲ · مقدمه‌ی فصل');
  });

  it('streams an answer with citations from the context stored on the message', async () => {
    await sendQuestion({ bookId: BOOK, question: 'مهم‌ترین ایده چیست؟', context: context('nd_sample_ch2-bits') });
    const [user, assistant] = messages();
    expect(user?.context?.nodeId).toBe('nd_sample_ch2-bits');
    expect(assistant?.status).toBe('complete');
    expect(assistant?.citations.length).toBeGreaterThan(0);
    expect(assistant?.citations.every((c) => c.nodeId === 'nd_sample_ch2-bits')).toBe(true);
    expect(assistant?.followups.length).toBeGreaterThan(0);
  });

  it('keeps the partial answer on error and retries the same message without duplicating the question', async () => {
    await sendQuestion({ bookId: BOOK, question: 'چرا؟ #error', context: context('nd_sample_ch1-intro') });
    let [, assistant] = messages();
    expect(assistant?.status).toBe('error');
    expect(assistant?.errorCode).toBe('NETWORK');
    expect(assistant?.content.length).toBeGreaterThan(0);

    const conversationId = useTutor.getState().active[BOOK] as string;
    await retryAnswer(conversationId, assistant?.id as string);
    const all = messages();
    expect(all.map((m) => m.role)).toEqual(['user', 'assistant']);
    [, assistant] = all;
    expect(assistant?.status).toBe('complete');
    expect(assistant?.attempt).toBe(2);
    expect(assistant?.errorCode).toBeUndefined();
  });
});
