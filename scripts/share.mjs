#!/usr/bin/env node
/**
 * `pnpm share` — use the app from a phone anywhere (docs/GUIDE.fa.md, «دسترسی از موبایل»):
 *   1. builds the web app,
 *   2. starts the API serving the app on one port (http://localhost:8787 on this computer) and opens it,
 *   3. opens a free Cloudflare quick tunnel (https://….trycloudflare.com) when `cloudflared` is installed,
 *      and shows the link in Settings.
 * Other devices must sign in with the access password (Settings → دسترسی از موبایل) and are read-only.
 * Terminal messages are English: Windows consoles print right-to-left text reversed.
 * Cross-platform: plain Node, no shell syntax. `--no-open` skips opening the browser.
 * `--local` (used by `pnpm start` / start.cmd) serves this computer only: no tunnel, bound to 127.0.0.1.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 8787);
const local = `http://localhost:${port}`;
const isWin = process.platform === 'win32';
const pnpm = isWin ? 'pnpm.cmd' : 'pnpm';
const localOnly = process.argv.includes('--local');
const children = [];

const say = (line = '') => process.stdout.write(`${line}\n`);

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin, ...opts });
  children.push(child);
  return child;
}

function stopAll(code = 0) {
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

async function waitForApi(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${local}/api/v1/health`);
      if (res.ok) return true;
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function publishLink(url) {
  try {
    await fetch(`${local}/api/v1/settings/access/public-url`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch {
    // the link is printed in the terminal anyway
  }
}

/** Real network cards first; virtual adapters (WSL, Hyper-V, Docker, VMs) are unreachable from a phone. */
function lanAddresses() {
  const virtual = /vEthernet|WSL|Hyper-V|Docker|VirtualBox|VMware|Loopback|^br-|^veth|^docker|^virbr/i;
  return Object.entries(networkInterfaces())
    .filter(([name]) => !virtual.test(name))
    .flatMap(([, addrs]) => addrs ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${port}`);
}

function openBrowser(url) {
  if (process.argv.includes('--no-open')) return;
  const [cmd, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // the address is printed anyway
  }
}

/**
 * `cloudflared` on PATH, or where the Windows installer puts it — a PowerShell window opened before
 * `winget install` does not see the new PATH yet. `CLOUDFLARED` overrides.
 */
function findCloudflared() {
  if (process.env.CLOUDFLARED) return process.env.CLOUDFLARED;
  if (isWin) {
    const candidates = [
      process.env.ProgramFiles && join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'),
      process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'cloudflared', 'cloudflared.exe'),
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    ].filter(Boolean);
    const found = candidates.find((p) => existsSync(p));
    if (found) return found;
  }
  return 'cloudflared';
}

function installHint() {
  say('');
  say('cloudflared is not installed, so there is no internet link (the Wi-Fi address above still works).');
  if (isWin) {
    say('   Install it once, as its own command:   winget install --id Cloudflare.cloudflared');
    say('   Then close this window, open a new PowerShell, and run:   cd Books-Translator2   then   pnpm share');
  } else {
    say('   Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    say('   Then run pnpm share again.');
  }
}

say(localOnly ? 'Dozabaneh' : 'Dozabaneh - sharing mode for phones');
say('[1/3] Building the web app...');
const build = spawnSync(pnpm, ['--filter', '@dozabaneh/web', 'build'], { cwd: root, stdio: 'inherit', shell: isWin });
if (build.status !== 0 || !existsSync(join(root, 'apps/web/dist/index.html'))) {
  say('Building the app failed. See the error above.');
  process.exit(1);
}

say('[2/3] Starting the app...');
const api = run(pnpm, ['--filter', '@dozabaneh/api', 'start'], {
  env: {
    ...process.env,
    SERVE_WEB: '1',
    PORT: String(port),
    HOST: process.env.HOST ?? (localOnly ? '127.0.0.1' : '0.0.0.0'),
  },
});
api.on('exit', (code) => {
  say(`The app stopped (${code ?? 0}).`);
  stopAll(code ?? 0);
});
if (!(await waitForApi())) {
  say(`The app did not start on ${local}. Is "pnpm dev" still running? Close it with Ctrl+C and try again.`);
  stopAll(1);
}
await publishLink(null);
say('');
say(`On this computer open:  ${local}   (not 5173 - in sharing mode everything is on port ${port})`);
const lan = localOnly ? [] : lanAddresses();
if (lan.length) say(`On the same Wi-Fi:      ${lan.join('   ')}`);
say('');
openBrowser(local);

if (localOnly) {
  say('Keep this window open while you use the app. To stop: Ctrl+C');
  // The API child keeps the process alive; stopAll() exits when it stops or on Ctrl+C.
  await new Promise(() => {});
}

say('[3/3] Creating a secure internet link (Cloudflare)...');
const tunnelLog = [];
let shown = false;
let failed = false;
const tunnel = spawn(findCloudflared(), ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], {
  cwd: root,
});
children.push(tunnel);
const slow = setTimeout(() => {
  if (!shown) say('   Still waiting for Cloudflare... (check the internet connection of this computer)');
}, 45_000);
const onOutput = (chunk) => {
  const text = String(chunk);
  tunnelLog.push(...text.split(/\r?\n/).filter(Boolean));
  tunnelLog.splice(0, Math.max(0, tunnelLog.length - 15));
  // Quick-tunnel names are hyphenated words; this skips cloudflared's own api.trycloudflare.com.
  const match = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/.exec(text);
  if (match && !shown) {
    shown = true;
    clearTimeout(slow);
    void publishLink(match[0]);
    say('');
    say('==================================================================');
    say(' Link for the phone (also shown in Settings):');
    say(`   ${match[0]}`);
    say(' Open it on the phone and sign in with the access password.');
    say(' Keep this window open. To stop: Ctrl+C');
    say('==================================================================');
    say('');
  }
};
tunnel.stdout.on('data', onOutput);
tunnel.stderr.on('data', onOutput);
tunnel.on('error', (err) => {
  failed = true;
  clearTimeout(slow);
  if (err.code === 'ENOENT') installHint();
  else say(`cloudflared could not start: ${err.message}`);
});
tunnel.on('exit', (code) => {
  clearTimeout(slow);
  void publishLink(null);
  if (shown) {
    say(`The internet link was closed (${code ?? 0}). The app keeps running on this computer.`);
  } else if (!failed && code !== null) {
    say('');
    say(`cloudflared stopped before a link was created (exit ${code}). Its last messages:`);
    for (const line of tunnelLog) say(`   ${line}`);
  }
});
