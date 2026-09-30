#!/usr/bin/env node
/**
 * `pnpm share` — use the app from a phone anywhere (docs/GUIDE.fa.md, «دسترسی از موبایل»):
 *   1. builds the web app,
 *   2. starts the API serving the app on one port (http://localhost:8787 on this computer),
 *   3. opens a free Cloudflare quick tunnel (https://….trycloudflare.com) when `cloudflared` is installed,
 *      and shows the link in Settings.
 * Other devices must sign in with the access password (Settings → دسترسی از موبایل) and are read-only.
 * Cross-platform: plain Node, no shell syntax.
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

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${port}`);
}

say('دوزبانه — حالت اشتراک برای موبایل');
say('۱/۳ ساختن برنامه‌ی وب…');
const build = spawnSync(pnpm, ['--filter', '@dozabaneh/web', 'build'], { cwd: root, stdio: 'inherit', shell: isWin });
if (build.status !== 0 || !existsSync(join(root, 'apps/web/dist/index.html'))) {
  say('ساختن برنامه ناموفق بود. پیام خطای بالا را ببینید.');
  process.exit(1);
}

say('۲/۳ اجرای برنامه…');
const api = run(pnpm, ['--filter', '@dozabaneh/api', 'start'], {
  env: { ...process.env, SERVE_WEB: '1', PORT: String(port), HOST: process.env.HOST ?? '0.0.0.0' },
});
api.on('exit', (code) => {
  say(`برنامه متوقف شد (${code ?? 0}).`);
  stopAll(code ?? 0);
});
if (!(await waitForApi())) {
  say(`برنامه روی ${local} بالا نیامد. آیا pnpm dev هنوز باز است؟ آن را با Ctrl+C ببندید و دوباره امتحان کنید.`);
  stopAll(1);
}
await publishLink(null);
say(`روی همین رایانه: ${local}`);
const lan = lanAddresses();
if (lan.length) say(`روی همان Wi-Fi: ${lan.join('  ')}`);

say('۳/۳ ساختن لینک امن اینترنتی (Cloudflare)…');
const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', local], { cwd: root, shell: isWin });
children.push(tunnel);
let shown = false;
const onOutput = (chunk) => {
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
  if (match && !shown) {
    shown = true;
    void publishLink(match[0]);
    say('');
    say('✅ لینک برای موبایل (در «تنظیمات ← دسترسی از موبایل» هم هست):');
    say(`   ${match[0]}`);
    say('   روی گوشی باز کنید و با رمز ورود وارد شوید. برای بستن: Ctrl+C');
    say('');
  }
};
tunnel.stdout.on('data', onOutput);
tunnel.stderr.on('data', onOutput);
tunnel.on('error', () => {
  say('');
  say('cloudflared نصب نیست؛ لینک اینترنتی ساخته نشد (روی همان Wi-Fi کار می‌کند).');
  say(
    isWin
      ? '   نصب در ویندوز:  winget install --id Cloudflare.cloudflared'
      : '   نصب: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  );
  say('   سپس pnpm share را دوباره اجرا کنید.');
});
tunnel.on('exit', (code) => {
  if (shown) say(`لینک اینترنتی بسته شد (${code ?? 0}).`);
  void publishLink(null);
});
