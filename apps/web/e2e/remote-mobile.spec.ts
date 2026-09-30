import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * A phone reaching the app through `pnpm share` (a tunnel adds forwarding headers, simulated here): the access
 * password, a read-only library, the offline copy of a book, and the owner's «دسترسی از موبایل» settings.
 * Screens → docs/screens/mobile/.
 */
const OUT = fileURLToPath(new URL('../../../docs/screens/mobile/', import.meta.url));
const PASSWORD = 'pesaram-1405';
const REMOTE = { 'x-forwarded-for': '203.0.113.9' };

test.describe
  .serial('phone access', () => {
    test.afterAll(async ({ request }) => {
      await request.put('/api/v1/settings/access', { data: { password: null } });
    });

    test('the owner sets an access password in Settings', async ({ page }) => {
      await page.goto('/settings');
      const section = page.getByTestId('access-section');
      await expect(section).toBeVisible();
      await expect(page.getByTestId('access-status')).toContainText('هنوز رمزی گذاشته نشده');
      await page.getByTestId('set-access-password').fill(PASSWORD);
      await section.getByRole('button', { name: 'گذاشتن رمز' }).click();
      await expect(page.getByTestId('access-status')).toContainText('دسترسی از موبایل روشن است');
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}owner-settings-access.png`, fullPage: true });
    });

    test('a phone signs in and reads, but cannot change anything', async ({ page }) => {
      await page.setExtraHTTPHeaders(REMOTE);
      await page.goto('/');
      await expect(page.getByTestId('sign-in')).toBeVisible();
      await page.screenshot({ path: `${OUT}phone-sign-in.png` });

      await page.getByTestId('access-password').fill('wrong-password');
      await page.getByTestId('sign-in-submit').click();
      await expect(page.getByRole('alert')).toHaveText('رمز درست نیست.');

      await page.getByTestId('access-password').fill(PASSWORD);
      await page.getByTestId('sign-in-submit').click();
      await expect(page.getByTestId('reader-badge')).toHaveText('فقط خواندن');
      await expect(page.getByTestId('add-book')).toHaveCount(0);
      await page.screenshot({ path: `${OUT}phone-library.png` });

      await page.goto('/books/bk_sample/read/nd_sample_ch1-intro');
      await expect(page.getByTestId('section-title')).toBeVisible();
      await page.screenshot({ path: `${OUT}phone-reader.png` });

      const status = await page.evaluate(
        async () => (await fetch('/api/v1/books/bk_sample', { method: 'DELETE' })).status,
      );
      expect(status).toBe(403);
    });

    test('downloads a book as one offline file that works without the server', async ({ page, browser }) => {
      await page.setExtraHTTPHeaders(REMOTE);
      await page.goto('/');
      await page.getByTestId('access-password').fill(PASSWORD);
      await page.getByTestId('sign-in-submit').click();
      await expect(page.getByTestId('reader-badge')).toBeVisible();

      await page.locator('[data-book-id="bk_sample"]').getByRole('button', { name: 'بیشتر' }).click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-offline').click()]);
      expect(download.suggestedFilename()).toBe('Thinking in Steps.html');
      // Saved with its .html name, as on the phone (a file without extension would open as plain text).
      const file = test.info().outputPath(download.suggestedFilename());
      await download.saveAs(file);
      const html = readFileSync(file, 'utf8');
      expect(html).toContain('<html lang="fa" dir="rtl">');

      // Open it like a phone would: from a file, with the network cut off.
      const offline = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true });
      const reader = await offline.newPage();
      await reader.goto(pathToFileURL(file).href);
      await expect(reader.locator('#main')).toContainText('این کتاب کوچک یک دعوت‌نامه است');
      await reader.screenshot({ path: `${OUT}phone-offline.png` });
      await reader.click('#mode-both');
      await expect(reader.locator('#main')).toContainText('This small book is an invitation.');
      await reader.click('#btn-search');
      await reader.fill('#q', 'الگوریتم');
      await expect(reader.locator('#results button').first()).toBeVisible();
      await reader.screenshot({ path: `${OUT}phone-offline-search.png` });
      await offline.close();
    });
  });
