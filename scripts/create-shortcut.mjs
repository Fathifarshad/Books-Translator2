#!/usr/bin/env node
/**
 * Puts a «دوزبانه» shortcut on the Windows desktop (`create-shortcut.cmd`, or `pnpm shortcut`). Double-clicking it
 * runs start.cmd, which installs what is missing, builds the app, starts it and opens the browser.
 * Terminal messages are English: Windows consoles print right-to-left text reversed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'دوزبانه';

if (process.platform !== 'win32') {
  console.log('This shortcut is for Windows. On macOS/Linux run ./start.sh from this folder.');
  process.exit(0);
}

const target = join(root, 'start.cmd');
if (!existsSync(target)) {
  console.error(`start.cmd was not found in ${root}`);
  process.exit(1);
}

/** An .ico that holds the app's PNG icon as it is (Windows Vista and newer read PNG inside an ICO). */
function writeIcon() {
  const png = readFileSync(join(root, 'apps', 'web', 'public', 'icons', 'icon-192.png'));
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head[6] = 192; // width
  head[7] = 192; // height
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  mkdirSync(join(root, 'data'), { recursive: true });
  const file = join(root, 'data', 'dozabaneh.ico');
  writeFileSync(file, Buffer.concat([head, png]));
  return file;
}

// Everything reaches PowerShell through the environment, so the Persian name and any path survive quoting.
// WScript.Shell saves through the ANSI code page and cannot write a Persian file name, so the shortcut is saved
// under a plain name and then moved to the desktop under the real one (a move handles any name).
const script = [
  "$ErrorActionPreference = 'Stop'",
  "$desktop = [Environment]::GetFolderPath('Desktop')",
  "$link = Join-Path $desktop ($env:DOZ_NAME + '.lnk')",
  "$plain = Join-Path $env:TEMP 'dozabaneh-shortcut.lnk'",
  '$shell = New-Object -ComObject WScript.Shell',
  '$s = $shell.CreateShortcut($plain)',
  '$s.TargetPath = $env:DOZ_TARGET',
  '$s.WorkingDirectory = $env:DOZ_ROOT',
  "$s.IconLocation = $env:DOZ_ICON + ',0'",
  '$s.Description = $env:DOZ_NAME',
  '$s.Save()',
  'Move-Item -LiteralPath $plain -Destination $link -Force',
  'Write-Output $link',
].join('; ');

const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
  encoding: 'utf8',
  env: { ...process.env, DOZ_NAME: NAME, DOZ_TARGET: target, DOZ_ROOT: root, DOZ_ICON: writeIcon() },
});
if (result.status !== 0) {
  console.error(result.stderr || 'PowerShell could not create the shortcut.');
  process.exit(1);
}
console.log(`Shortcut created: ${result.stdout.trim()}`);
console.log('Double-click it to start the app.');
