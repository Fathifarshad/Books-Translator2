import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { seedSettings } from './helpers';

/** Screenshots of ADR-048 → docs/screens/cover-studio/: «استودیوی جلد», 1440×900 and 390×844, light and dark. */
const OUT = fileURLToPath(new URL('../../../docs/screens/cover-studio/', import.meta.url));
const VARIANTS = [
  { device: 'desktop', theme: 'light', viewport: { width: 1440, height: 900 } },
  { device: 'desktop', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { device: 'mobile', theme: 'light', viewport: { width: 390, height: 844 } },
  { device: 'mobile', theme: 'dark', viewport: { width: 390, height: 844 } },
] as const;

test('cover studio screens', async ({ page }) => {
  test.setTimeout(180_000);
  for (const v of VARIANTS) {
    await page.setViewportSize(v.viewport);
    await seedSettings(page, { theme: v.theme });
    await page.goto('/books/bk_sample/cover-studio');
    await expect(page.getByTestId('hit-title')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('hit-title').click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-cover-studio.png`, fullPage: true });
    // The font list, open.
    await page.getByTestId('font-picker').click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-cover-fonts.png`, fullPage: false });
    await page.keyboard.press('Escape');
    await page.getByTestId('font-picker').click();
    await page.getByTestId('tab-background').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-cover-background.png`, fullPage: true });
    // The printer's cover: paper and pages, the ISBN, the sheet, and the back cover being edited.
    await page.getByTestId('tab-print').click();
    await page.getByTestId('print-pages').fill('320');
    await page.getByTestId('print-isbn').fill('978-964-6194-33-5');
    await page.getByTestId('print-price').fill('۱۲۰٬۰۰۰ تومان');
    await page
      .getByTestId('print-blurb')
      .fill(
        'این کتاب شما را گام‌به‌گام با شیوه‌ی اندیشیدن منظم آشنا می‌کند؛ از پرسیدن پرسش درست تا رسیدن به نتیجه‌ای که بتوان از آن دفاع کرد.\n\nمناسب دانشجویان و پژوهشگران.',
      );
    await expect(page.getByTestId('print-preview')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1800);
    await page.getByTestId('print-sheet').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-cover-print.png`, fullPage: true });
    await page.getByTestId('tab-export').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-cover-export.png`, fullPage: true });
    await page.getByTestId('side-back').click();
    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-barcode').click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-cover-back.png`, fullPage: true });
    await page.getByTestId('side-front').click();
    // A round of designs (the app's own designer in the test server).
    await page.getByTestId('tab-ai').click();
    if (v.device === 'desktop' && v.theme === 'light') await page.getByTestId('ai-start').click();
    await expect(page.getByTestId('ai-results').locator('li')).toHaveCount(3, { timeout: 20_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-cover-ai.png`, fullPage: true });
    await page.goto('/settings#painter');
    await expect(page.getByTestId('painter-section')).toBeVisible();
    await page.getByTestId('painter-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-settings-painter.png`, fullPage: false });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
  await page.request.put('/api/v1/books/bk_sample/cover-print', { data: { lang: 'fa', print: {}, back: null } });
});
