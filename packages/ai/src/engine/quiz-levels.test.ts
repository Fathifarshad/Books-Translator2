import type { QuizQuestion, TaskInput, TaskResult } from '@dozabaneh/shared';
import { describe, expect, it } from 'vitest';
import { mockQuiz } from '../mock/quiz';
import { COPYEDIT_PROMPT_REF, loadTaskPrompt, promptRefsFor } from './prompts';
import { TASK_SPECS } from './specs';

const passages = [{ label: 'P1', src: 'An algorithm is a recipe.', tgt: 'الگوریتم یک دستور است.' }];
const question = (difficulty: QuizQuestion['difficulty']): QuizQuestion => ({
  type: 'tf',
  question: 'Q?',
  answer: true,
  explanation: 'E.',
  difficulty,
  sources: ['P1'],
});
const check = (input: Partial<TaskInput<'quiz'>>, questions: QuizQuestion[]) =>
  TASK_SPECS.quiz.check(
    { scope: 'chapter', passages, ...input } as TaskInput<'quiz'>,
    { questions } as TaskResult<'quiz'>,
    { sourceLang: 'en', targetLang: 'fa' },
  );

describe('quiz levels', () => {
  it('accepts a mixed quiz at every level, professional included', () => {
    const issues = check({}, [question('easy'), question('medium'), question('hard'), question('professional')]);
    expect(issues).toEqual([]);
  });

  it('rejects a question below the asked level', () => {
    const issues = check({ level: 'professional' }, [question('professional'), question('easy')]);
    expect(issues).toMatchObject([{ level: 'error', rule: 'quiz_level' }]);
    expect(issues[0]?.message).toContain('Question 2');
  });

  it('warns, without rejecting, when the number of questions differs from the request', () => {
    const issues = check({ count: 5 }, [question('easy')]);
    expect(issues).toMatchObject([{ level: 'warning', rule: 'quiz_count' }]);
  });

  it('the offline quiz writes every question at the asked level', () => {
    const glossary = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => ({
      src: x,
      tgt: `${x}-fa`,
      definition: `definition of ${x}`,
    }));
    const quiz = mockQuiz({ scope: 'chapter', targetLang: 'fa', passages, glossary, level: 'hard' });
    expect(quiz.questions.length).toBeGreaterThan(3);
    expect(new Set(quiz.questions.map((q) => q.difficulty))).toEqual(new Set(['hard']));
    const mixed = mockQuiz({ scope: 'chapter', targetLang: 'fa', passages, glossary });
    expect(mixed.questions.some((q) => q.difficulty === 'professional')).toBe(true);
  });
});

describe('copy-editing prompt (ADR-045)', () => {
  it('is used for the edit pass of a book edited in its own language only', () => {
    expect(promptRefsFor('edit', 'fa', 'fa')).toEqual([COPYEDIT_PROMPT_REF, 'prompts/style/fa.md']);
    expect(promptRefsFor('edit', 'fa', 'en')).toEqual(['prompts/edit.md', 'prompts/style/fa.md']);
    expect(promptRefsFor('edit', 'fa')).toEqual(['prompts/edit.md', 'prompts/style/fa.md']);
    expect(promptRefsFor('translate', 'fa', 'fa')[0]).toBe('prompts/translate.md');
  });

  it('is what an API engine receives as its system prompt', () => {
    const files: Record<string, string> = {
      [COPYEDIT_PROMPT_REF]: '# Task: copyedit — v1\nEdit {{targetLanguage}}.',
      'prompts/style/fa.md': 'STYLE',
    };
    const p = loadTaskPrompt('edit', { sourceLang: 'fa', targetLang: 'fa' }, (ref) => files[ref] ?? '');
    expect(p.refs[0]).toBe(COPYEDIT_PROMPT_REF);
    expect(p.version).toBe('v1');
    expect(p.system).toContain('Edit Persian.');
  });
});
