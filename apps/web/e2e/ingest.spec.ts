import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/pdf/no-outline.pdf', import.meta.url));

/**
 * Phase 2 end to end: upload → live extraction progress → report → structure review → confirm → read
 * the source text in the reader. Serial: the steps share one uploaded book.
 */
test.describe
  .serial('upload and structure review', () => {
    let setupUrl = '';

    test('uploads a PDF and shows the extraction report', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('add-book').click();
      await expect(page).toHaveURL(/\/books\/new$/);
      await page.getByTestId('file-input').setInputFiles(FIXTURE);
      await expect(page).toHaveURL(/\/books\/bk_[a-z0-9]+\/setup$/, { timeout: 20_000 });
      setupUrl = page.url();
      await expect(page.getByTestId('report')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('report')).toContainText('صفحه‌ی فهرست مطالب چاپی');
      await expect(page.getByTestId('setup-title')).toHaveText('Weather Notes');
      await expectNoSeriousA11yViolations(page);
    });

    test('rejects a second upload of the same file and offers the existing book', async ({ page }) => {
      await page.goto('/books/new');
      await page.getByTestId('file-input').setInputFiles(FIXTURE);
      await expect(page.getByRole('alert')).toContainText('قبلاً اضافه شده');
      await page.getByRole('button', { name: 'باز کردن همان کتاب' }).click();
      await expect(page).toHaveURL(setupUrl);
    });

    test('edits the structure, confirms it and reads the source text', async ({ page }) => {
      await page.goto(setupUrl);
      const editor = page.getByTestId('structure-editor');
      const nodes = editor.getByTestId('structure-node');
      await expect(nodes).toHaveCount(4);
      // Rename «Wind».
      // Pin the row by id: while editing, its title is an input value, not text.
      const windId = await nodes.filter({ hasText: 'Wind' }).getAttribute('data-node-id');
      const wind = editor.locator(`[data-node-id="${windId}"]`);
      await wind.getByRole('button', { name: 'تغییر عنوان' }).click();
      await wind.getByRole('textbox', { name: 'تغییر عنوان' }).fill('Wind and Weather Vanes');
      await wind.getByRole('button', { name: 'ذخیره‌ی عنوان' }).click();
      await expect(editor).toContainText('Wind and Weather Vanes');
      // Split «Rain» at its second sub-heading, then merge it back.
      const rain = nodes.filter({ hasText: 'Rain' }).first();
      await rain.getByRole('button', { name: 'تقسیم از این بند' }).click();
      await rain.getByRole('button', { name: /Measuring rain/ }).click();
      await expect(nodes).toHaveCount(5);
      await nodes.filter({ hasText: 'Measuring rain' }).getByRole('button', { name: 'ادغام با بخش قبل' }).click();
      await expect(nodes).toHaveCount(4);

      await page.getByTestId('confirm-structure').click();
      await expect(page).toHaveURL(/\/read\/nd_/);
      await expect(page.getByTestId('section-title')).toBeVisible();
      // Source-only rows until translated (Phase 3).
      await page.getByRole('treeitem').filter({ hasText: 'Rain' }).first().click();
      await expect(page.locator('[data-col="source"]').first()).toContainText('Rain');
      await expect(page.getByTestId('untranslated-banner')).toContainText('فاز ۳');
    });

    test('the library shows the processed book', async ({ page }) => {
      await page.goto('/');
      const card = page.getByTestId('book-card').filter({ hasText: 'Weather Notes' });
      await expect(card.getByTestId('book-status')).toHaveText('آماده‌ی ترجمه');
    });
  });
