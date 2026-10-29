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

const FREE = '(رایگان)';
const PAID = '(پولی)';
const SUBSCRIPTION = '(اشتراکی)';

/**
 * How the wizard labels an engine: the engine, the model it will run and what that model costs. The model id is an
 * LTR run inside a Persian label and an <option> cannot hold a <bdi>, so it is isolated with FSI … PDI.
 */
const engineLabel = (engine: string, model: string, cost: string) => `${engine} · \u2068${model}\u2069 ${cost}`;

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

    /** ADR-038: Claude Code needs no key — it is the one engine that is ready the moment the app starts. */
    test('shows Claude Code as connected without a key and answers its connection test', async ({ page }) => {
      await page.goto('/settings');
      const card = page.getByTestId('provider-claude_code');
      await expect(card).toBeVisible();
      await expect(page.getByTestId('provider-claude_code-status')).toHaveText('وصل است');
      await expect(card.getByTestId('claude-code-model')).toHaveValue('sonnet');
      await card.getByTestId('test-claude-code').click();
      await expect(card.getByTestId('test-ok')).toBeVisible({ timeout: 30_000 });
      await expectNoSeriousA11yViolations(page);
      await shoot(
        page,
        'settings-claude-code',
        '/settings',
        (pg) => expect(pg.getByTestId('provider-claude_code')).toBeVisible(),
        true,
      );
    });

    /** ADR-041: Claude has no voice, so the user picks where the sound comes from. */
    test('offers four voice sources, and says the browser one writes no file', async ({ page }) => {
      await page.goto('/settings');
      const card = page.getByTestId('voice-section');
      await expect(card).toBeVisible();
      // The browser's own voice is the starting point: free, nothing to install, no file.
      await expect(card.getByTestId('voice-source')).toHaveValue('browser');
      await expect(card).toContainText('فایل صوتی نمی‌سازد');
      await expect(card.getByTestId('voice-test')).toHaveCount(0);

      await card.getByTestId('voice-source').selectOption('azure');
      await expect(card.getByTestId('voice-key')).toBeVisible();
      await expect(card.getByTestId('voice-region')).toBeVisible();
      await expect(card.getByTestId('voice-test')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await shoot(
        page,
        'settings-voice',
        '/settings',
        (pg) => expect(pg.getByTestId('voice-section')).toBeVisible(),
        true,
      );
      await card.getByTestId('voice-source').selectOption('browser');
    });

    /** ADR-043: a ceiling for the engines charged per token. */
    test('saves a spending cap and reports what was spent', async ({ page, request }) => {
      await page.goto('/settings');
      const card = page.getByTestId('budget-section');
      await expect(card).toBeVisible();
      await card.getByTestId('budget-daily').fill('2');
      await card.getByRole('button').click();
      await expect(card.getByRole('button')).toHaveText('ذخیره شد');
      expect((await (await request.get('/api/v1/settings/budget')).json()).dailyUsd).toBe(2);
      await expect(card.getByTestId('budget-spent')).toBeVisible();
      await expectNoSeriousA11yViolations(page);
      await shoot(
        page,
        'settings-budget',
        '/settings',
        (pg) => expect(pg.getByTestId('budget-section')).toBeVisible(),
        true,
      );
      await request.put('/api/v1/settings/budget', { data: { dailyUsd: null, monthlyUsd: null } });
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
      // Untouched defaults switch to the first connected engine — Claude Code, which needs no key (ADR-038).
      for (const task of ['brief', 'glossary', 'translate', 'edit']) {
        await expect(page.getByTestId(`engine-${task}`)).toHaveValue('claude_code');
      }
      await expect(page.getByTestId('engine-translate').locator('option[value="claude_code"]')).toHaveText(
        engineLabel('Claude Code (خودکار)', 'sonnet', SUBSCRIPTION),
      );
      // This test is about Gemini: choose it for every task.
      await page.getByTestId('engine-all').selectOption('gemini');
      for (const task of ['brief', 'glossary', 'translate', 'edit']) {
        await expect(page.getByTestId(`engine-${task}`)).toHaveValue('gemini');
      }
      // The engine label names the model that will run and whether it costs money (ADR-037).
      const option = (engine: string) => page.getByTestId('engine-translate').locator(`option[value="${engine}"]`);
      await expect(option('gemini')).toHaveText(engineLabel('Gemini', 'gemini-flash-lite-latest', FREE));
      await expect(option('openrouter')).toHaveText(engineLabel('OpenRouter', 'vendor/good-model', FREE));
      // A paid OpenRouter model is labelled «پولی», not «رایگان».
      await request.put('/api/v1/settings/providers/openrouter', { data: { model: 'vendor/big-model' } });
      await page.reload();
      await expect(option('openrouter')).toHaveText(engineLabel('OpenRouter', 'vendor/big-model', PAID));
      await request.put('/api/v1/settings/providers/openrouter', { data: { model: 'vendor/good-model:free' } });
      await page.reload();
      await page.getByTestId('engine-all').selectOption('gemini');
      await expect(page.getByTestId('estimate')).toBeVisible();
      // ADR-043: tokens before «شروع ترجمه»; a free tier spends no dollars.
      await expect(page.getByTestId('cost-estimate')).toContainText('توکن ورودی');
      await expect(page.getByTestId('cost-estimate')).toContainText('هزینه‌ی دلاری ندارد');
      await shoot(
        page,
        'wizard-engines',
        `/books/${bookId}/setup`,
        (p) => expect(p.getByTestId('translation-settings')).toBeVisible(),
        true,
      );
      // `shoot` leaves the dark theme seeded; the rest of this test (and its a11y check) runs on the light one.
      await seedSettings(page, { theme: 'light' });
      await page.goto(`/books/${bookId}/setup`);
      await expect(page.getByTestId('translation-settings')).toBeVisible();
      await page.getByTestId('engine-all').selectOption('gemini');
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
