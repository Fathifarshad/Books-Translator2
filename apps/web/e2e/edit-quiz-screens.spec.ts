import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { seedSettings } from './helpers';

/**
 * Screenshots of ADR-045 → docs/screens/edit-quiz/: the book-kind choice on upload, the editing settings of a
 * Persian book, the chapter quiz with its level picker and the tutor's question levels — 1440×900 and 390×844,
 * light and dark.
 */
const OUT = fileURLToPath(new URL('../../../docs/screens/edit-quiz/', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`../../../fixtures/pdf/${name}`, import.meta.url));
const VARIANTS = [
  { device: 'desktop', theme: 'light', viewport: { width: 1440, height: 900 } },
  { device: 'desktop', theme: 'dark', viewport: { width: 1440, height: 900 } },
  { device: 'mobile', theme: 'light', viewport: { width: 390, height: 844 } },
  { device: 'mobile', theme: 'dark', viewport: { width: 390, height: 844 } },
] as const;

async function bookState(request: APIRequestContext, bookId: string): Promise<string> {
  return ((await (await request.get(`/api/v1/books/${bookId}`)).json()) as { book: { status: string } }).book.status;
}

/** A Persian (edit-only) copy of a fixture, ingested and confirmed; a second run reuses it. */
async function persianBook(request: APIRequestContext): Promise<string> {
  const buffer = Buffer.concat([readFileSync(fixture('two-column.pdf')), Buffer.from('\n% edit-only screens\n')]);
  const res = await request.post('/api/v1/books?sourceLang=fa&targetLang=fa', {
    multipart: { file: { name: 'ketab.pdf', mimeType: 'application/pdf', buffer } },
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

test('edit-only and question-level screens', async ({ page, request }) => {
  test.setTimeout(240_000);
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

  await shoot('add-book', '/books/new', (p) => expect(p.getByTestId('book-kind')).toBeVisible(), true);

  const book = await persianBook(request);
  await shoot('edit-settings', `/books/${book}/setup`, (p) => expect(p.getByTestId('edit-only-hint')).toBeVisible());

  await shoot('quiz-professional', '/books/bk_sample/quiz/nd_sample_ch1', async (p) => {
    await p.getByTestId('quiz-level').getByRole('radio', { name: 'حرفه‌ای' }).check();
    await expect(p.getByTestId('quiz-question').first()).toContainText('حرفه‌ای');
  });

  await page.setViewportSize(VARIANTS[0].viewport);
  for (const theme of ['light', 'dark'] as const) {
    await seedSettings(page, { theme });
    await page.goto('/books/bk_sample/read/nd_sample_ch1-recipes');
    await expect(page.getByTestId('tutor-question-levels')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}desktop-${theme}-tutor-levels.png` });
  }
});
