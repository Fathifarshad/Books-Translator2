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

## ADR-011 — PDF extraction with pdf.js 6 in a worker thread (2026-09-29)
- **Context:** SPEC §8 needs positions, font names and the outline; MuPDF is AGPL (not allowed without approval);
  extraction of a large book must not block the API.
- **Decision:** `pdfjs-dist` 6 legacy build (Apache-2.0) in a `worker_threads` worker. pdf.js 6 removed the
  `isEvalSupported` option (it no longer evaluates code from PDFs); we pass `enableXfa: false` and never render
  annotations/JS. Font names come from `page.commonObjs` after `getOperatorList()`. In development the worker boots
  through `worker-boot.mjs`, which registers `tsx` so it can import the TypeScript sources; built code loads `worker.js`.
- **Consequences:** the 320-page synthetic book takes about 4 s; scanned pages are reported (`pagesWithoutText`) and wait for OCR
  (Phase 5).

## ADR-012 — Book text is stored as ordered segments with stable ids; structure edits only move boundaries (2026-09-29)
- **Context:** translations, notes, tutor citations and deep links reference segments; structure review happens after
  extraction.
- **Decision:** `segments` keep ulid ids (`sg_…`) and an `ord` across the book; `toc_nodes` hold `firstSegmentId`,
  `lastSegmentId`, depth and kind. Rename/skip/promote/demote/merge/split (`packages/core/src/structure-edit.ts`) change
  nodes only. A node's title is its heading segment (ADR-006) or, when the title came from the outline/Contents page and
  no heading segment exists, `toc_nodes.title`.
- **Consequences:** re-running structure review never loses work; a chapter without children is readable itself
  (`isReadable(node, hasChildren)`).

## ADR-013 — The reader loads one bundle per book (2026-09-29)
- **Context:** Phase 1 components expect the whole `Book` in memory (TOC counters, search, tutor context).
- **Decision:** `GET /api/v1/books/:id/bundle` returns book + nodes (document order) + segments + glossary +
  translations; the web keeps it in TanStack Query. A 300-page book is a few MB of JSON.
- **Consequences:** simple and fast for normal books; virtualization and per-chapter loading come with Phase 5 if
  profiling needs them.

## ADR-014 — FTS5 with normalized text and prefix queries (2026-09-29)
- **Context:** Persian search must ignore ZWNJ/diacritics/letter variants (ADR-010) and be fast on large books.
- **Decision:** two FTS5 tables (`segments_fts` for the source, `translations_fts` per language; `unicode61
  remove_diacritics 2`) are filled with `normalizeForSearch()` output; queries are normalized the same way and every
  term becomes a prefix query (`"term"*`). FTS5 only picks candidate segments; exact match ranges, grouping by section
  and glossary hits reuse the shared `searchBook()` from `packages/core` on that subset, so web and API agree.
- **Consequences:** local edits that live only in the browser are not searchable until Phase 3 moves edits to the API.

## ADR-015 — DB-backed job queue with leases (2026-09-29)
- **Context:** ingestion (and later translation batches) must survive restarts without Redis.
- **Decision:** `jobs` rows with `status`, `lease_until` and `attempts`; one in-process runner claims the next queued
  job — or a running job whose lease expired because its process died — in one `UPDATE … RETURNING`, renews the lease
  on every progress report, and retries failures up to a maximum number of attempts. Progress goes to an in-memory
  event bus → SSE (`/books/:id/events`, 15 s heartbeat). `WORKER_MODE=separate` is reserved for a standalone worker.
- **Consequences:** single-process deployments need nothing else; Postgres (Phase 6) can use `FOR UPDATE SKIP LOCKED`.

## ADR-016 — better-sqlite3 + Drizzle (2026-09-29)
- **Context:** local-first storage that also works on Windows without build tools.
- **Decision:** `better-sqlite3` (prebuilt binaries for Windows/macOS/Linux) in WAL mode with `busy_timeout`, Drizzle
  ORM for queries, SQL migrations in `apps/api/drizzle/` (FTS5 as a hand-written migration). Data lives in `DATA_DIR`
  (default `./data`, git-ignored), resolved against the repository root.
- **Consequences:** `pnpm db:migrate` / `pnpm db:seed` work from any folder; the API auto-seeds the sample book into an
  empty database (`AUTO_SEED=1`).

## ADR-017 — End-to-end tests run against a real API with a throw-away data folder (2026-09-29)
- **Context:** Phase 2 e2e must cover upload → extraction → structure review → reader.
- **Decision:** Playwright starts the API on port 8797 with `DATA_DIR=./data/e2e` and `E2E_RESET=1` (the folder is
  deleted at startup) and the built web app on 4173 with `/api` proxied to it. The uploaded PDF is the synthetic
  `no-outline.pdf` fixture.
- **Consequences:** tests are hermetic and never touch the developer's own `data/` folder.

## ADR-018 — Agent mode through batch files, leases and a change feed (2026-09-29)
- **Context:** Claude Code is the default translator (no API key); it works on files and a CLI, while the web app
  must show its progress live — whether or not the API is running.
- **Decision:** a job with engine `agent` is materialized as `data/exchange/outbox/<book>/<task>/<batch>.json` plus an
  `agent_batches` row (at most `AGENT_MAX_PENDING` open per book). `agent:next` leases one batch
  (`AGENT_LEASE_MINUTES`, expired leases return to the pool); `agent:submit` validates and imports in one transaction,
  archives both files and creates the follow-up batches in the same step. The CLI writes events to a `notifications`
  table; the running API polls it every second and forwards them over SSE.
- **Consequences:** re-submitting an imported file is a no-op; a crash leaves only leases that expire. Several API
  instances (Phase 6) would need a shared broker instead of the table poll.

## ADR-019 — The pipeline is a per-section job DAG with a human glossary gate (2026-09-29)
- **Context:** SPEC §9.1 asks for progressive availability, chunks in chapter order and a glossary review.
- **Decision:** jobs carry `depends_on` and a document-order `seq`: brief → glossary batches (40 candidates each) →
  gate (the user approves, or `autoApproveGlossary`) → translate chunks (≤ 2,500 words, sequential within a chapter,
  chapters in parallel) → edit units per section (≤ 3,000 words) → a chapter pass that re-applies first-mention
  parentheticals once all its sections are done. Translate/edit jobs are planned only after the gate, so they use the
  approved glossary. Identical source segments reuse translations (translation memory, low `memory` flag).
  «ترجمه‌ی این بخش را الان انجام بده» raises the priority of the chapter's jobs up to that section.
- **Consequences:** the first sections are readable long before the book is done; a restart only re-runs jobs whose
  lease expired.

## ADR-020 — One task spec and one validation for every engine (2026-09-29)
- **Context:** agent, API and mock results must be held to the same standard (SPEC §10.1).
- **Decision:** `packages/ai` task specs pair the zod schemas of Appendix E with domain checks. Blocking rules reject
  a result (missing/extra/duplicate keys, empty text, markup token mismatch, lost numbers, wrong script, repetition
  loops); the other QA findings (glossary, names, untranslated fragments, punctuation, length) become review-queue
  flags. Reports name the key, the rule and the fix. The mock engine writes pseudo-Persian that passes the same checks.
- **Consequences:** switching engines changes quality only through the model, never through validation.

## ADR-021 — Post-processing masks protected spans and uses safe ZWNJ rules only (2026-09-29)
- **Context:** deterministic clean-up must never damage code, URLs, markup tokens or Latin names/titles, and wrong
  ZWNJ insertions are worse than missing ones.
- **Decision:** protected spans are replaced by private-use placeholders before any rule runs (word-like spans and
  attached footnote refs in separate ranges), then restored. Joined «می/نمی» forms are fixed only for a whitelist of
  verb stems (so «میدان»، «میز»، «میان» stay), «تر» is joined only in «… تر از», «ها/های…» and «ترین» after a word.
  Headings and captions keep dotted section/figure numbers; elsewhere «3.5» becomes «۳٫۵».
- **Consequences:** some joined forms («کتابها») are left as written; the editor pass handles them.

## ADR-022 — Manual edits live on the server; automation only suggests (2026-09-29)
- **Context:** SPEC §9.8 requires history and that re-runs never overwrite user edits.
- **Decision:** `PATCH /segments/:id/translation` sets `user_edited` and writes a revision; undo is an edit back to
  the previous text (itself a revision). An engine result for a user-edited segment is stored in
  `translations.suggestion` and shown in the review queue («پذیرفتن پیشنهاد» / «نادیده گرفتن»). Edits made in the
  browser during Phase 1 are sent to the server once and then removed locally.
- **Consequences:** the full history stays auditable; the reader patches its cached bundle instead of refetching.

## ADR-023 — Quality profile «بهترین» in Phase 3 (2026-09-29)
- **Context:** SPEC §9.10 adds a back-translation check for flagged/low-confidence segments, which needs a task type
  that Appendix E does not define yet.
- **Decision:** «بهترین» runs like «متعادل» but sends segments with confidence below 0.85 (instead of 0.7) to the review
  queue; back-translation arrives with the API engines in Phase 4.
- **Consequences:** more human review for that profile until then; the setting is stored per book, so books keep it.

## ADR-024 — Darker warning colour (2026-09-29)
- **Context:** axe reported `--warning` (#b7791f) text below 4.5:1 on light surfaces in the new screens.
- **Decision:** light/sepia `--warning` is #8a5a0f (≈ 5.9:1 on white); dark theme gets #e0a44a (≈ 6.7:1 on the dark
  surface).
- **Consequences:** warning chips and texts pass WCAG AA in every theme.
