import type { ChatEvent, TutorEngine } from '@dozabaneh/shared';
import { sampleBook } from '@dozabaneh/shared/sample-book';
import { describe, expect, it } from 'vitest';
import { createBookIndex } from '../book';
import { streamTutorAnswer, withTimeouts } from './stream';

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* slow(events: ChatEvent[], delay: number): AsyncGenerator<ChatEvent> {
  for (const e of events) {
    await sleep(delay);
    yield e;
  }
}

describe('withTimeouts', () => {
  it('passes events through', async () => {
    const events: ChatEvent[] = [{ type: 'delta', text: 'a' }, { type: 'done' }];
    expect(await collect(withTimeouts(slow(events, 1), { firstTokenMs: 100, idleMs: 100 }))).toEqual(events);
  });

  it('emits TIMEOUT when the first token is late', async () => {
    const out = await collect(
      withTimeouts(slow([{ type: 'delta', text: 'a' }], 80), { firstTokenMs: 20, idleMs: 100 }),
    );
    expect(out).toEqual([{ type: 'error', code: 'TIMEOUT', message: 'timeout', retryable: true }]);
  });

  it('emits TIMEOUT when the stream goes idle, keeping earlier deltas', async () => {
    async function* stalls(): AsyncGenerator<ChatEvent> {
      yield { type: 'delta', text: 'partial' };
      await sleep(80);
      yield { type: 'done' };
    }
    const out = await collect(withTimeouts(stalls(), { firstTokenMs: 50, idleMs: 20 }));
    expect(out.map((e) => e.type)).toEqual(['delta', 'error']);
  });

  it('stops quietly on abort', async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10);
    const out = await collect(
      withTimeouts(
        slow(
          [
            { type: 'delta', text: 'a' },
            { type: 'delta', text: 'b' },
          ],
          30,
        ),
        {
          firstTokenMs: 100,
          idleMs: 100,
          signal: ctrl.signal,
        },
      ),
    );
    expect(out).toEqual([]);
  });

  it('turns thrown transport errors into NETWORK errors', async () => {
    async function* broken(): AsyncGenerator<ChatEvent> {
      yield { type: 'delta', text: 'x' };
      throw new Error('socket hang up');
    }
    const out = await collect(withTimeouts(broken(), { firstTokenMs: 50, idleMs: 50 }));
    expect(out[1]).toMatchObject({ type: 'error', code: 'NETWORK', retryable: true });
  });
});

describe('streamTutorAnswer', () => {
  const index = createBookIndex(sampleBook);

  it('emits validated citations before done', async () => {
    const engine: TutorEngine = {
      id: 'mock',
      async *streamChat() {
        yield { type: 'delta', text: 'پاسخ [P1] و [P42].' };
        yield { type: 'done' };
      },
    };
    const out = await collect(
      streamTutorAnswer(
        index,
        {
          question: 'q',
          context: { bookId: 'bk_sample', nodeId: 'nd_sample_ch1-intro', nodeLabel: 'x', mode: 'default' },
          history: [],
          targetLang: 'fa',
          attempt: 1,
        },
        engine,
        new AbortController().signal,
      ),
    );
    expect(out.map((e) => e.type)).toEqual(['delta', 'citations', 'done']);
    const cites = out[1]?.type === 'citations' ? out[1].citations : [];
    expect(cites.map((c) => c.label)).toEqual(['P1']);
    expect(cites[0]?.nodeId).toBe('nd_sample_ch1-intro');
  });
});
