import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yViolations, intersects, openReader, sampleCard, seedSettings, selectCell } from './helpers';

test.describe('reader layout', () => {
  test('columns render right → left: TOC | Persian | English | tutor', async ({ page }) => {
    await openReader(page, 'ch1-recipes');
    const toc = await page.getByRole('navigation', { name: 'فهرست' }).boundingBox();
    const tutor = await page.getByTestId('tutor-column').boundingBox();
    const target = await page.locator('#seg-sg_sample_ch1-recipes_01 [data-col="target"]').boundingBox();
    const source = await page.locator('#seg-sg_sample_ch1-recipes_01 [data-col="source"]').boundingBox();
    expect(toc && target && source && tutor).toBeTruthy();
    if (!toc || !target || !source || !tutor) return;
    expect(toc.x).toBeGreaterThan(target.x);
    expect(target.x).toBeGreaterThan(source.x);
    expect(source.x).toBeGreaterThan(tutor.x);
    // Paired paragraphs start at the same height.
    expect(Math.abs(target.y - source.y)).toBeLessThan(1);
  });

  test('shows book info, counter with Persian digits and Latin digits in the English metadata (bug §4.2-7)', async ({
    page,
  }) => {
    await openReader(page, 'ch1-recipes');
    await expect(page.getByTestId('translated-counter')).toContainText(/ترجمه‌شده: .*[۰-۹]+.*از/);
    const meta = page.getByTestId('book-meta');
    await expect(meta).toContainText('2025');
    await expect(meta).not.toContainText(/[۰-۹]/);
  });

  test('column toggles keep at least one column visible', async ({ page }) => {
    await openReader(page, 'ch1-recipes');
    const sourceCell = page.locator('#seg-sg_sample_ch1-recipes_01 [data-col="source"]');
    await expect(sourceCell).toBeVisible();
    await page.getByRole('button', { name: /ستون انگلیسی/ }).click();
    await expect(sourceCell).toHaveCount(0);
    await page.getByRole('button', { name: /ستون فارسی/ }).click();
    // Hiding the only visible column is refused.
    await expect(page.locator('#seg-sg_sample_ch1-recipes_01 [data-col="target"]')).toBeVisible();
  });

  test('prev/next buttons and ← / → shortcuts follow the RTL reading direction', async ({ page }) => {
    await openReader(page, 'ch1-recipes');
    await page.getByTestId('next-section').click();
    await expect(page).toHaveURL(/ch1-precision$/);
    await page.getByTestId('prev-section').click();
    await expect(page).toHaveURL(/ch1-recipes$/);
    await page.locator('body').click({ position: { x: 700, y: 10 } });
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/ch1-precision$/);
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/ch1-recipes$/);
  });

  test('deep link scrolls to and flashes the row', async ({ page }) => {
    await openReader(page, 'ch2-bits', 'ch2-bits_02');
    const row = page.locator('#seg-sg_sample_ch2-bits_02');
    await expect(row).toBeInViewport();
    await expect(row).toHaveClass(/row-flash/);
  });
});

test.describe('prototype bug regressions (SPEC §4.2)', () => {
  test('§4.2-1: English titles ending in ? or ) keep punctuation inside their run in the TOC', async ({ page }) => {
    await seedSettings(page, { tocTitles: 'source' });
    await openReader(page, 'ch1-intro');
    for (const [text, last] of [
      ['What Is an Algorithm?', '?'],
      ['Representing the World (with Data)', ')'],
    ] as const) {
      const result = await page.evaluate(
        ([t, ch]) => {
          const bdi = [...document.querySelectorAll('[data-testid="toc-tree"] bdi')].find((b) => b.textContent === t);
          if (!bdi?.firstChild) return null;
          const range = document.createRange();
          const node = bdi.firstChild;
          const idx = (node.textContent ?? '').lastIndexOf(ch);
          range.setStart(node, idx);
          range.setEnd(node, idx + 1);
          const p = range.getBoundingClientRect();
          const b = bdi.getBoundingClientRect();
          const prefix = bdi.parentElement?.querySelector('span')?.getBoundingClientRect();
          return {
            pRight: p.right,
            bRight: b.right,
            bLeft: b.left,
            prefixLeft: prefix?.left ?? 0,
            dir: bdi.getAttribute('dir'),
          };
        },
        [text, last] as const,
      );
      expect(result, text).not.toBeNull();
      if (!result) continue;
      expect(result.dir).toBe('ltr');
      // The final punctuation is the rightmost glyph of the English run…
      expect(Math.abs(result.pRight - result.bRight)).toBeLessThan(2);
      // …and the Persian «فصل n.» prefix sits to the right of the whole run.
      expect(result.prefixLeft).toBeGreaterThanOrEqual(result.bLeft);
    }
  });

  test('§4.2-2: the tutor context follows the section of the selection; citation chips navigate there', async ({
    page,
  }) => {
    await openReader(page, 'ch1-speed');
    await selectCell(page, 'ch1-speed_03', 'source');
    const toolbar = page.getByTestId('selection-toolbar');
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole('button', { name: 'بپرس درباره‌ی این' }).click();

    const answer = page.getByTestId('assistant-message').last();
    await expect(answer).toHaveAttribute('data-status', 'complete', { timeout: 20_000 });
    await expect(page.getByTestId('message-context').last()).toHaveText('فصل ۱ · چه سرعتی کافی است؟');
    const chips = answer.getByTestId('citation-chip');
    await expect(chips.first()).toBeVisible();
    for (const id of await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))) {
      expect(id).toBe('nd_sample_ch1-speed');
    }

    // Navigate elsewhere: the context line changes, the earlier message keeps its own context.
    await page.getByTestId('next-section').click();
    await expect(page.getByTestId('tutor-context')).toContainText('فصل ۲');
    await expect(page.getByTestId('message-context').first()).toHaveText('فصل ۱ · چه سرعتی کافی است؟');

    await chips.first().click();
    await expect(page).toHaveURL(/nd_sample_ch1-speed\?seg=sg_sample_ch1-speed_/);
    await expect(page.locator('.row-flash')).toBeVisible();
  });

  test('§4.2-3: a network error keeps the partial answer and retry does not duplicate messages', async ({ page }) => {
    await openReader(page, 'ch1-intro');
    const box = page.getByRole('textbox', { name: /سؤالت را بنویس/ });
    await box.fill('الگوریتم چیست؟ #error');
    await box.press('Enter');
    const answer = page.getByTestId('assistant-message');
    await expect(answer).toHaveAttribute('data-status', 'error', { timeout: 20_000 });
    await expect(answer.getByRole('alert')).toContainText('پاسخ ناتمام ماند: اتصال برقرار نشد');
    await expect(answer.locator('.answer')).not.toBeEmpty();

    await answer.getByRole('button', { name: 'تلاش دوباره' }).click();
    await expect(answer).toHaveAttribute('data-status', 'complete', { timeout: 20_000 });
    await expect(page.getByTestId('assistant-message')).toHaveCount(1);
    await expect(page.getByTestId('message-context')).toHaveCount(1);
  });

  test('§4.2-4: the glossary popover never overlaps the TOC', async ({ page }) => {
    await openReader(page, 'ch1-intro');
    const term = page.locator('[data-col="target"] .term').first();
    await term.hover();
    const popover = page.getByTestId('glossary-popover');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('الگوریتم');
    const pop = await popover.boundingBox();
    const toc = await page.getByRole('navigation', { name: 'فهرست' }).boundingBox();
    const main = await page.getByTestId('reader-main').boundingBox();
    expect(pop && toc && main).toBeTruthy();
    if (!pop || !toc || !main) return;
    expect(intersects(pop, toc)).toBe(false);
    expect(pop.x).toBeGreaterThanOrEqual(main.x - 1);
    expect(pop.x + pop.width).toBeLessThanOrEqual(main.x + main.width + 1);
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
  });

  test('§4.2-5: no floating control covers the last TOC items', async ({ page }) => {
    await openReader(page, 'ch1-intro');
    const items = page.getByRole('treeitem');
    const last = items.last();
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="treeitem"]')?.getAttribute('data-key') ?? null,
      [box.x + box.width / 2, box.y + box.height / 2] as const,
    );
    expect(hit).toBe(await last.getAttribute('data-key'));
    // The tutor toggle lives in the reader header instead.
    await expect(page.getByTestId('tutor-toggle')).toBeVisible();
  });

  test('§4.2-8: status indicators have a legend and labels', async ({ page }) => {
    await openReader(page, 'ch1-intro');
    await page.getByTestId('legend-button').click();
    const legend = page.getByTestId('legend');
    for (const label of [
      'ترجمه و ویراستاری شده',
      'در حال ترجمه',
      'ترجمه نشده',
      'نیازمند بازبینی',
      'در انتظار Claude Code',
      'خوانده‌شده',
      'خوانده‌نشده',
    ]) {
      await expect(legend).toContainText(label);
    }
    await expect(page.locator('[data-status="needs_review"]').first()).toHaveAttribute('aria-label', 'نیازمند بازبینی');
  });
});

test.describe('reader features', () => {
  test('search (Ctrl+K) finds Persian text and navigates to the row', async ({ page }) => {
    await openReader(page, 'preface');
    await page.keyboard.press('Control+KeyK');
    await page.getByTestId('search-input').fill('جست وجوی دودویی');
    await expect(page.getByTestId('search-hit').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/nd_sample_ch1-speed/);
  });

  test('inline translation editing saves a revision and can be undone', async ({ page }) => {
    await openReader(page, 'preface');
    const row = page.locator('#seg-sg_sample_preface_03');
    await row.hover();
    await row.getByRole('button', { name: 'ویرایش ترجمه' }).click();
    const editor = page.getByTestId('translation-editor');
    await editor.getByRole('textbox', { name: 'ویرایش ترجمه' }).fill('آرام بخوانید.');
    await editor.getByRole('button', { name: 'ذخیره‌ی ویرایش' }).click();
    await expect(row.locator('[data-col="target"]')).toHaveText('آرام بخوانید.');
    await expect(row.getByLabel('ویرایش‌شده توسط شما')).toBeVisible();

    await row.hover();
    await row.getByRole('button', { name: 'ویرایش ترجمه' }).click();
    await page.getByRole('button', { name: 'بازگرداندن نسخه‌ی قبلی' }).click();
    await expect(row.locator('[data-col="target"]')).toContainText('آهسته بخوانید.');
  });

  test('summary card is generated and can be collapsed', async ({ page }) => {
    await openReader(page, 'ch1-recipes');
    await page.getByRole('button', { name: 'چکیده‌ی فارسی این بخش را بساز' }).click();
    const card = page.getByTestId('summary-card');
    await expect(card).toContainText('ایده‌ی اصلی');
    await card.getByRole('button', { name: 'جمع کردن چکیده' }).click();
    await expect(card).not.toContainText('ایده‌ی اصلی');
  });

  test('«translate this section now» fills an untranslated section progressively', async ({ page }) => {
    await openReader(page, 'epilogue');
    await expect(page.getByTestId('untranslated-banner')).toBeVisible();
    await page.getByRole('button', { name: 'ترجمه‌ی این بخش را الان انجام بده' }).click();
    await expect(page.locator('#seg-sg_sample_epilogue_02 [data-col="target"]')).toContainText('تمرین', {
      timeout: 10_000,
    });
    await expect(page.getByTestId('section-title')).toContainText('سخن پایانی');
  });

  test('keyboard-only: TOC tree navigation with arrows and Enter', async ({ page }) => {
    await openReader(page, 'preface');
    const current = page.locator('[role="treeitem"][aria-current="page"]');
    await current.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/nd_sample_ch1-intro/);
  });

  test('chapter quiz has 8 questions with feedback', async ({ page }) => {
    await page.goto('/books/bk_sample/quiz/nd_sample_ch1');
    const questions = page.getByTestId('quiz-question');
    await expect(questions).toHaveCount(8);
    const first = questions.first();
    await first.getByRole('radio').first().check();
    await first.getByRole('button', { name: 'بررسی پاسخ' }).click();
    await expect(first.getByRole('status')).toContainText('توضیح');
  });

  test('reader and library have no serious accessibility violations', async ({ page }) => {
    await page.goto('/');
    await expect(sampleCard(page)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await openReader(page, 'ch1-precision');
    await expect(page.getByTestId('section-title')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('library resumes reading where the reader left off', async ({ page }) => {
    await openReader(page, 'ch2-structures');
    await expect(page.getByTestId('section-title')).toBeVisible();
    await page.goto('/');
    await sampleCard(page).getByTestId('continue-reading').click();
    await expect(page).toHaveURL(/nd_sample_ch2-structures/);
  });
});
