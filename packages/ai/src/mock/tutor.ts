import type { ChatEvent, ContextPassage, TutorEngine, TutorEngineInput } from '@dozabaneh/shared';
import { splitSentences } from '@dozabaneh/text';
import { chunkText, sleep } from './chunks';
import { mockStrings } from './strings';

export interface MockTutorOptions {
  /** Delay between streamed chunks (ms). 0 in tests. */
  delayMs?: number;
  /** Delay before the first chunk (ms). */
  firstDelayMs?: number;
}

/** Magic marker: a question containing it fails mid-stream on the first attempt (SPEC §10.6). */
export const MOCK_ERROR_MARKER = '#error';

const passageText = (p: ContextPassage) => p.tgt ?? p.src;

function firstSentence(p: ContextPassage, lang: string): string {
  const text = passageText(p);
  return splitSentences(text, p.tgt ? lang : 'en')[0] ?? text;
}

/** Deterministic, grounded answer built only from the passages it was given. */
export function composeMockAnswer(input: TutorEngineInput): { markdown: string; followups: string[] } {
  const s = mockStrings(input.targetLang);
  // Prefer translated prose; code blocks and untranslated passages are context, not quotable answers.
  const prose = input.passages.filter((p) => p.tgt);
  const [p1, p2, p3] = prose.length > 0 ? prose : input.passages;
  const term = input.glossary[0];
  const f = s.followups;
  if (!p1) return { markdown: s.noPassages, followups: [f.simpler] };

  const lines: string[] = [];
  const cite = (p: ContextPassage) => `${firstSentence(p, input.targetLang)} [${p.label}]`;
  switch (input.mode) {
    case 'quiz': {
      lines.push(
        `**${s.quizIntro}**`,
        '',
        s.quizQuestion(term?.tgt ?? input.sectionTitle),
        '',
        `(${p1.label}) [${p1.label}]`,
      );
      break;
    }
    case 'example': {
      lines.push(
        `**${s.shortAnswer}** ${cite(p1)}`,
        '',
        `**${s.example}** ${s.exampleBody(term?.tgt ?? input.sectionTitle)}`,
      );
      break;
    }
    case 'deeper': {
      lines.push(`**${s.shortAnswer}** ${cite(p1)}`, '', `**${s.deeper}**`);
      for (const p of [p2, p3].filter((x): x is ContextPassage => Boolean(x))) lines.push(`- ${cite(p)}`);
      break;
    }
    case 'simpler': {
      lines.push(`**${s.simpler}** ${cite(p1)}`);
      break;
    }
    default: {
      lines.push(`**${s.shortAnswer}** ${cite(p1)}`);
      if (p2) lines.push('', `**${s.role}** ${cite(p2)}`);
    }
  }
  if (term && input.mode !== 'quiz') {
    lines.push('', `- **${s.keyTerm}** ${term.tgt} (${term.src})${term.definition ? `: ${term.definition}` : ''}`);
  }
  if (input.mode !== 'quiz') lines.push('', `**${s.check}** ${s.checkQuestion(input.sectionTitle)}`);
  lines.push('', `> ${s.mockNote}`);

  const followups =
    input.mode === 'quiz'
      ? [f.simpler, f.deeper]
      : input.mode === 'simpler'
        ? [f.example, f.quiz]
        : [f.simpler, f.example, f.quiz];
  return { markdown: lines.join('\n'), followups };
}

export function createMockTutorEngine(opts: MockTutorOptions = {}): TutorEngine {
  const delay = opts.delayMs ?? 35;
  const firstDelay = opts.firstDelayMs ?? 250;
  return {
    id: 'mock',
    async *streamChat(input, signal): AsyncGenerator<ChatEvent> {
      const { markdown, followups } = composeMockAnswer(input);
      const chunks = chunkText(markdown);
      const failAt =
        input.question.includes(MOCK_ERROR_MARKER) && input.attempt <= 1
          ? Math.max(1, Math.floor(chunks.length * 0.4))
          : -1;
      await sleep(firstDelay, signal);
      for (let i = 0; i < chunks.length; i++) {
        if (signal.aborted) return;
        if (i === failAt) {
          yield { type: 'error', code: 'NETWORK', message: 'simulated network error', retryable: true };
          return;
        }
        yield { type: 'delta', text: chunks[i] as string };
        await sleep(delay, signal);
      }
      yield { type: 'followups', items: followups };
      const tokensIn = Math.ceil(input.passages.reduce((a, p) => a + p.src.length + (p.tgt?.length ?? 0), 0) / 4);
      yield { type: 'usage', usage: { tokensIn, tokensOut: Math.ceil(markdown.length / 4) } };
      yield { type: 'done' };
    },
  };
}
