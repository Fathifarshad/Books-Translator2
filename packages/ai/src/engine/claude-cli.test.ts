import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import type { AgentBatch, AgentTask, TaskInput } from '@dozabaneh/shared';
import { describe, expect, it } from 'vitest';
import { createClaudeCliClient, promptFromMessages, resolveClaudeCli, type SpawnFn } from './claude-cli';
import { mockOutput } from './mock';
import { loadTaskPrompt, promptRefsFor } from './prompts';
import { createProviderEngine } from './provider-engine';
import { ProviderError } from './provider-errors';
import { validateResult } from './validate';

/**
 * The Claude Code engine runs a program instead of calling an endpoint, so the tests inject a fake `spawn`: it
 * records the arguments and the prompt written to stdin and answers with what the real CLI would print
 * (`--output-format json`, or NDJSON for a stream).
 */
interface Call {
  file: string;
  args: string[];
  stdin: string;
}

type Reply =
  | string
  | { stdout?: string; stderr?: string; code?: number }
  | ((call: Call) => { stdout?: string; code?: number });

function fakeSpawn(reply: Reply): { spawn: SpawnFn; calls: Call[] } {
  const calls: Call[] = [];
  const spawn = ((file: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stdin = '';
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;
    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        stdin += String(chunk);
        cb();
      },
      final(cb) {
        const call: Call = { file, args, stdin };
        calls.push(call);
        const resolved = typeof reply === 'function' ? reply(call) : reply;
        const out = typeof resolved === 'string' ? { stdout: resolved } : resolved;
        stdout.end(out.stdout ?? '');
        stderr.end((out as { stderr?: string }).stderr ?? '');
        setImmediate(() => child.emit('close', out.code ?? 0));
        cb();
      },
    });
    return child;
  }) as unknown as SpawnFn;
  return { spawn, calls };
}

const repoRoot = new URL('../../../../', import.meta.url);
const readPrompt = (ref: string) => readFileSync(new URL(ref, repoRoot), 'utf8');

const cliAnswer = (result: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3 },
    modelUsage: { 'claude-haiku-4-5': { outputTokens: 1 }, 'claude-sonnet-5': { outputTokens: 7 } },
    ...extra,
  });

const client = (reply: Reply, model = 'sonnet') => {
  const { spawn, calls } = fakeSpawn(reply);
  return { client: createClaudeCliClient({ provider: 'claude_code', model, cli: { spawn } }), calls };
};

describe('claude code cli client', () => {
  it('runs the CLI headless, with the task prompt as the system prompt and the payload on stdin', async () => {
    const { client: c, calls } = client(cliAnswer('{"items":[]}'));
    const answer = await c.chat([
      { role: 'system', content: 'You translate books.' },
      { role: 'user', content: '{"input":{"items":[]}}' },
    ]);
    expect(answer.text).toBe('{"items":[]}');
    expect(answer.usage).toEqual({ tokensIn: 14, tokensOut: 7 });
    // The model that wrote the answer, not the little helper model the CLI also uses.
    expect(answer.model).toBe('claude-sonnet-5');
    const call = calls[0] as Call;
    expect(call.stdin).toBe('{"input":{"items":[]}}');
    expect(call.args).toContain('--print');
    expect(call.args.join(' ')).toContain('--output-format json');
    expect(call.args.join(' ')).toContain('--model sonnet');
    expect(call.args[call.args.indexOf('--system-prompt') + 1]).toBe('You translate books.');
    // No tools, no project configuration, no session files, nothing that could ask a question.
    expect(call.args).toEqual(expect.arrayContaining(['--tools', '--safe-mode', '--strict-mcp-config']));
    expect(call.args.join(' ')).toContain('--permission-prompts none');
    // Translating a chunk is a direct task: little thinking keeps it fast and cheap (ADR-038).
    expect(call.args.join(' ')).toContain('--effort low');
  });

  it('sends the earlier exchange along when the repair round asks for a correction', () => {
    const prompt = promptFromMessages([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'payload' },
      { role: 'assistant', content: 'bad answer' },
      { role: 'user', content: 'fix key 03' },
    ]);
    expect(prompt).toContain('payload');
    expect(prompt).toContain('--- Your previous answer ---\nbad answer');
    expect(prompt).toContain('--- Correction ---\nfix key 03');
  });

  it('moves a very long system prompt out of the command line into the prompt', async () => {
    const system = 'x'.repeat(13_000);
    const { client: c, calls } = client(cliAnswer('{}'));
    await c.chat([
      { role: 'system', content: system },
      { role: 'user', content: 'payload' },
    ]);
    const call = calls[0] as Call;
    expect(call.args).not.toContain('--system-prompt');
    expect(call.stdin.startsWith(system)).toBe(true);
    expect(call.stdin).toContain('payload');
  });

  it('reports a used-up subscription quota as QUOTA with the wait until it resets', async () => {
    const resetsAt = new Date(Date.now() + 20 * 60_000).toISOString();
    const { client: c } = client({
      stdout: JSON.stringify({
        type: 'result',
        is_error: true,
        result: `Claude usage limit reached, resets at ${resetsAt}`,
      }),
      code: 1,
    });
    const err = (await c.chat([{ role: 'user', content: 'hi' }]).catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('QUOTA');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBeGreaterThan(10 * 60_000);
  });

  it('reports a rate limit as RATE_LIMIT and a missing login as AUTH', async () => {
    const limited = client({
      stdout: JSON.stringify({ type: 'result', is_error: true, result: 'rate limit exceeded' }),
      code: 1,
    });
    const err1 = (await limited.client
      .chat([{ role: 'user', content: 'hi' }])
      .catch((e: unknown) => e)) as ProviderError;
    expect(err1.code).toBe('RATE_LIMIT');

    const loggedOut = client({ stdout: '', stderr: 'Not logged in. Please run /login.', code: 1 });
    const err2 = (await loggedOut.client
      .chat([{ role: 'user', content: 'hi' }])
      .catch((e: unknown) => e)) as ProviderError;
    expect(err2.code).toBe('AUTH');
    expect(err2.retryable).toBe(false);
  });

  it('rejects an empty answer instead of importing nothing', async () => {
    const { client: c } = client(cliAnswer(''));
    const err = (await c.chat([{ role: 'user', content: 'hi' }]).catch((e: unknown) => e)) as ProviderError;
    expect(err.code).toBe('BAD_RESPONSE');
  });

  it('says how to install Claude Code when the program is not there', async () => {
    const c = createClaudeCliClient({
      provider: 'claude_code',
      model: 'sonnet',
      cli: { command: 'C:/nowhere/claude.exe' },
    });
    const err = (await c.chat([{ role: 'user', content: 'hi' }]).catch((e: unknown) => e)) as ProviderError;
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('claude-code');
  });

  it('streams the answer for the tutor and ends with the usage', async () => {
    const ndjson = [
      JSON.stringify({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'سلام' } } }),
      JSON.stringify({ type: 'stream_event', event: { delta: { type: 'text_delta', text: ' دنیا' } } }),
      JSON.stringify({
        type: 'result',
        is_error: false,
        result: 'سلام دنیا',
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    ].join('\n');
    const { client: c, calls } = client({ stdout: ndjson });
    const seen: string[] = [];
    let usage: { tokensIn: number; tokensOut: number } | null = null;
    for await (const part of c.stream([{ role: 'user', content: 'hi' }])) {
      if (part.type === 'delta') seen.push(part.text);
      else usage = part.usage;
    }
    expect(seen.join('')).toBe('سلام دنیا');
    expect(usage).toEqual({ tokensIn: 5, tokensOut: 2 });
    expect((calls[0] as Call).args.join(' ')).toContain('--output-format stream-json');
  });

  it('offers the model aliases the CLI understands', async () => {
    const { client: c } = client(cliAnswer('ok'));
    expect((await c.listModels()).map((m) => m.id)).toEqual(['sonnet', 'haiku', 'opus']);
  });
});

describe('finding the program', () => {
  it('runs a configured .mjs stand-in with this Node (how the API tests inject a fake CLI)', () => {
    expect(resolveClaudeCli('C:/fake/claude.mjs')).toEqual({ file: process.execPath, prefix: ['C:/fake/claude.mjs'] });
  });

  it('keeps a bare command name for PATH lookup', () => {
    expect(resolveClaudeCli('claude')).toEqual({ file: 'claude', prefix: [] });
  });
});

function translateBatch(): AgentBatch<TaskInput<'translate'>> {
  return {
    schemaVersion: 1,
    batchId: 'bt_cli1',
    task: 'translate',
    promptRefs: promptRefsFor('translate', 'fa'),
    sourceLanguage: 'en',
    targetLanguage: 'fa',
    options: { ezafe: 'yeh', parenthetical: 'first_in_chapter' },
    book: { title: 'Simple Machines', authors: ['A. Writer'] },
    input: {
      glossary: [],
      alreadyIntroduced: [],
      context: { previous: [], next: [] },
      items: [
        { key: '01', type: 'h', src: 'Levers' },
        { key: '02', type: 'p', src: 'A lever lifts 20 kilograms with *little* effort.' },
      ],
    },
    resultPath: 'data/exchange/inbox/bk_1/translate/bt_cli1.result.json',
    createdAt: '2026-10-04T00:00:00.000Z',
  };
}

describe('the pipeline engine on Claude Code', () => {
  it('translates a batch end to end: prompt in, validated items out', async () => {
    const batch = translateBatch();
    // The stand-in answers like the model would: the mock translation of the payload it was given.
    const { spawn, calls } = fakeSpawn((call) => {
      const payload = JSON.parse(call.stdin) as AgentBatch;
      const output = mockOutput({ ...batch, input: payload.input } as AgentBatch);
      return { stdout: cliAnswer(JSON.stringify(output)) };
    });
    const engine = createProviderEngine({
      client: createClaudeCliClient({ provider: 'claude_code', model: 'sonnet', cli: { spawn } }),
      systemPrompt: (b: AgentBatch) =>
        loadTaskPrompt(b.task as AgentTask, { sourceLang: b.sourceLanguage, targetLang: b.targetLanguage }, readPrompt)
          .system,
      validate: (b: AgentBatch, raw: unknown) =>
        validateResult(b, raw, { sourceLang: b.sourceLanguage, targetLang: b.targetLanguage, glossary: [] }),
    });
    const res = await engine.run(batch, {});
    expect(res.kind).toBe('done');
    if (res.kind !== 'done') return;
    const items = (res.output as { items: { key: string; tgt: string }[] }).items;
    expect(items.map((i) => i.key)).toEqual(['01', '02']);
    // The mock keeps the source's numbers; Persian digits are the post-processing step, not the engine's.
    expect(items[1]?.tgt).toContain('20');
    // One call, no repair round needed; the style guide travelled as the system prompt.
    expect(calls).toHaveLength(1);
    const args = (calls[0] as Call).args;
    expect(args[args.indexOf('--system-prompt') + 1]).toContain('Task: translate');
  });
});
