import type { AgentBatch, AgentTask, TaskInput } from '@dozabaneh/shared';
import { describe, expect, it, vi } from 'vitest';
import { createAgentEngine, createMockEngine } from './engines';
import { mockOutput, pseudoTranslate } from './mock';
import { loadTaskPrompt, promptRefsFor, promptVersion, renderPrompt } from './prompts';
import { checkKeys } from './specs';
import { formatReport, validateResult } from './validate';

const ctx = { sourceLang: 'en', targetLang: 'fa' };

function batch<T extends AgentTask>(task: T, input: TaskInput<T>): AgentBatch<TaskInput<T>> {
  return {
    schemaVersion: 1,
    batchId: 'bt_test1',
    task,
    promptRefs: promptRefsFor(task, 'fa'),
    sourceLanguage: 'en',
    targetLanguage: 'fa',
    options: { ezafe: 'yeh', parenthetical: 'first_in_chapter' },
    book: { title: 'Simple Machines', authors: ['A. Writer'] },
    input,
    resultPath: 'data/exchange/inbox/bk_1/translate/bt_test1.result.json',
    createdAt: '2026-09-29T00:00:00.000Z',
  };
}

const translateBatch = batch('translate', {
  glossary: [{ src: 'lever', tgt: 'اهرم', kind: 'term', parenthetical: 'first_in_chapter' }],
  alreadyIntroduced: [],
  context: { previous: [], next: [] },
  items: [
    { key: '01', type: 'h', src: 'Levers' },
    { key: '02', type: 'p', src: 'A lever lifts 20 kilograms with *little* effort[^1].' },
    { key: '03', type: 'li', src: 'Call `lift()` twice.' },
  ],
});

const good = {
  schemaVersion: 1,
  batchId: 'bt_test1',
  items: [
    { key: '01', tgt: 'اهرم‌ها' },
    { key: '02', tgt: 'اهرم (Lever) با تلاش *اندک* ۲۰ کیلوگرم را بلند می‌کند[^1].', introduced: ['lever'] },
    { key: '03', tgt: '`lift()` را دو بار صدا بزنید.' },
  ],
};

describe('prompts', () => {
  it('reads the version from the first heading', () => {
    expect(promptVersion('# Task: translate — v1\n\nbody')).toBe('v1');
    expect(promptVersion('# Task: edit — v12')).toBe('v12');
    expect(promptVersion('no heading')).toBe('v0');
  });

  it('renders language placeholders from the registry', () => {
    expect(
      renderPrompt('from {{sourceLanguage}} into {{targetLanguage}} per {{styleGuideRef}} {{other}}', {
        sourceLang: 'en',
        targetLang: 'fa',
      }),
    ).toBe('from English into Persian per prompts/style/fa.md {{other}}');
  });

  it('refers to the task prompt and the style guide of the target language', () => {
    expect(promptRefsFor('translate', 'fa')).toEqual(['prompts/translate.md', 'prompts/style/fa.md']);
    expect(promptRefsFor('translate', 'xx')).toEqual(['prompts/translate.md']);
  });

  it('builds the system prompt from the task prompt and the style guide', () => {
    const files: Record<string, string> = {
      'prompts/edit.md': '# Task: edit — v3\nEdit into {{targetLanguage}}.',
      'prompts/style/fa.md': '# Persian style',
    };
    const p = loadTaskPrompt('edit', { sourceLang: 'en', targetLang: 'fa' }, (ref) => files[ref] ?? '');
    expect(p.version).toBe('v3');
    expect(p.system).toContain('Edit into Persian.');
    expect(p.system).toContain('# Persian style');
  });
});

describe('validateResult', () => {
  it('accepts a correct translate result', () => {
    const report = validateResult<'translate'>(translateBatch, JSON.stringify(good), ctx);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.output?.items).toHaveLength(3);
  });

  it('accepts a UTF-8 BOM', () => {
    expect(validateResult(translateBatch, `\u{FEFF}${JSON.stringify(good)}`, ctx).ok).toBe(true);
  });

  it('rejects invalid JSON with the parser message', () => {
    const report = validateResult(translateBatch, '{ "items": [ }', ctx);
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.rule).toBe('json');
  });

  it('rejects a missing header and a wrong batch id', () => {
    expect(validateResult(translateBatch, { items: [] }, ctx).errors[0]?.rule).toBe('header');
    expect(validateResult(translateBatch, { ...good, batchId: 'bt_other' }, ctx).errors[0]?.rule).toBe('batch_id');
  });

  it('maps schema errors to the item key', () => {
    const report = validateResult(
      translateBatch,
      { ...good, items: [good.items[0], { key: '02', text: 'x' }, good.items[2]] },
      ctx,
    );
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.rule === 'schema' && e.key === '02')).toBe(true);
  });

  it('rejects missing, extra and duplicate keys', () => {
    const report = validateResult(
      translateBatch,
      { ...good, items: [good.items[0], good.items[0], { key: '09', tgt: 'متن' }] },
      ctx,
    );
    expect(report.errors.map((e) => `${e.rule}:${e.key}`).sort()).toEqual(
      ['duplicate_key:01', 'missing_key:02', 'missing_key:03', 'unknown_key:09'].sort(),
    );
  });

  it('rejects broken markup, lost numbers and untranslated text; keeps glossary issues as warnings', () => {
    const report = validateResult(
      translateBatch,
      {
        ...good,
        items: [
          { key: '01', tgt: 'Levers' },
          { key: '02', tgt: 'ابزار با تلاش *اندک* بار را بلند می‌کند.' },
          { key: '03', tgt: 'lift() را دو بار صدا بزنید.' },
        ],
      },
      ctx,
    );
    expect(report.ok).toBe(false);
    const rules = report.errors.map((e) => `${e.key}:${e.rule}`);
    expect(rules).toContain('01:target_script');
    expect(rules).toContain('02:markup');
    expect(rules).toContain('02:numbers');
    expect(rules).toContain('03:markup');
    const text = formatReport(report, 'bt_test1');
    expect(text).toContain('✗ bt_test1');
    expect(text).toContain('[key 02]');
    expect(text).toContain('fix:');
  });

  it('turns QA findings that are not blocking into warnings', () => {
    const report = validateResult(
      translateBatch,
      {
        ...good,
        items: [good.items[0], { key: '02', tgt: 'دیلم با تلاش *اندک* ۲۰ کیلوگرم را بلند می‌کند[^1].' }, good.items[2]],
      },
      { ...ctx, glossary: [{ src: 'lever', tgt: 'اهرم', alternatives: ['دیلم'] }] },
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.rule)).toContain('glossary');
    expect(formatReport(report, 'bt_test1')).toContain('warning(s)');
  });

  it('validates edit results including confidence and flags', () => {
    const edit = batch('edit', {
      glossary: [],
      consistencyMemory: [],
      items: [{ key: '01', type: 'paragraph', src: 'Gears turn.', draft: 'چرخ‌دنده‌ها می‌چرخند.' }],
    });
    const ok = {
      schemaVersion: 1,
      batchId: 'bt_test1',
      items: [{ key: '01', tgt: 'چرخ‌دنده‌ها می‌چرخند.', changes: [], confidence: 0.9, flag: null }],
    };
    expect(validateResult(edit, ok, ctx).ok).toBe(true);
    const bad = { ...ok, items: [{ ...ok.items[0], confidence: 1.4 }] };
    expect(validateResult(edit, bad, ctx).errors[0]?.rule).toBe('schema');
  });

  it('requires complete entries for kept glossary candidates', () => {
    const g = batch('glossary', {
      candidates: [{ key: 'c1', src: 'fulcrum', freq: 4, examples: ['The fulcrum holds.'] }],
    });
    const report = validateResult(
      g,
      { schemaVersion: 1, batchId: 'bt_test1', items: [{ key: 'c1', keep: true, tgt: 'تکیه‌گاه' }] },
      ctx,
    );
    expect(report.errors.map((e) => e.message)).toEqual([
      'Kept candidate has no "kind".',
      'Kept candidate has no "parenthetical".',
    ]);
  });

  it('checks citations of deferred tutor answers against the passage labels', () => {
    const t = batch('tutor_answer', {
      question: 'چرا؟',
      mode: 'default',
      passages: [{ label: 'P1', location: 'فصل ۱', src: 'Levers help.' }],
      glossary: [],
      history: [],
    });
    const report = validateResult(
      t,
      { schemaVersion: 1, batchId: 'bt_test1', markdown: 'پاسخ [P1] [P7]', citations: ['P1', 'P7'] },
      ctx,
    );
    expect(report.errors.map((e) => e.rule)).toEqual(['unknown_citation']);
  });
});

describe('checkKeys', () => {
  it('passes identical key sets in any order', () => {
    expect(checkKeys(['01', '02'], ['02', '01'])).toEqual([]);
  });
});

describe('mock engine', () => {
  it('pseudo-translates deterministically and keeps markup, numbers and glossary equivalents', () => {
    const src = 'A lever lifts 20 kilograms with *little* effort[^1] using `lift()`.';
    const a = pseudoTranslate(src, 'en', 'fa', [{ src: 'lever', tgt: 'اهرم', kind: 'term', parenthetical: 'never' }]);
    expect(a).toBe(
      pseudoTranslate(src, 'en', 'fa', [{ src: 'lever', tgt: 'اهرم', kind: 'term', parenthetical: 'never' }]),
    );
    expect(a).toContain('اهرم');
    expect(a).toContain('20');
    expect(a).toContain('[^1]');
    expect(a).toContain('`lift()`');
    expect(a).toMatch(/\*\p{Script=Arabic}+\*/u);
    expect(a).not.toMatch(/\b(?:lifts|kilograms|effort)\b/u);
  });

  it('falls back to a tagged copy for languages without pseudo words', () => {
    expect(pseudoTranslate('Hello.', 'en', 'xx')).toBe('[xx] Hello.');
  });

  it.each(['translate', 'edit', 'glossary', 'brief'] as const)('mock %s output passes validation', (task) => {
    const inputs = {
      translate: translateBatch.input,
      edit: {
        glossary: [],
        consistencyMemory: [],
        items: Array.from({ length: 12 }, (_, i) => ({
          key: String(i + 1).padStart(2, '0'),
          type: 'paragraph',
          src: `Gear ${i} turns.`,
          draft: `چرخ‌دنده‌ی ${i} می‌چرخد.`,
        })),
      },
      glossary: {
        candidates: [
          { key: 'c1', src: 'fulcrum', freq: 5, examples: ['The fulcrum holds the lever.'] },
          { key: 'c2', src: 'CPU', freq: 3, examples: ['The CPU runs.'] },
          { key: 'c3', src: 'rarely', freq: 1, examples: ['It rarely moves.'] },
        ],
      },
      brief: { metadata: { title: 'Simple Machines' }, toc: ['Levers'], samples: ['A lever lifts.'] },
    };
    const b = batch(task, inputs[task] as never);
    const report = validateResult(b, { schemaVersion: 1, batchId: b.batchId, ...mockOutput(b) }, ctx);
    expect(report.errors).toEqual([]);
  });

  it('flags a deterministic sample of edit items for the review queue', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      key: String(i),
      type: 'paragraph',
      src: `Sentence ${i}.`,
      draft: `جمله‌ی ${i}.`,
    }));
    const out = mockOutput<'edit'>(batch('edit', { glossary: [], consistencyMemory: [], items }));
    const flagged = out.items.filter((i) => i.flag);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.length).toBeLessThan(items.length / 2);
  });

  it('runs synchronously through the engine interface', async () => {
    const result = await createMockEngine().run(translateBatch, {});
    expect(result.kind).toBe('done');
  });
});

describe('agent engine', () => {
  it('materializes the batch and defers the result', async () => {
    const materialize = vi.fn(async () => {});
    const result = await createAgentEngine().run(translateBatch, { materialize });
    expect(materialize).toHaveBeenCalledWith(translateBatch);
    expect(result).toEqual({ kind: 'deferred', batchId: 'bt_test1' });
  });

  it('needs a materialize callback', async () => {
    await expect(createAgentEngine().run(translateBatch, {})).rejects.toThrow('materialize');
  });
});
