#!/usr/bin/env node
/**
 * One-click start for people who are not developers (start.cmd on Windows, start.sh on macOS/Linux, `pnpm start`):
 *   1. checks the Node.js version,
 *   2. makes pnpm available (corepack, else npm),
 *   3. installs dependencies when they are missing or the lockfile changed,
 *   4. builds the web app and serves it on http://localhost:8787 for this computer only, then opens the browser.
 * The database is created and the sample book seeded automatically on first start.
 * Terminal messages are English: Windows consoles print right-to-left text reversed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const pnpm = isWin ? 'pnpm.cmd' : 'pnpm';
const MIN_NODE = [22, 22];
const PNPM_VERSION = '10.33.0';

const say = (line = '') => process.stdout.write(`${line}\n`);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin, ...opts });
const quiet = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'ignore', shell: isWin });

function fail(message) {
  say('');
  say(message);
  process.exit(1);
}

say('Dozabaneh - starting');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  fail(
    `Node.js ${MIN_NODE.join('.')} or newer is needed (this computer has ${process.versions.node}).\n` +
      (isWin
        ? 'Install the LTS version:   winget install OpenJS.NodeJS.LTS   (or https://nodejs.org), then run start.cmd again.'
        : 'Install the LTS version from https://nodejs.org, then run ./start.sh again.'),
  );
}

if (quiet(pnpm, ['--version']).status !== 0) {
  say('Setting up pnpm (one time)...');
  if (quiet('corepack', ['enable']).status !== 0 || quiet(pnpm, ['--version']).status !== 0) {
    run(isWin ? 'npm.cmd' : 'npm', ['install', '-g', `pnpm@${PNPM_VERSION}`]);
  }
  if (quiet(pnpm, ['--version']).status !== 0) {
    fail(
      'pnpm could not be installed automatically.\n' +
        `Run this once, then start again:   npm install -g pnpm@${PNPM_VERSION}` +
        (isWin ? '\n(If Windows says "access denied", open PowerShell with "Run as administrator".)' : ''),
    );
  }
}

const marker = join(root, 'node_modules', '.modules.yaml');
const lockfile = join(root, 'pnpm-lock.yaml');
if (!existsSync(marker) || statSync(lockfile).mtimeMs > statSync(marker).mtimeMs) {
  say('Installing (first time takes a few minutes)...');
  if (run(pnpm, ['install', '--frozen-lockfile']).status !== 0) {
    fail('Installing failed. Check the internet connection and run start again. The error is above.');
  }
}

const app = run(process.execPath, [join(root, 'scripts', 'share.mjs'), '--local', ...process.argv.slice(2)], {
  shell: false,
});
process.exit(app.status ?? 0);
