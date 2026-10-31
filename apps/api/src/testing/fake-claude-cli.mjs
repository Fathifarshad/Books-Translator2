#!/usr/bin/env node
/**
 * A stand-in for the `claude` program in tests and e2e (never used in production): `CLAUDE_CLI` points here and
 * the engine runs it with this Node. It prints what `claude -p --output-format json` prints, and
 * `FAKE_CLAUDE_MODE` chooses the answer: a normal reply, a used-up subscription quota, or a signed-out CLI.
 */
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;

const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1] ?? 'sonnet';
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';

/** The file also records what it was given, so a test can check the prompt and the flags. */
if (process.env.FAKE_CLAUDE_LOG) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args, prompt })}\n`, 'utf8');
}

const answer = (result, extra = {}) =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result,
    usage: { input_tokens: 10, output_tokens: 4 },
    modelUsage: { [model]: { outputTokens: 4 } },
    ...extra,
  });

if (mode === 'quota') {
  process.stdout.write(
    JSON.stringify({ type: 'result', is_error: true, result: 'Claude usage limit reached. Try again later.' }),
  );
  process.exit(1);
}
if (mode === 'logged_out') {
  process.stderr.write('Not logged in. Please run /login.');
  process.exit(1);
}
process.stdout.write(answer('OK'));
