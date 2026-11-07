import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { seedSettings } from './helpers';

/** Screenshots of ADR-046 → docs/screens/book-pdf/: the «کتاب PDF» page, 1440×900 and 390×844, light and dark. */
const OUT = fileURLToPath(new URL('../../../docs/screens/book-pdf/', import.meta.url));
const VARIANTS = [
  { device: 'desktop', theme: 'light', viewport: { width: 1440, height: 900 } },
  { device: 'desktop', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { device: 'mobile', theme: 'light', viewport: { width: 390, height: 844 } },
  { device: 'mobile', theme: 'dark', viewport: { width: 390, height: 844 } },
] as const;

test('book PDF screens', async ({ page }) => {
  test.setTimeout(120_000);
  for (const v of VARIANTS) {
    await page.setViewportSize(v.viewport);
    await seedSettings(page, { theme: v.theme });
    await page.goto('/books/bk_sample/book-pdf');
    await page.getByTestId('preparer-name').fill('دکتر فرشاد فتحی');
    await page.getByTestId('preparer-title').fill('متخصص طب اورژانس، فلوشیپ انفورماتیک بالینی');
    await expect(page.frameLocator('[data-testid="cover-preview"]').getByText('دکتر فرشاد فتحی')).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-book-pdf.png`, fullPage: true });
    // No sideways scrolling on a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
