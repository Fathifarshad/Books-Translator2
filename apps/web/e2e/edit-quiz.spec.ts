import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations, openReader } from './helpers';

const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/pdf/${name}`, import.meta.url));

/**
 * ADR-045: a Persian book is edited, not translated; quizzes and the tutor prepare questions at a chosen level.
 * The PDF gets a trailing comment so it is not a duplicate of the fixture other specs upload.
 */
test.describe('edit-only books and question levels', () => {
  test('uploads a Persian book for editing: no translation, the editing settings say so', async ({ page }) => {
    await page.goto('/books/new');
    const kinds = page.getByTestId('book-kind');
    await expect(kinds.getByRole('radio')).toHaveCount(2);
    await expectNoSeriousA11yViolations(page);
    await kinds.getByRole('radio', { name: /کتاب فارسی — بدون ترجمه/ }).check();
    const pdf = Buffer.concat([readFileSync(fixture('outline-book.pdf')), Buffer.from('\n% edit-only e2e\n')]);
    await page.getByTestId('file-input').setInputFiles({ name: 'ketab.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect(page).toHaveURL(/\/books\/bk_[a-z0-9]+\/setup$/, { timeout: 20_000 });
    await expect(page.getByTestId('confirm-structure')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('confirm-structure').click();
    await expect(page.getByTestId('edit-only-hint')).toBeVisible();
    await expect(page.getByTestId('target-language').locator('option')).toHaveText(['فارسی']);
    await expectNoSeriousA11yViolations(page);
  });

  test('the library menu offers the errata file', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-book-id="bk_sample"]').getByRole('button', { name: 'بیشتر' }).click();
    await expect(page.getByTestId('export-errata-word')).toHaveAttribute('href', /\/export\/errata\?format=word/);
    await expect(page.getByTestId('export-errata-csv')).toHaveAttribute('href', /\/export\/errata\?format=csv/);
  });

  test('a chapter quiz at one level, downloadable with its answer key', async ({ page }) => {
    await page.goto('/books/bk_sample/quiz/nd_sample_ch1');
    const questions = page.getByTestId('quiz-question');
    await expect(questions.first()).toBeVisible();
    await page.getByTestId('quiz-level').getByRole('radio', { name: 'حرفه‌ای' }).check();
    await expect(questions.first()).toBeVisible();
    const n = await questions.count();
    for (let i = 0; i < n; i++) await expect(questions.nth(i)).toContainText('حرفه‌ای');
    await expectNoSeriousA11yViolations(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'دریافت سؤال‌ها و پاسخ‌نامه' }).click();
    expect((await download).suggestedFilename()).toBe('quiz-nd_sample_ch1-professional.md');
  });

  test('the tutor prepares questions at a chosen level', async ({ page }) => {
    await openReader(page, 'ch1-recipes');
    const levels = page.getByTestId('tutor-question-levels');
    await levels.getByRole('button', { name: 'دشوار' }).click();
    await expect(page.getByTestId('tutor-messages')).toContainText('سطح «دشوار»');
  });
});
