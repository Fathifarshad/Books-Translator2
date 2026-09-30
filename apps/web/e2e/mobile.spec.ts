import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations, openReader } from './helpers';

test.describe('mobile (390×844)', () => {
  test('TOC drawer navigates and closes', async ({ page }) => {
    // The current chapter is expanded in the TOC.
    await openReader(page, 'ch1-intro');
    await page.getByRole('button', { name: 'باز کردن فهرست' }).click();
    const drawer = page.getByRole('dialog', { name: 'فهرست' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('treeitem').filter({ hasText: 'دستورپخت‌ها' }).click();
    await expect(page).toHaveURL(/nd_sample_ch1-recipes/);
    await expect(drawer).toBeHidden();
  });

  test('segmented control switches Persian / English / both', async ({ page }) => {
    await openReader(page, 'ch1-recipes');
    const row = page.locator('#seg-sg_sample_ch1-recipes_01');
    await expect(row.locator('[data-col="target"]')).toBeVisible();
    await expect(row.locator('[data-col="source"]')).toHaveCount(0);
    await page.getByRole('radio', { name: 'انگلیسی' }).click();
    await expect(row.locator('[data-col="source"]')).toBeVisible();
    await expect(row.locator('[data-col="target"]')).toHaveCount(0);
    await page.getByRole('radio', { name: 'هر دو' }).click();
    await expect(row.locator('[data-col="target"]')).toBeVisible();
    await expect(row.locator('[data-col="source"]')).toBeVisible();
  });

  test('tutor opens as a bottom sheet and answers', async ({ page }) => {
    await openReader(page, 'ch1-intro');
    await page.getByTestId('open-tutor').click();
    const sheet = page.getByRole('region', { name: 'بپرس از مدرس' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'یک مثال عملی بزن' }).click();
    await expect(page.getByTestId('assistant-message')).toHaveAttribute('data-status', 'complete', { timeout: 20_000 });
    // The reader reserves room so the text above the sheet stays reachable.
    const padding = await page.locator('[data-reader-scroll]').evaluate((el) => getComputedStyle(el).paddingBottom);
    expect(Number.parseFloat(padding)).toBeGreaterThan(200);
  });

  test('no serious accessibility violations', async ({ page }) => {
    await openReader(page, 'ch1-precision');
    await expect(page.getByTestId('section-title')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
