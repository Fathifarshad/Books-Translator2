import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers';

/** «کتاب PDF» (ADR-046): options, the cover preview and a real build of the sample book, downloaded. */
test.describe('book PDF', () => {
  test('from the library menu to a downloaded book', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await page.locator('[data-book-id="bk_sample"]').getByRole('button', { name: 'بیشتر' }).click();
    await page.getByTestId('export-book-pdf').click();
    await expect(page).toHaveURL(/\/books\/bk_sample\/book-pdf$/);
    await expect(page.getByRole('heading', { name: 'کتاب PDF', level: 1 })).toBeVisible();

    await page.getByTestId('preparer-name').fill('دکتر فرشاد فتحی');
    await page.getByTestId('preparer-title').fill('متخصص طب اورژانس، فلوشیپ انفورماتیک بالینی');
    await page.getByTestId('theme-emerald').click();
    // The live preview shows the cover with the preparer.
    const preview = page.frameLocator('[data-testid="cover-preview"]');
    await expect(preview.getByText('دکتر فرشاد فتحی')).toBeVisible({ timeout: 10_000 });
    await expectNoSeriousA11yViolations(page);

    await page.getByTestId('book-pdf-build').click();
    await expect(page.getByTestId('book-pdf-ready')).toBeVisible({ timeout: 150_000 });
    const download = page.waitForEvent('download');
    await page.getByTestId('book-pdf-download').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Thinking in Steps.pdf');
    const path = await file.path();
    expect(readFileSync(path).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // The preparer is remembered for the next visit.
    await page.reload();
    await expect(page.getByTestId('preparer-name')).toHaveValue('دکتر فرشاد فتحی');
  });

  test('a server older than the page says so instead of a dead button', async ({ page }) => {
    // The app updated while an old server kept running: its router does not know the address.
    await page.route(/\/api\/v1\/books\/bk_sample\/book-pdf(\?|$)/, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND', details: {} } }),
      }),
    );
    await page.goto('/books/bk_sample/book-pdf');
    await expect(page.getByTestId('book-pdf-unavailable')).toContainText('دوباره با آیکون دسکتاپ باز کنید', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('book-pdf-build')).toBeDisabled();
    await expect(page.getByTestId('cover-preview')).toHaveCount(0);
  });

  test('an uploaded cover image replaces the made one', async ({ page }) => {
    await page.goto('/books/bk_sample/book-pdf');
    await page.getByTestId('cover-uploaded').click();
    // A 1×1 PNG.
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4440000000049454e44ae426082',
      'hex',
    );
    await page.getByTestId('cover-file').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('button', { name: 'تعویض تصویر' })).toBeVisible();
    await page.getByRole('button', { name: 'حذف تصویر' }).click();
    await expect(page.getByRole('button', { name: 'انتخاب تصویر جلد' })).toBeVisible();
  });
});
