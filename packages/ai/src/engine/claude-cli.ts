/**
 * Claude Code as an in-process engine (SPEC §10.2 «agent», automated): instead of writing a batch file and waiting
 * for a human to run `/process-batches`, the server runs the `claude` CLI that is already installed on this
 * computer, in headless mode (`claude -p`), and reads its JSON answer. No API key — the user's own Claude
 * subscription pays for it — and the same prompts, validation and repair round as every other provider.
 *
 * The CLI is started without a shell (its arguments are never re-parsed by cmd.exe), with the project's own system
 * prompt, no tools, no MCP servers and no session files, so it behaves like a plain model call.
 */
import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, sep } from 'node:path';
import { ProviderError } from './provider-errors';
import type {
  ChatMessage,
  ChatOptions,
  ProviderClient,
  ProviderConfig,
  ProviderModel,
  ProviderUsage,
} from './providers';

export type SpawnFn = typeof nodeSpawn;

export interface ClaudeCliOptions {
  /** Executable to run; by default the `claude` on PATH is looked up (CLAUDE_CLI in `.env` overrides it). */
  command?: string;
  /** Working directory of the CLI process (default: the current one). */
  cwd?: string;
  /**
   * How much the model may think before answering. Translating a chunk is a direct task, not a puzzle, and
   * thinking grows out of all proportion to the work: a 60-item chunk of a medical book took 518 s and 48,400
   * output tokens with thinking, and 81 s and 7,833 with it off — same text, same validation. So `low` (the
   * default) also turns extended thinking off; `medium` and above leave it to Claude Code, for a book that
   * needs it.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Injected in tests. */
  spawn?: SpawnFn;
}

/** Models the CLI accepts as an alias; the exact version behind each alias is Claude Code's business. */
export const CLAUDE_CLI_MODELS: ProviderModel[] = [{ id: 'sonnet' }, { id: 'haiku' }, { id: 'opus' }];

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** A longer system prompt goes into the prompt text instead of the command line (Windows caps it at 32 KB). */
const MAX_SYSTEM_PROMPT_ARG = 12_000;

const isWindows = process.platform === 'win32';

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** What to spawn: a program and the arguments that must come before ours (a script is run with Node). */
export interface ResolvedCli {
  file: string;
  prefix: string[];
}

/**
 * The real program behind `claude`. On Windows the npm shim is a `.cmd` file, which Node refuses to spawn without
 * a shell (and a shell would re-parse our arguments), so the `claude.exe` it calls is used directly; the native
 * installer's folders are checked too. A configured path ending in `.js`/`.mjs`/`.cjs` is run with this Node —
 * which is also how the tests point the engine at a stand-in.
 */
export function resolveClaudeCli(command?: string): ResolvedCli | null {
  if (command) {
    if (/\.[cm]?js$/u.test(command)) return { file: process.execPath, prefix: [command] };
    return isFile(command) || !command.includes(sep) ? { file: command, prefix: [] } : null;
  }
  const names = isWindows ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  dirs.push(join(homedir(), '.local', 'bin'), join(homedir(), '.claude', 'local'));
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (!isFile(candidate)) continue;
      if (isWindows && !candidate.endsWith('.exe')) {
        // npm shim: run the packaged executable it would call.
        const packaged = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
        if (isFile(packaged)) return { file: packaged, prefix: [] };
        continue;
      }
      return { file: candidate, prefix: [] };
    }
  }
  return null;
}

/**
 * Variables a Claude Code session exports into the terminals it opens. The server may well have been started
 * from one (`pnpm dev` in the VS Code terminal), and the batch we run is a plain model call, not a nested
 * session: inheriting them makes the child follow that session's effort level and talk to its IDE socket.
 */
const SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_EFFORT'];

/** The child's environment: this process's, without the parent session's own settings. */
export function childEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const name of SESSION_VARS) delete env[name];
  return { ...env, ...extra };
}

const NOT_INSTALLED =
  'Claude Code was not found on this computer. Install it (npm install -g @anthropic-ai/claude-code), sign in with `claude` once, or set CLAUDE_CLI to the full path of the program.';

/** One CLI answer, as `--output-format json` returns it. */
interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  modelUsage?: Record<string, { outputTokens?: number }>;
}

const AUTH_HINT = /not logged in|\/login|authenticatio|invalid api key|unauthorized|oauth|credentials/iu;
const LIMIT_HINT = /usage limit|rate limit|limit reached|too many requests|429/iu;
const DAILY_HINT = /usage limit reached|resets? at|weekly|daily/iu;
const BUSY_HINT = /overloaded|server error|503|502|500|temporar/iu;

/** «…resets at 3pm» / «…resets 2026-10-04T18:00:00Z»: how long to wait, capped at two hours. */
function resetDelayMs(text: string): number | undefined {
  const iso = /resets? (?:at )?(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/iu.exec(text)?.[1];
  if (iso) {
    const at = Date.parse(iso);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), 2 * 60 * 60_000);
  }
  return undefined;
}

/** Maps what the CLI printed to a typed provider error, so the queue knows whether to wait or to give up. */
export function cliError(text: string, exitCode: number | null): ProviderError {
  const detail = text.trim().slice(0, 300).replace(/\s+/gu, ' ') || `claude exited with code ${exitCode ?? '?'}`;
  if (LIMIT_HINT.test(text)) {
    const daily = DAILY_HINT.test(text);
    return new ProviderError(
      daily ? 'QUOTA' : 'RATE_LIMIT',
      `Claude Code: ${detail}`,
      429,
      resetDelayMs(text) ?? (daily ? 30 * 60_000 : 60_000),
    );
  }
  if (AUTH_HINT.test(text)) return new ProviderError('AUTH', `Claude Code is not signed in: ${detail}`, 401);
  if (BUSY_HINT.test(text)) return new ProviderError('OVERLOADED', `Claude Code: ${detail}`, 503, 30_000);
  return new ProviderError('UNKNOWN', `Claude Code: ${detail}`);
}

/** The prompt text: the batch payload, plus the earlier exchange when a repair round asks for a correction. */
export function promptFromMessages(messages: ChatMessage[]): string {
  const turns = messages.filter((m) => m.role !== 'system');
  if (turns.length <= 1) return turns[0]?.content ?? '';
  const parts: string[] = [];
  for (const [i, m] of turns.entries()) {
    if (i === 0) parts.push(m.content);
    else
      parts.push(
        m.role === 'assistant' ? `--- Your previous answer ---\n${m.content}` : `--- Correction ---\n${m.content}`,
      );
  }
  return parts.join('\n\n');
}

export function systemFromMessages(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
}

interface RunOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function createClaudeCliClient(config: ProviderConfig): ProviderClient {
  const cli = config.cli ?? {};
  const effort = cli.effort ?? 'low';
  const spawnFn: SpawnFn = cli.spawn ?? nodeSpawn;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = config.model || 'sonnet';

  /** Fixed flags: headless, no tools, no project configuration, nothing that could ask a question. */
  function baseArgs(system: string, format: 'json' | 'stream-json'): { args: string[]; inlineSystem: boolean } {
    const inlineSystem = system.length > MAX_SYSTEM_PROMPT_ARG;
    const args = [
      '--print',
      '--output-format',
      format,
      '--model',
      model,
      '--tools',
      '',
      '--safe-mode',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--permission-prompts',
      'none',
    ];
    args.push('--effort', effort);
    if (format === 'stream-json') args.push('--verbose', '--include-partial-messages');
    if (system && !inlineSystem) args.push('--system-prompt', system);
    return { args, inlineSystem };
  }

  function start(args: string[], prompt: string, signal?: AbortSignal): ChildProcess {
    const resolved = resolveClaudeCli(cli.command);
    if (!resolved) throw new ProviderError('NOT_FOUND', NOT_INSTALLED);
    let child: ChildProcess;
    try {
      child = spawnFn(resolved.file, [...resolved.prefix, ...args], {
        ...(cli.cwd ? { cwd: cli.cwd } : {}),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: childEnv(process.env, {
          CLAUDE_CODE_ENTRYPOINT: 'dozabaneh',
          // Six times faster at the same quality (see `effort` above); any other level keeps thinking on.
          ...(effort === 'low' ? { MAX_THINKING_TOKENS: '0' } : {}),
        }),
      });
    } catch (err) {
      throw new ProviderError('NOT_FOUND', `${NOT_INSTALLED} (${(err as Error).message})`);
    }
    child.on('error', () => {
      // Reported through the exit handling below; an unhandled 'error' event would crash the server.
    });
    signal?.addEventListener('abort', () => child.kill(), { once: true });
    child.stdin?.on('error', () => {
      // The process may exit before the prompt is fully written (EPIPE); the exit code tells the real story.
    });
    child.stdin?.end(prompt, 'utf8');
    return child;
  }

  function run(args: string[], prompt: string, signal?: AbortSignal): Promise<RunOutcome> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = start(args, prompt, signal);
      } catch (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      let failure: Error | null = null;
      const timer = setTimeout(() => {
        child.kill();
        failure = new ProviderError('TIMEOUT', `Claude Code gave no answer within ${Math.round(timeoutMs / 1000)} s.`);
      }, timeoutMs);
      child.stdout?.setEncoding('utf8').on('data', (c: string) => {
        stdout += c;
      });
      child.stderr?.setEncoding('utf8').on('data', (c: string) => {
        stderr += c;
      });
      child.on('error', (err: NodeJS.ErrnoException) => {
        failure ??=
          err.code === 'ENOENT'
            ? new ProviderError('NOT_FOUND', NOT_INSTALLED)
            : new ProviderError('NETWORK', `Claude Code could not be started: ${err.message}`);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else resolve({ stdout, stderr, code });
      });
    });
  }

  function parse(outcome: RunOutcome): { text: string; usage: ProviderUsage; model: string } {
    let data: CliResult | null = null;
    const trimmed = outcome.stdout.trim();
    if (trimmed.startsWith('{')) {
      try {
        data = JSON.parse(trimmed) as CliResult;
      } catch {
        data = null;
      }
    }
    if (!data) {
      throw cliError(`${outcome.stderr}\n${trimmed}`.trim() || 'no answer', outcome.code);
    }
    if (data.is_error || outcome.code !== 0) throw cliError(`${data.result ?? ''}\n${outcome.stderr}`, outcome.code);
    const text = data.result ?? '';
    if (!text.trim()) throw new ProviderError('BAD_RESPONSE', 'Claude Code returned an empty answer.');
    return { text, usage: usageOf(data), model: mainModel(data) };
  }

  function usageOf(data: CliResult): ProviderUsage {
    const u = data.usage ?? {};
    return {
      tokensIn: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tokensOut: u.output_tokens ?? 0,
    };
  }

  /** The model that wrote the answer: the one with the most output tokens (small helper models also appear). */
  function mainModel(data: CliResult): string {
    const entries = Object.entries(data.modelUsage ?? {});
    if (entries.length === 0) return model;
    return entries.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0]?.[0] ?? model;
  }

  return {
    provider: 'claude_code',
    model,

    async chat(messages, opts: ChatOptions = {}) {
      const system = systemFromMessages(messages);
      const { args, inlineSystem } = baseArgs(system, 'json');
      const prompt = inlineSystem
        ? `${system}\n\n---\n\n${promptFromMessages(messages)}`
        : promptFromMessages(messages);
      const outcome = await run(args, prompt, opts.signal);
      const parsed = parse(outcome);
      return { text: parsed.text, model: parsed.model, usage: parsed.usage };
    },

    async *stream(messages, opts: ChatOptions = {}) {
      const system = systemFromMessages(messages);
      const { args, inlineSystem } = baseArgs(system, 'stream-json');
      const prompt = inlineSystem
        ? `${system}\n\n---\n\n${promptFromMessages(messages)}`
        : promptFromMessages(messages);
      // The CLI answers quickly enough that buffering its NDJSON is simpler and safe for the tutor's SSE route.
      const outcome = await run(args, prompt, opts.signal);
      let sawText = false;
      let usage: ProviderUsage | null = null;
      let errorText = '';
      for (const line of outcome.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        let msg: { type?: string; event?: { delta?: { type?: string; text?: string } } } & CliResult;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (msg.type === 'stream_event' && msg.event?.delta?.type === 'text_delta' && msg.event.delta.text) {
          sawText = true;
          yield { type: 'delta' as const, text: msg.event.delta.text };
        }
        if (msg.type === 'result') {
          if (msg.is_error) errorText = `${msg.result ?? ''}\n${outcome.stderr}`;
          else usage = usageOf(msg);
          if (!sawText && !msg.is_error && msg.result) yield { type: 'delta' as const, text: msg.result };
        }
      }
      if (errorText || (!sawText && !usage))
        throw cliError(errorText || outcome.stderr || outcome.stdout, outcome.code);
      if (usage) yield { type: 'usage' as const, usage };
    },

    async listModels() {
      return CLAUDE_CLI_MODELS;
    },
  };
}
