import { expect, type Page, test } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers';

/** «استودیوی جلد» (ADR-048): edit the cover's texts, fonts and places; the book PDF uses the design. */

const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4440000000049454e44ae426082',
  'hex',
);

async function openStudio(page: Page) {
  await page.goto('/books/bk_sample/cover-studio');
  await expect(page.getByRole('heading', { name: 'استودیوی جلد', level: 1 })).toBeVisible();
  await expect(page.getByTestId('hit-title')).toBeVisible({ timeout: 15_000 });
}

/** The value of a layer's style inside the cover's shadow root. */
function layerStyle(page: Page, id: string, prop: string) {
  return page.getByTestId('cover-render').evaluate(
    (host, [layer, p]) => {
      const el = host.shadowRoot?.querySelector<HTMLElement>(`[data-layer="${layer}"]`);
      return el ? getComputedStyle(el).getPropertyValue(p as string) : null;
    },
    [id, prop],
  );
}

async function saved(page: Page) {
  await expect(page.getByTestId('save-state')).toHaveText('همه‌ی تغییرها ذخیره شد', { timeout: 10_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('cover studio', () => {
  test.afterAll(async ({ request }) => {
    await request.delete('/api/v1/books/bk_sample/cover-design?lang=fa');
  });

  test('from the library: write the title, choose its font, move it, undo, and keep it', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-book-id="bk_sample"]').getByRole('button', { name: 'بیشتر' }).click();
    await page.getByTestId('open-cover-studio-menu').click();
    await expect(page).toHaveURL(/\/books\/bk_sample\/cover-studio$/);
    await expect(page.getByTestId('hit-title')).toBeVisible({ timeout: 15_000 });

    // Select the title on the cover and write a new one.
    await page.getByTestId('hit-title').click();
    await expect(page.getByTestId('inspector')).toBeVisible();
    await page.getByTestId('layer-text').fill('گام‌به‌گام اندیشیدن');
    await expect(page.getByTestId('cover-render').getByText('گام‌به‌گام اندیشیدن')).toBeVisible();

    // Another face: the picker writes each name in its own face.
    await page.getByTestId('font-picker').click();
    await page.getByTestId('font-search').fill('Lalezar');
    await page.getByTestId('font-lalezar').click();
    expect(await layerStyle(page, 'title', 'font-family')).toContain('cv-lalezar');

    // Drag it down; it moves, and undo puts it back.
    const y0 = Number(await page.getByTestId('layer-y').inputValue());
    const box = await page.getByTestId('hit-title').boundingBox();
    if (!box) throw new Error('no title box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 7, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    const y1 = Number(await page.getByTestId('layer-y').inputValue());
    expect(y1).toBeGreaterThan(y0 + 3);
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('layer-y')).toHaveValue(String(y0));
    await page.getByTestId('redo').click();
    await expect(page.getByTestId('layer-y')).toHaveValue(String(y1));

    // The layout grid: top centre.
    await page.getByTestId('place-top-center').click();
    expect(Number(await page.getByTestId('layer-y').inputValue())).toBeLessThan(25);
    // Arrow keys move the selected layer.
    await page.getByTestId('cover-canvas').focus();
    const before = Number(await page.getByTestId('layer-y').inputValue());
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('layer-y')).toHaveValue(String(before + 0.5));

    await saved(page);
    await expectNoSeriousA11yViolations(page);

    // Kept: after a reload, and on the book PDF page, whose cover is now the designed one.
    await page.reload();
    await expect(page.getByTestId('cover-render').getByText('گام‌به‌گام اندیشیدن')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('to-book-pdf').click();
    await expect(page.getByTestId('cover-designed')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.frameLocator('[data-testid="cover-preview"]').getByText('گام‌به‌گام اندیشیدن')).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId('open-cover-studio').click();
    await expect(page).toHaveURL(/cover-studio$/);
  });

  test('ground: a palette, an image with darkening, and the readability check', async ({ page }) => {
    await openStudio(page);
    await page.getByTestId('tab-background').click();
    await page.getByTestId('palette-burgundy').click();
    await expect
      .poll(() =>
        page.getByTestId('cover-render').evaluate((h) => h.shadowRoot?.querySelector('.cv-bgwrap')?.innerHTML ?? ''),
      )
      .toContain('#5a1628');

    // Title ink the colour of the ground: the check says so and points at the layer.
    await page.getByTestId('tab-layers').click();
    await page.getByTestId('layer-title').click();
    await page.getByTestId('layer-color').fill('#5a1628');
    await expect(page.getByTestId('issue-contrast-title')).toBeVisible({ timeout: 5_000 });
    // A band under the type makes it readable again.
    await page.getByTestId('effects').locator('summary').click();
    await page.getByTestId('toggle-band').check();
    await page.getByTestId('layer-color').fill('#ffffff');
    await expect(page.getByTestId('issue-contrast-title')).toHaveCount(0, { timeout: 5_000 });

    // An image of the book as the ground.
    await page.getByTestId('tab-background').click();
    await page.getByTestId('ground-kind').getByRole('radio', { name: 'تصویر' }).click();
    await page.getByTestId('bg-file').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG_1x1 });
    await expect(page.getByTestId('image-gallery').locator('li')).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .getByTestId('cover-render')
          .evaluate((h) => h.shadowRoot?.querySelector('.cv-img')?.getAttribute('src') ?? ''),
      )
      .toContain('/cover-images/img-');
    await page.getByTestId('bg-dim').fill('0.5');
    await saved(page);
  });

  test('layers: add a badge, hide one, keep a template and apply it after a reset', async ({ page }) => {
    await openStudio(page);
    await page.getByTestId('add-text').click();
    await page.getByTestId('add-badge').click();
    await expect(page.getByTestId('hit-badge')).toBeVisible();
    await expect(page.getByTestId('layer-text')).toHaveValue('ویرایش جدید');

    await page.getByTestId('visible-original').click();
    await expect(page.getByTestId('hit-original')).toHaveCount(0);

    await page.getByTestId('tab-templates').click();
    await page.getByTestId('template-name').fill('عنابی با برچسب');
    await page.getByTestId('save-template').click();
    const card = page.getByTestId('template-list').locator('li');
    await expect(card).toHaveCount(1);

    page.once('dialog', (d) => d.accept());
    await page.getByTestId('reset-design').click();
    await expect(page.getByTestId('hit-badge')).toHaveCount(0);
    await card.first().getByRole('button').first().click();
    await expect(page.getByTestId('hit-badge')).toBeVisible();
    await saved(page);

    // Templates outlive the book's design; clean up.
    const list = await (await page.request.get('/api/v1/cover-templates')).json();
    for (const tpl of list) await page.request.delete(`/api/v1/cover-templates/${tpl.id}`);
  });
});
