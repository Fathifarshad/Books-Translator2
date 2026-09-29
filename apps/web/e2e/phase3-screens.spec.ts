import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { seedSettings } from './helpers';

/**
 * Phase 3 screenshots (SPEC §2 step 6) → docs/screens/phase-3/: translation settings, the Claude Code hint, glossary
 * review, pipeline dashboard, glossary, review queue and the translated reader — 1440×900 and 390×844, light and dark.
 * One serial test drives two synthetic fixture books through the pipeline (mock engine) and shoots each state.
 */
const OUT = fileURLToPath(new URL('../../../docs/screens/phase-3/', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/pdf/${name}`, import.meta.url));
const VARIANTS = [
  { device: 'desktop', theme: 'light', viewport: { width: 1440, height: 900 } },
  { device: 'desktop', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { device: 'mobile', theme: 'light', viewport: { width: 390, height: 844 } },
  { device: 'mobile', theme: 'dark', viewport: { width: 390, height: 844 } },
] as const;
const MOCK = { engines: { brief: 'mock', glossary: 'mock', translate: 'mock', edit: 'mock' } };

async function bookState(request: APIRequestContext, bookId: string): Promise<string> {
  return ((await (await request.get(`/api/v1/books/${bookId}`)).json()) as { book: { status: string } }).book.status;
}

async function pipelineState(request: APIRequestContext, bookId: string): Promise<string> {
  return ((await (await request.get(`/api/v1/books/${bookId}/pipeline?lang=fa`)).json()) as { state: string }).state;
}

/** Uploads a fixture (a duplicate returns the existing book), waits for ingestion and confirms the structure. */
async function readyBook(request: APIRequestContext, file: string): Promise<string> {
  const res = await request.post('/api/v1/books', {
    multipart: { file: { name: file, mimeType: 'application/pdf', buffer: readFileSync(fixture(file)) } },
  });
  const body = (await res.json()) as { bookId?: string; error?: { details?: { bookId?: string } } };
  const bookId = body.bookId ?? body.error?.details?.bookId;
  if (!bookId) throw new Error(`upload failed: ${res.status()}`);
  await expect.poll(() => bookState(request, bookId), { timeout: 30_000 }).not.toMatch(/^(uploaded|ingesting)$/);
  if ((await bookState(request, bookId)) === 'structure_review') {
    await request.patch(`/api/v1/books/${bookId}/structure`, { data: { op: 'confirm' } });
  }
  return bookId;
}

test('phase 3 screens', async ({ page, request }) => {
  test.setTimeout(300_000);
  const shoot = async (name: string, path: string, ready: (p: Page) => Promise<void>, fullPage = false) => {
    for (const v of VARIANTS) {
      await page.setViewportSize(v.viewport);
      await seedSettings(page, { theme: v.theme });
      await page.goto(path);
      await ready(page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}${v.device}-${v.theme}-${name}.png`, fullPage });
    }
  };

  // Step 4: translation settings.
  const agentBook = await readyBook(request, 'two-column.pdf');
  await shoot(
    'settings',
    `/books/${agentBook}/setup`,
    (p) => expect(p.getByTestId('translation-settings')).toBeVisible(),
    true,
  );

  // Agent mode: the Claude Code hint with the command to run.
  await request.post(`/api/v1/books/${agentBook}/pipeline/start`, { data: { lang: 'fa' } });
  await shoot('agent-hint', `/books/${agentBook}/setup`, (p) => expect(p.getByTestId('agent-hint')).toBeVisible());

  // Step 5: brief and glossary review.
  const book = await readyBook(request, 'outline-book.pdf');
  await request.post(`/api/v1/books/${book}/pipeline/start`, { data: { lang: 'fa', settings: MOCK } });
  await expect.poll(() => pipelineState(request, book), { timeout: 60_000 }).toBe('waiting_glossary_review');
  await shoot(
    'glossary-review',
    `/books/${book}/setup`,
    (p) => expect(p.getByTestId('glossary-step')).toBeVisible(),
    true,
  );

  // Translation runs to the end: dashboard, glossary, review queue, reader.
  await request.post(`/api/v1/books/${book}/glossary/approve`, { data: { lang: 'fa' } });
  await expect.poll(() => pipelineState(request, book), { timeout: 60_000 }).toBe('done');
  await shoot(
    'dashboard',
    `/books/${book}/pipeline`,
    (p) => expect(p.getByTestId('pipeline-state')).toBeVisible(),
    true,
  );
  await shoot('glossary', `/books/${book}/glossary`, (p) =>
    expect(p.getByTestId('glossary-row').first()).toBeVisible(),
  );
  await shoot('review', `/books/${book}/review?`, async (p) => {
    await p.getByRole('button', { name: 'همه‌ی موارد' }).click();
    await expect(p.getByTestId('review-item').first().or(p.getByTestId('review-empty'))).toBeVisible();
  });
  await shoot('reader', `/books/${book}/read`, (p) => expect(p.getByTestId('section-title')).toBeVisible());
});
