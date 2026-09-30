import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { expectNoSeriousA11yViolations, openReader } from './helpers';

const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/pdf/${name}`, import.meta.url));

async function uploadAndConfirm(page: Page, file: string): Promise<string> {
  await page.goto('/books/new');
  await page.getByTestId('file-input').setInputFiles(fixture(file));
  await expect(page).toHaveURL(/\/books\/bk_[a-z0-9]+\/setup$/, { timeout: 20_000 });
  const bookId = /\/books\/(bk_[a-z0-9]+)\/setup$/.exec(page.url())?.[1] ?? '';
  await expect(page.getByTestId('confirm-structure')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('confirm-structure').click();
  await expect(page.getByTestId('translation-settings')).toBeVisible();
  return bookId;
}

/**
 * Phase 3 end to end: translation settings → brief & glossary review → pipeline (mock engine) → dashboard →
 * review queue → reader, plus the Claude Code hint in agent mode.
 */
test.describe
  .serial('translation pipeline (mock engine)', () => {
    let bookId = '';

    test('configures, reviews the glossary and runs to the end', async ({ page }) => {
      bookId = await uploadAndConfirm(page, 'outline-book.pdf');
      for (const task of ['brief', 'glossary', 'translate', 'edit']) {
        await page.getByTestId(`engine-${task}`).selectOption('mock');
      }
      await expect(page.getByTestId('estimate')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await page.getByTestId('start-translation').click();

      const step = page.getByTestId('glossary-step');
      await expect(step).toBeVisible({ timeout: 30_000 });
      await expect(step.getByTestId('proposed-terms').locator('li').first()).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await step.getByTestId('approve-glossary').click();

      await expect(page.getByTestId('translation-running')).toBeVisible();
      await page.getByTestId('open-dashboard').click();
      await expect(page).toHaveURL(/\/pipeline$/);
      await expect(page.getByTestId('pipeline-state')).toHaveText('پایان‌یافته', { timeout: 30_000 });
      await expect(page.getByTestId('pipeline-stepper')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
    });

    test('the review queue is keyboard-driven and approves flagged items', async ({ page }) => {
      await page.goto(`/books/${bookId}/review`);
      await page.getByRole('button', { name: 'همه‌ی موارد' }).click();
      const items = page.getByTestId('review-item');
      await expect(items.first().or(page.getByTestId('review-empty'))).toBeVisible();
      await page.getByRole('button', { name: 'هشدارها' }).click();
      const count = await items.count();
      if (count > 0) {
        await page.keyboard.press('j');
        await items.first().getByTestId('review-approve').click();
        await expect(items).toHaveCount(count - 1);
      }
      await expectNoSeriousA11yViolations(page);
    });

    test('the reader shows the translation and the library shows the book', async ({ page }) => {
      await page.goto(`/books/${bookId}/read`);
      await expect(page.getByTestId('section-title')).toBeVisible();
      await page.getByRole('treeitem').filter({ hasText: 'Levers' }).first().click();
      await expect(page.locator('[data-col="target"]').first()).toHaveText(/\p{Script=Arabic}/u);
      await page.goto('/');
      const card = page.locator(`[data-book-id="${bookId}"]`);
      await expect(card.getByTestId('open-pipeline')).toBeVisible();
    });

    test('the glossary page lists the approved terms', async ({ page }) => {
      await page.goto(`/books/${bookId}/glossary`);
      const rows = page.getByTestId('glossary-row');
      await expect(rows.first()).toBeVisible();
      await expect(rows.first()).toContainText('تأییدشده');
      await expectNoSeriousA11yViolations(page);
    });
  });

test('agent mode shows the Claude Code hint with the command to run', async ({ page }) => {
  await uploadAndConfirm(page, 'two-column.pdf');
  await page.getByTestId('start-translation').click();
  const hint = page.getByTestId('agent-hint');
  await expect(hint).toBeVisible({ timeout: 20_000 });
  await expect(hint.getByTestId('agent-command')).toHaveText(/^\/process-batches \d+$/);
  await expectNoSeriousA11yViolations(page);
});

test('the glossary card in the reader opens the glossary filtered to its term', async ({ page }) => {
  await openReader(page, 'ch1-intro');
  await page.locator('[data-col="target"] .term').first().hover();
  const card = page.getByTestId('glossary-popover');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'ویرایش' }).click();
  await expect(page).toHaveURL(/\/books\/bk_sample\/glossary\?q=/);
  await expect(page.getByRole('searchbox', { name: 'جستجو در واژه‌نامه' })).not.toHaveValue('');
  await expect(page.getByTestId('glossary-row').first()).toBeVisible();
});
