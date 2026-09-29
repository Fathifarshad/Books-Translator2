# PROGRESS — دوزبانه

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. Details and acceptance criteria: docs/SPEC.md §19.

## Phase 0 — Foundation
- [~] `pnpm install && pnpm dev` works on a clean machine (Windows included) — verified on Linux (Node 22.22, pnpm 10.33):
  API `/api/v1/health` + web on :5173. Scripts are cross-platform (no shell syntax); Windows not yet tried.
- [x] Quality gate green (≥ 1 unit test, ≥ 1 Playwright test) — `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`:
  92 unit tests, 23 e2e tests (desktop 1440×900 + mobile 390×844, axe included).
- [x] No Persian literals in components (i18n only) — enforced by `apps/web/src/guards.test.ts` (also: logical CSS only,
  every `t('…')` key exists).

## Phase 1 — Reader UI with an original sample book
- [~] Visual parity with docs/design (light/dark, desktop/mobile screenshots) — screenshots in `docs/screens/phase-1/`
  reviewed against the prototype notes in `docs/design/README.md`; the prototype images themselves are not in the repo
  (ADR-009), so a side-by-side check by the owner is still open.
- [x] All prototype bugs of SPEC §4.2 covered by regression tests and absent:
  1 bidi (e2e `§4.2-1` + `LangText`), 2 tutor context (e2e `§4.2-2`, unit `context.test.ts`, `runner.test.ts`),
  3 streaming error/retry (e2e `§4.2-3`, unit `stream.test.ts`, `runner.test.ts`), 4 glossary popover (e2e `§4.2-4`),
  5 floating button (e2e `§4.2-5`), 6 broken paragraphs (unit `continuation.test.ts` + seed check; applied to PDF
  ingestion in Phase 2), 7 mixed digits (e2e + `digits.test.ts`), 8 status legend (e2e `§4.2-8`).
- [x] Works at 390 px; keyboard-only navigation; axe clean (no serious/critical)
- [x] Selection → «بپرس درباره‌ی این» → mock answer with correct citation chips; network error → partial answer + retry without duplicates

### Phase 1 — what exists (summary)
- Library, add-book placeholder (upload arrives in Phase 2), settings (display), chapter quiz (mock).
- Reader: TOC (counter, search, tree with roving tabindex, legend), header (breadcrumb, titles, column pills /
  segmented control, prev/next, ⋯ menu, summary), aligned rows (lists, quote, code, figure placeholder, caption,
  footnotes with popovers), glossary underline + popover, selection toolbar, paragraph tools (ask, edit with diff +
  undo, copy, QA flag, translator note), «translate this section now» demo, deep links with flash, reading progress,
  end-of-chapter card, themes (light/sepia/dark/system), font size/line height/justify/underline/TOC titles,
  shortcuts (event.code), resizable/collapsible TOC and tutor, tablet drawers, phone bottom sheet.
- Tutor: send-time context, streamed mock answers with validated citations, follow-ups, modes, stop, retry of the
  same message, history, export Markdown, polite live region.

### Known limitations (to address in later phases)
- Highlights/notes from the selection toolbar: Phase 5 (annotations). «نمایش صفحه‌ی اصلی PDF»: Phase 5.
- Glossary «ویرایش» action and the glossary screen: Phase 3.
- Data is per device (localStorage) until the API/database arrive in Phase 2.
- UI language is Persian only (`fa.json`); an English UI file comes with Phase 6 language validation.

## Phase 2 — Backend, database, PDF ingestion, structure review
- [ ] All synthetic fixtures match golden JSON
- [ ] Real text-based PDFs: TOC = outline; no running heads/page numbers in text; < 1% suspected mid-sentence breaks
- [ ] 300+ page PDF ingests without blocking the API, with live progress

## Phase 3 — Engine layer, agent mode, translation pipeline
- [ ] Fixture book + one real chapter translated end-to-end via `/process-batches`; counter reaches 100%
- [ ] `agent:submit` rejects malformed results with actionable errors; double submit is a no-op; restart resumes
- [ ] Normalizer/QA tests (100+ Persian cases) green; review queue works; user edits survive re-runs

## Phase 4 — API engines & real-time tutor
- [ ] Any task switchable between agent / anthropic / openai / mock without code changes
- [ ] With a key: automatic chapter translation; streamed tutor answers with valid citations; retry after network drop; costs recorded
- [ ] Without a key: local tutor mode + «ارسال برای پاسخ با Claude Code» work end-to-end

## Phase 5 — Power features & polish
- [ ] Original-PDF page viewer · figures/tables · footnote popovers
- [ ] Highlights & notes · export EPUB/DOCX/Markdown · global glossary + CSV
- [ ] Optional sentence alignment · OCR for scanned pages · PWA offline · virtualization · a11y audit

## Phase 6 — Mobile & multi-user
- [ ] Auth, Postgres, object storage, Docker deployment
- [ ] Android build runs the full reading + tutor flow against the hosted API (RTL-correct on device)
- [ ] Second and third target languages work without component changes
