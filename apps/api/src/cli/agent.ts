/**
 * Agent CLI (SPEC §10.3) — used by Claude Code through the /process-batches skill:
 *   pnpm -s agent:status                     open batches per book and task
 *   pnpm -s agent:next [--task t] [--book id] [--json]   lease the next batch
 *   pnpm -s agent:submit <result.json>       validate and import (exit 1 with a precise report when invalid)
 *   pnpm -s agent:validate <result.json>     dry run of submit
 *   pnpm -s agent:release <batchId>          give a leased batch back
 * Works whether or not the API is running (SQLite WAL); the running app picks up changes within seconds.
 */
import { loadEnvFiles, readConfig } from '../config';
import { openDb } from '../db/client';
import { agentNext, agentRelease, agentStatus, agentSubmit } from '../pipeline/agent';
import { dbNotifier } from '../pipeline/notify';
import type { PipelineCtx } from '../pipeline/state';

loadEnvFiles();
const config = readConfig();
const db = openDb(config.dataDir);
const ctx: PipelineCtx = { db, config, notify: dbNotifier(db) };

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const VALUE_FLAGS = new Set(['--task', '--book']);
const positional = rest.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(rest[i - 1] ?? ''));
const json = rest.includes('--json');

function out(value: unknown, human: string): void {
  console.log(json ? JSON.stringify(value, null, 2) : human);
}

let code = 0;
try {
  switch (command) {
    case 'status': {
      const status = agentStatus(ctx);
      const lines = status.books.map((b) => {
        const tasks = Object.entries(b.byTask)
          .map(([t, n]) => `${t} ${n.pending}${n.leased ? ` (+${n.leased} leased)` : ''}`)
          .join(', ');
        return `  ${b.bookId}  ${b.title}\n    ${b.pending} pending, ${b.leased} leased — ${tasks}`;
      });
      const hint = status.pending
        ? `\nNext: run /process-batches ${Math.min(status.pending, 20)} in Claude Code (or: pnpm -s agent:next --json).`
        : '';
      out(status, status.books.length ? `Open agent batches:\n${lines.join('\n')}${hint}` : 'No open agent batches.');
      break;
    }
    case 'next': {
      const next = agentNext(ctx, {
        ...(flag('--task') ? { task: flag('--task') as string } : {}),
        ...(flag('--book') ? { bookId: flag('--book') as string } : {}),
      });
      if (!next) {
        out({ batchId: null, message: 'nothing pending' }, 'Nothing pending.');
      } else {
        out(
          next,
          [
            `Leased ${next.batchId} (${next.task}, ${next.items} item(s)) until ${next.leaseUntil}`,
            `  batch:   ${next.batchPath}`,
            `  result:  ${next.resultPath}`,
            `  prompts: ${next.promptRefs.join(', ')}`,
          ].join('\n'),
        );
      }
      break;
    }
    case 'submit':
    case 'validate': {
      const path = positional[0];
      if (!path) throw new Error(`usage: pnpm -s agent:${command} <result.json>`);
      const outcome = agentSubmit(ctx, path, { dryRun: command === 'validate' });
      out(outcome, outcome.report);
      if (!outcome.ok) code = 1;
      break;
    }
    case 'release': {
      const batchId = positional[0];
      if (!batchId) throw new Error('usage: pnpm -s agent:release <batchId>');
      const released = agentRelease(ctx, batchId);
      out({ batchId, released }, released ? `Released ${batchId}.` : `${batchId} is not leased.`);
      if (!released) code = 1;
      break;
    }
    default:
      console.error('usage: agent <status|next|submit|validate|release> [...]');
      code = 2;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  code = 1;
} finally {
  db.$client.close();
}
process.exit(code);
