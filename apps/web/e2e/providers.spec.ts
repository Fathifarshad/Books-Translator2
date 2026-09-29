import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { expectNoSeriousA11yViolations, openReader, seedSettings } from './helpers';

/**
 * Phase 4 end to end against the fake provider server (playwright.config.ts): connect Gemini by pasting a key,
 * OpenRouter with one click (OAuth PKCE through its «Authorize» page), detect Ollama; the tutor, summaries and the
 * chapter quiz on a provider; a book translated by a free provider with its quota on the dashboard. Screenshots go
 * to docs/screens/phase-4/ (1440×900 and 390×844, light and dark).
 */
const OUT = fileURLToPath(new URL('../../../docs/screens/phase-4/', import.meta.url));
const FAKE_KEY = 'fake-gemini-key-0123456789abcdef';
const VARIANTS = [
  { device: 'desktop', theme: 'light', viewport: { width: 1440, height: 900 } },
  { device: 'desktop', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { device: 'mobile', theme: 'light', viewport: { width: 390, height: 844 } },
  { device: 'mobile', theme: 'dark', viewport: { width: 390, height: 844 } },
] as const;

async function shoot(page: Page, name: string, path: string, ready: (p: Page) => Promise<void>, fullPage = false) {
  for (const v of VARIANTS) {
    await page.setViewportSize(v.viewport);
    await seedSettings(page, { theme: v.theme });
    await page.goto(path);
    await ready(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-${name}.png`, fullPage });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** A fresh copy of a fixture (a trailing PDF comment changes its hash, so it is not a duplicate). */
async function freshBook(request: APIRequestContext): Promise<string> {
  const file = fileURLToPath(new URL('../../../fixtures/pdf/no-outline.pdf', import.meta.url));
  const buffer = Buffer.concat([readFileSync(file), Buffer.from(`\n% e2e providers ${Date.now()}\n`)]);
  const res = await request.post('/api/v1/books', {
    multipart: { file: { name: 'providers-e2e.pdf', mimeType: 'application/pdf', buffer } },
  });
  const bookId = ((await res.json()) as { bookId: string }).bookId;
  const status = async () =>
    ((await (await request.get(`/api/v1/books/${bookId}`)).json()) as { book: { status: string } }).book.status;
  await expect.poll(status, { timeout: 30_000 }).toBe('structure_review');
  await request.patch(`/api/v1/books/${bookId}/structure`, { data: { op: 'confirm' } });
  return bookId;
}

test.describe
  .serial('free AI providers', () => {
    test.afterAll(async ({ request }) => {
      await request.put('/api/v1/settings/assistant', { data: { engine: 'mock' } });
    });

    test('connects Gemini by pasting a key, OpenRouter with one click, and finds Ollama', async ({ page }) => {
      await page.goto('/settings');
      const section = page.getByTestId('engines-section');
      await expect(section).toBeVisible();
      await expect(page.getByTestId('provider-gemini-status')).toHaveText('وصل نیست');

      // Gemini: the link opens AI Studio in a new tab; the pasted key is saved and tested.
      const gemini = page.getByTestId('provider-gemini');
      const keyLink = gemini.getByRole('link', { name: /گرفتن کلید رایگان از Google AI Studio/ });
      await expect(keyLink).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
      await expect(keyLink).toHaveAttribute('target', '_blank');
      await gemini.getByTestId('gemini-key').fill(FAKE_KEY);
      await gemini.getByTestId('gemini-save').click();
      await expect(gemini.getByTestId('test-ok')).toContainText('gemini-flash-lite-latest');
      await expect(page.getByTestId('provider-gemini-status')).toHaveText('وصل است');
      await expect(gemini).toContainText(`…${FAKE_KEY.slice(-4)}`);
      await expect(page.locator('body')).not.toContainText(FAKE_KEY);

      // OpenRouter: one click → OpenRouter's «Authorize» page → back here, connected.
      await page.getByTestId('openrouter-connect').click();
      await expect(page).toHaveURL(/127\.0\.0\.1:8798\/openrouter\/auth/);
      await page.locator('#authorize').click();
      await expect(page).toHaveURL(/\/settings\?tab=engines$/);
      await expect(page.getByTestId('connect-notice')).toHaveText('OpenRouter وصل شد و یک مدل رایگان انتخاب شد.');
      await expect(page.getByTestId('provider-openrouter-status')).toHaveText('وصل است');
      await expect(page.getByTestId('provider-openrouter')).toContainText('vendor/good-model:free');

      // Ollama: found on this computer; picking a model tests it.
      const ollama = page.getByTestId('provider-ollama');
      await expect(ollama.getByTestId('ollama-detect')).toHaveText('Ollama پیدا شد — ۱ مدل');
      await ollama.getByTestId('ollama-model').selectOption('aya-expanse:8b');
      await expect(ollama.getByTestId('test-ok')).toBeVisible();
      await expect(page.getByTestId('provider-ollama-status')).toHaveText('وصل است');

      // The assistant (tutor, summaries, quizzes) switches to Gemini.
      await page.getByTestId('assistant-engine').getByRole('radio', { name: 'Google Gemini' }).check();
      await expect(page.getByTestId('assistant-engine').getByRole('radio', { name: 'Google Gemini' })).toBeChecked();
      await expectNoSeriousA11yViolations(page);

      await shoot(
        page,
        'settings-engines',
        '/settings?tab=engines',
        (p) => expect(p.getByTestId('provider-ollama-status')).toHaveText('وصل است'),
        true,
      );
    });

    test('the tutor, summaries and the chapter quiz run on the chosen provider', async ({ page }) => {
      await openReader(page, 'ch1-intro');
      await expect(page.getByTestId('tutor-column')).toContainText('Gemini');
      const box = page.getByRole('textbox', { name: /سؤالت را بنویس/ });
      await box.fill('این بخش درباره‌ی چیست؟');
      await box.press('Enter');
      const answer = page.getByTestId('assistant-message').last();
      await expect(answer).toHaveAttribute('data-status', 'complete', { timeout: 20_000 });
      await expect(answer).toContainText('پاسخ آزمایشیِ موتور رایگان');
      await expect(answer.getByTestId('citation-chip').first()).toBeVisible();
      await page.screenshot({ path: `${OUT}desktop-light-tutor-gemini.png` });

      await openReader(page, 'ch1-recipes');
      await page.getByRole('button', { name: 'چکیده‌ی فارسی این بخش را بساز' }).click();
      await expect(page.getByTestId('summary-card')).toContainText('چکیده‌ی آزمایشی از موتور رایگان');

      await page.goto('/books/bk_sample/quiz/nd_sample_ch1');
      await expect(page.getByTestId('quiz-question')).toHaveCount(8, { timeout: 20_000 });
      await expect(page.getByTestId('quiz-question').first()).toContainText('پرسش آزمایشی');
    });

    test('translates a book with a free provider and shows its quota on the dashboard', async ({ page, request }) => {
      test.setTimeout(180_000);
      const bookId = await freshBook(request);
      // Keep the daily quota shown, but do not wait on the per-minute limit in a test.
      await request.put('/api/v1/settings/providers/gemini', { data: { limits: { rpm: 1000, rpd: 400 } } });
      await page.goto(`/books/${bookId}/setup`);
      await expect(page.getByTestId('translation-settings')).toBeVisible();
      // Untouched defaults switch to the first connected free provider.
      for (const task of ['brief', 'glossary', 'translate', 'edit']) {
        await expect(page.getByTestId(`engine-${task}`)).toHaveValue('gemini');
      }
      await expect(page.getByTestId('engine-all')).toHaveValue('gemini');
      await expect(page.getByTestId('estimate')).toBeVisible();
      await page.screenshot({ path: `${OUT}desktop-light-wizard-engines.png`, fullPage: true });
      await page.getByTestId('start-translation').click();

      const step = page.getByTestId('glossary-step');
      await expect(step).toBeVisible({ timeout: 60_000 });
      await step.getByTestId('approve-glossary').click();
      await page.getByTestId('open-dashboard').click();
      await expect(page.getByTestId('pipeline-state')).toHaveText('پایان‌یافته', { timeout: 90_000 });
      const panel = page.getByTestId('pipeline-providers');
      await expect(panel).toContainText('Google Gemini');
      await expect(panel).toContainText('وصل است');
      await expect(panel).toContainText(/امروز [۰-۹]+ از ۴۰۰ درخواست/);
      await expectNoSeriousA11yViolations(page);
      await shoot(
        page,
        'pipeline-providers',
        `/books/${bookId}/pipeline`,
        (p) => expect(p.getByTestId('pipeline-providers')).toBeVisible(),
        true,
      );

      // The translation came from the provider.
      const bundle = (await (await request.get(`/api/v1/books/${bookId}/bundle`)).json()) as {
        translations: { engine: string }[];
      };
      expect(new Set(bundle.translations.map((t) => t.engine))).toEqual(new Set(['gemini']));
    });
  });
