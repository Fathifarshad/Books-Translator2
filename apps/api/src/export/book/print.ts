import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

/**
 * Printing the book page to PDF with a browser that is already on this computer (ADR-046): Microsoft Edge comes
 * with every Windows, Chrome or Chromium is on most other systems. Nothing is downloaded; playwright-core only
 * drives the browser it is given. `BROWSER_PATH` points at another one.
 */
export function browserCandidates(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  const own = env.BROWSER_PATH ? [env.BROWSER_PATH] : [];
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => Boolean(r));
    return [
      ...own,
      ...roots.map((r) => join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ];
  }
  if (platform === 'darwin') {
    return [
      ...own,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    ...own,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
}

/** The first browser that exists here: the installed ones, then a Chromium Playwright may have downloaded for tests. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const found = browserCandidates(env).find((p) => existsSync(p));
  if (found) return found;
  try {
    const bundled = chromium.executablePath();
    return bundled && existsSync(bundled) ? bundled : undefined;
  } catch {
    return undefined;
  }
}

export class BrowserNotFoundError extends Error {
  constructor() {
    super('No Edge, Chrome or Chromium was found on this computer.');
  }
}

/**
 * Prints HTML files to PDF, one browser for all of them. The page is laid out at the width of the printed text
 * block, so labels fitted on screen (`__fitLabels`) fit the same way on paper.
 */
export async function withPrinter<T>(
  contentWidthPx: number,
  run: (print: (htmlFile: string) => Promise<Uint8Array>) => Promise<T>,
): Promise<T> {
  const executablePath = findBrowser();
  if (!executablePath) throw new BrowserNotFoundError();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: Math.round(contentWidthPx), height: 1200 } });
    const print = async (htmlFile: string): Promise<Uint8Array> => {
      const page = await context.newPage();
      page.setDefaultTimeout(20 * 60_000);
      try {
        await page.emulateMedia({ media: 'print' });
        await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
        // Runs in the page (a string, so this file needs no DOM types): fonts first, then the labels are fitted.
        await page.evaluate('document.fonts.ready.then(() => window.__fitLabels && window.__fitLabels())');
        return await page.pdf({ preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
      } finally {
        await page.close();
      }
    };
    return await run(print);
  } finally {
    await browser.close();
  }
}

/**
 * Photographs an HTML file at exactly `width` × `height` pixels (stage 4 of the cover studio): the same browser as
 * the printer, so Persian is shaped the same way on paper and in the picture.
 */
export async function takePicture(
  htmlFile: string,
  size: { width: number; height: number },
  format: 'png' | 'jpg',
  quality = 92,
): Promise<Uint8Array> {
  const executablePath = findBrowser();
  if (!executablePath) throw new BrowserNotFoundError();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  });
  try {
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready.then(() => 0)');
    const clip = { x: 0, y: 0, ...size };
    return format === 'png'
      ? await page.screenshot({ type: 'png', clip })
      : await page.screenshot({ type: 'jpeg', quality, clip });
  } finally {
    await browser.close();
  }
}
