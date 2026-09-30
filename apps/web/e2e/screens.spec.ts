import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { openReader, sampleCard, seedSettings, selectCell } from './helpers';

/**
 * Phase screenshots (SPEC §2 step 6): 1440×900 and 390×844, light and dark → docs/screens/phase-N/.
 * Run with `pnpm screens`; look at them and compare with docs/design/.
 */
const OUT = fileURLToPath(new URL('../../../docs/screens/phase-1/', import.meta.url));
const OUT2 = fileURLToPath(new URL('../../../docs/screens/phase-2/', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../../../fixtures/pdf/no-outline.pdf', import.meta.url));
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;

for (const theme of ['light', 'dark'] as const) {
  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(`${device} ${theme}`, () => {
      test.use({ viewport, deviceScaleFactor: 1 });
      test.beforeEach(async ({ page }) => {
        await seedSettings(page, { theme });
      });

      test('library', async ({ page }) => {
        await page.goto('/');
        await expect(sampleCard(page)).toBeVisible();
        await page.screenshot({ path: `${OUT}${device}-${theme}-library.png` });
      });

      test('reader', async ({ page }) => {
        await openReader(page, 'ch1-precision');
        await expect(page.getByTestId('section-title')).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}${device}-${theme}-reader.png` });
      });

      test('glossary and selection', async ({ page }) => {
        await openReader(page, 'ch1-intro');
        await expect(page.getByTestId('section-title')).toBeVisible();
        if (device === 'desktop') {
          await page.locator('[data-col="target"] .term').first().hover();
          await expect(page.getByTestId('glossary-popover')).toBeVisible();
          await page.screenshot({ path: `${OUT}${device}-${theme}-glossary.png` });
          await page.mouse.move(700, 880);
          await selectCell(page, 'ch1-intro_02', 'target');
        } else {
          await page.getByRole('radio', { name: 'هر دو' }).click();
          await selectCell(page, 'ch1-intro_02', 'target');
        }
        await expect(page.getByTestId('selection-toolbar')).toBeVisible();
        await page.screenshot({ path: `${OUT}${device}-${theme}-selection.png` });
      });

      test('tutor answer', async ({ page }) => {
        await openReader(page, 'ch1-speed');
        if (device === 'mobile') await page.getByTestId('open-tutor').click();
        await page.getByRole('button', { name: 'مهم‌ترین ایده‌ی این بخش چیست؟' }).click();
        await expect(page.getByTestId('assistant-message')).toHaveAttribute('data-status', 'complete', {
          timeout: 20_000,
        });
        await page.screenshot({ path: `${OUT}${device}-${theme}-tutor.png` });
      });
    });
  }
}

/** Uploads the synthetic fixture once (a duplicate upload returns the existing id) and waits for ingestion. */
async function fixtureBook(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/v1/books', {
    multipart: { file: { name: 'no-outline.pdf', mimeType: 'application/pdf', buffer: readFileSync(FIXTURE) } },
  });
  const body = (await res.json()) as { bookId?: string; error?: { details?: { bookId?: string } } };
  const bookId = body.bookId ?? body.error?.details?.bookId;
  if (!bookId) throw new Error(`upload failed: ${res.status()}`);
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/v1/books/${bookId}`)).json()) as { book: { status: string } }).book.status,
      {
        timeout: 30_000,
      },
    )
    .toBe('structure_review');
  return bookId;
}

for (const theme of ['light', 'dark'] as const) {
  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(`phase 2 ${device} ${theme}`, () => {
      test.use({ viewport, deviceScaleFactor: 1 });
      test.beforeEach(async ({ page }) => {
        await seedSettings(page, { theme });
      });

      test('add book', async ({ page }) => {
        await page.goto('/books/new');
        await expect(page.getByTestId('file-input')).toBeAttached();
        await page.screenshot({ path: `${OUT2}${device}-${theme}-add-book.png` });
      });

      test('report and structure review', async ({ page, request }) => {
        const bookId = await fixtureBook(request);
        await page.goto(`/books/${bookId}/setup`);
        await expect(page.getByTestId('report')).toBeVisible();
        await expect(page.getByTestId('structure-node').first()).toBeVisible();
        await page.screenshot({ path: `${OUT2}${device}-${theme}-setup.png`, fullPage: true });
      });
    });
  }
}
