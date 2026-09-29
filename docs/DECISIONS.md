# DECISIONS — ADR log

Format for each entry:

## ADR-NNN — Title (YYYY-MM-DD)
- **Context:** why a decision was needed
- **Decision:** what we chose
- **Consequences:** trade-offs, follow-ups

---

## ADR-001 — Baseline architecture (from docs/SPEC.md §5)
- **Context:** web app now, Android/iOS later; RTL-heavy bilingual reader; AI work must run without an API key at first.
- **Decision:** pnpm monorepo; React + Vite SPA (Capacitor-ready); Fastify API; SQLite + Drizzle (Postgres later);
  DB-backed job queue; pdf.js ingestion; engine layer with `agent` (Claude Code via file exchange), `anthropic`,
  `openai`, `mock`; prompts shared by all engines.
- **Consequences:** zero-setup local development; switching to API mode is configuration only; Postgres/auth arrive in Phase 6.

## ADR-002 — Phases 0 and 1 delivered together without a separate plan-approval stop (2026-09-29)
- **Context:** SPEC §2 asks for a plan and approval before each phase. This work ran as an asynchronous cloud session
  whose request described exactly the Phase 1 reader (TOC | translation | original | tutor column).
- **Decision:** build Phase 0 (foundation) and Phase 1 (reader + tutor with mock data) in one branch, record the plan in
  `docs/PROGRESS.md`, and stop before Phase 2 for review.
- **Consequences:** Phase 2 (PDF ingestion) starts only after the owner reviews this branch.

## ADR-003 — Toolchain versions (2026-09-29)
- **Context:** "latest stable" at implementation time.
- **Decision:** TypeScript 7 (native compiler), Vite 8, React 19, React Router 8 (`RouterProvider` from `react-router/dom`),
  Tailwind CSS 4 (CSS-first `@theme inline` mapped to our tokens), Vitest 5 (projects), Playwright 1.63, Biome 2.5,
  Fastify 5, zod 4, i18next 26. pnpm is pinned to 10.33 (`packageManager`) because it is the version validated here;
  moving to pnpm 12 is a separate step. Node ≥ 22.22 (required by React Router 8).
- **Consequences:** `pnpm typecheck` runs `tsc` from TypeScript 7 in every package.

## ADR-004 — Workspace packages export TypeScript sources (2026-09-29)
- **Context:** web (Vite), API (tsx), tests (Vitest) and later Capacitor all consume `packages/*`.
- **Decision:** packages expose `src/index.ts` directly (`exports`), no per-package build step. `packages/pdf` is created in
  Phase 2 when ingestion starts; `text`, `shared`, `core`, `ai` exist now because Phase 1 uses them.
- **Consequences:** zero build orchestration; the API will be bundled for deployment in Phase 6.

## ADR-005 — Phase 1 runs entirely in the browser (2026-09-29)
- **Context:** Phase 1 uses mock data; the owner follows the project from a phone.
- **Decision:** the reader reads the sample book through a `BookRepository` interface (local implementation now, API in
  Phase 2); the tutor runs the core orchestration (`buildTutorContext` → engine → `resolveCitations`) in the browser with
  the deterministic mock engine behind the `TutorEngine` interface. Streaming goes through `withTimeouts` (first-token
  30 s, idle 45 s, abort) exactly as the SSE transport will in Phase 4. Edits, progress, summaries and conversations are
  persisted in `localStorage` via a storage wrapper that never throws.
- **Consequences:** the web build works as a static site; Phase 2/4 swap the repository and transport without UI changes.

## ADR-006 — Chapter titles come from the intro's heading segment (2026-09-29)
- **Context:** TOC titles must be translated like any other text and stay aligned with segments.
- **Decision:** every node title is its heading segment (source) + that segment's translation. A chapter's heading
  segment belongs to its synthetic `chapter_intro` node; the chapter node points to it (`headingSegmentId`).
- **Consequences:** translating a heading updates the TOC, breadcrumb and tutor labels automatically.

## ADR-007 — One reader-level popover for glossary terms (2026-09-29)
- **Context:** books have thousands of term occurrences; one Floating UI instance per term is wasteful.
- **Decision:** terms render as `<button data-term-id>`; a single `GlossaryPopover` handles delegated hover (300 ms),
  tap and keyboard focus, positioned with Floating UI (`flip`/`shift`/`size`, boundary = the reader `main`, portal).
- **Consequences:** fixes bug §4.2-4 structurally; the same pattern drives the selection toolbar.

## ADR-008 — Tutor visibility per layout (2026-09-29)
- **Context:** the desktop tutor column should remember its state, but a phone bottom sheet must not cover text on arrival.
- **Decision:** `tutorOpen` (desktop column, persisted) and `tutorSheetOpen` (tablet drawer / phone sheet, not
  persisted); `setTutor()` targets the right one for the current layout.
- **Consequences:** the phone shows a reserved «بپرس از مدرس» bar instead of a floating button (bug §4.2-5).

## ADR-009 — Prototype screenshots are not committed (2026-09-29)
- **Context:** SPEC §4 expects `docs/design/*.png`, but the screenshots show pages of a copyrighted book and SPEC §2.7/§16
  forbid copyrighted book text in the repository.
- **Decision:** `docs/design/README.md` describes each screenshot and the design notes taken from them (no book text).
  The owner adds the images if the repository stays private.
- **Consequences:** visual comparison uses the notes plus the owner's copies of the screenshots.

## ADR-010 — Search normalization treats ZWNJ as a word gap except around known affixes (2026-09-29)
- **Context:** «جست‌وجو» / «جست وجو» and «کتاب‌ها» / «کتاب ها» / «کتابها» must match (SPEC §9.5-6).
- **Decision:** ZWNJ and spaces are removed before the plural/comparative suffixes (ها، های، هایی، تر، ترین) and after
  «می/نمی»; elsewhere a ZWNJ counts as a space. «آ» folds to «ا», Arabic ي/ك to ی/ک, digits to Latin.
- **Consequences:** a spelling written without any separator («جستوجو») does not match a spaced one; acceptable for
  search, revisit with FTS5 in Phase 2.
