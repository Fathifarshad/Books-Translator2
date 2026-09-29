import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { read, seedSettings, selectCell } from './helpers';

/**
 * Phase screenshots (SPEC §2 step 6): 1440×900 and 390×844, light and dark → docs/screens/phase-1/.
 * Run with `pnpm screens`; look at them and compare with docs/design/.
 */
const OUT = fileURLToPath(new URL('../../../docs/screens/phase-1/', import.meta.url));
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
        await expect(page.getByTestId('book-card')).toBeVisible();
        await page.screenshot({ path: `${OUT}${device}-${theme}-library.png` });
      });

      test('reader', async ({ page }) => {
        await page.goto(read('ch1-precision'));
        await expect(page.getByTestId('section-title')).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}${device}-${theme}-reader.png` });
      });

      test('glossary and selection', async ({ page }) => {
        await page.goto(read('ch1-intro'));
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
        await page.goto(read('ch1-speed'));
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
