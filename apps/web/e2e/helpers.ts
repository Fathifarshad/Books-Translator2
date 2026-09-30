import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const BOOK = 'bk_sample';
export const read = (nodeKey: string, seg?: string) =>
  `/books/${BOOK}/read/nd_sample_${nodeKey}${seg ? `?seg=sg_sample_${seg}` : ''}`;

/** Opens the reader and waits until the book has loaded from the API. */
export async function openReader(page: Page, nodeKey: string, seg?: string) {
  await page.goto(read(nodeKey, seg));
  await expect(page.getByTestId('section-title')).toBeVisible();
}

/** The sample book's card in the library (other tests may have added books). */
export const sampleCard = (page: Page) => page.locator('[data-book-id="bk_sample"]');

/** Pre-seeds persisted settings before the app boots (zustand persist format). */
export async function seedSettings(page: Page, settings: Record<string, unknown>) {
  await page.addInitScript((s) => {
    localStorage.setItem('dozabaneh:settings', JSON.stringify({ state: s, version: 1 }));
  }, settings);
}

/** Selects the whole text of one cell programmatically (selectionchange drives the toolbar). */
export async function selectCell(page: Page, segmentKey: string, col: 'target' | 'source') {
  await page.evaluate(
    ([id, c]) => {
      const cell = document.querySelector(`#seg-sg_sample_${id} [data-col="${c}"] p`);
      if (!cell) throw new Error(`cell not found: ${id}/${c}`);
      const range = document.createRange();
      range.selectNodeContents(cell);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    },
    [segmentKey, col] as const,
  );
}

export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious.map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')})`,
    ),
  ).toEqual([]);
}

export function intersects(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
