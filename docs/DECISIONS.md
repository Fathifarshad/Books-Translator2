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

## ADR-025 — Free providers first, through one OpenAI-compatible client (2026-09-29)
- **Context:** the owner asked for free methods; Claude Code needs a Pro/Max plan. Gemini (free tier), OpenRouter
  (free models) and Ollama (local) all speak the OpenAI chat API.
- **Decision:** one fetch-based client (`packages/ai/src/engine/providers.ts`) with presets per provider; engines
  `gemini`, `ollama`, `openrouter` join `agent` and `mock` per task. The paid `anthropic` / `openai` engines fit the
  same `Engine` interface and are deferred.
- **Consequences:** no SDK dependencies; tests use a fake server; model ids and free limits are settings, not code.

## ADR-026 — API keys encrypted on the server, write-only (2026-09-29)
- **Context:** SPEC §16: keys never reach clients. Users should not need to configure a secret to start.
- **Decision:** AES-256-GCM with a key from `APP_SECRET` (when set to a real value) or a random `data/secret.key`
  created once (mode 600). The API stores the sealed key in `app_settings` and returns only «…last4».
- **Consequences:** a changed `APP_SECRET` makes stored keys unreadable — the settings page asks to enter them again.

## ADR-027 — One-click OpenRouter connection with OAuth PKCE (2026-09-29)
- **Context:** the owner asked for connecting «by clicking a link». OpenRouter supports OAuth PKCE and localhost
  callbacks on any port; Gemini and Ollama have no equivalent (Gemini: link to AI Studio + paste; Ollama: no key).
- **Decision:** `GET /settings/providers/openrouter/connect` creates a verifier + state (memory, single use,
  10 minutes) and redirects to OpenRouter; the callback URL goes through the origin the page used
  (`/api/v1/settings/providers/openrouter/callback/<state>`), the server exchanges the code for a key, stores it,
  picks a free model and redirects back only to the app's own origins.
- **Consequences:** works on `localhost` and `https`; a restart during the flow asks the user to click again.

## ADR-028 — Free-tier limits: wait, never burn attempts (2026-09-29)
- **Context:** free tiers answer 429 often; a daily quota can run out mid-book.
- **Decision:** a limiter per provider (per minute and per day, persisted in `app_settings`), blocked until the
  provider's `retry-after`. Jobs of a provider that must wait are not claimed; rate limits and outages re-queue the
  job without using an attempt; a rejected key or unknown model pauses the provider until its settings change;
  only bad answers (after one repair round) count as failures.
- **Consequences:** a long book continues by itself the next day; the dashboard shows usage, waits and problems.

## ADR-029 — Ollama through its native API (2026-09-29)
- **Context:** the OpenAI-compatible layer of Ollama cannot set the context size; the default is too small for a
  prompt, the style guide and a chunk of text, and small models drift from JSON.
- **Decision:** Ollama calls use `/api/chat` with `num_ctx` 16k and `format` = the task's JSON schema; translate
  chunks are 500 words and edit units 700 words for Ollama; longer timeouts (15 min per request).
- **Consequences:** works out of the box on a stock Ollama install, at the cost of more requests per book.

## ADR-030 — The browser builds the tutor context; the API streams the provider's answer (2026-09-29)
- **Context:** the reader already holds the whole book and the Phase 1 context/citation code; keys must stay on the
  server.
- **Decision:** the browser sends the tutor input (passages, glossary, history, question) to `POST /assist/tutor`,
  validated and size-bounded; the server renders prompts/tutor.md, wraps book text in `<book_context>` (data, not
  instructions) and streams ChatEvents over SSE; citations are resolved in the browser against the labels it sent.
  Summaries and quizzes use `/assist/summary` and `/assist/quiz` with the same validation as agent results.
- **Consequences:** conversations stay in the browser for now (server-side conversations come with multi-user,
  Phase 6); one engine setting drives tutor, summaries and quizzes («موتور مدرس، چکیده و آزمونک»), mock by default.

## ADR-031 — OCR for scanned PDFs with tesseract.js, inside ingestion (2026-09-29)
- **Context:** a real book arrived as a scanned PDF (every page an image, no text layer); SPEC lists OCR for Phase 5.
  The owner asked for it inside the app now.
- **Decision:** during extraction, a page with (almost) no text whose images cover at least half of it is rendered
  with pdf.js onto @napi-rs/canvas at 216 dpi and read by tesseract.js (Apache-2.0, WebAssembly). The language data
  comes from the npm package `@tesseract.js-data/<code>` (English installed; the registry maps book languages to
  Tesseract codes), so nothing is downloaded at run time. Recognized words become ordinary text items, so line
  building, header/footer removal, block and structure detection run unchanged. The engine starts only when the
  first scanned page appears; `OCR=0` turns it off. The ingestion worker now times out after 5 minutes without
  progress instead of 10 minutes in total, since a long scanned book takes much longer.
- **Consequences:** ≈ 1–3 s per page on a normal CPU; recognition errors are possible, so the report shows how many
  pages were read with OCR. Bold/italic are not recognized (headings are found by size and the printed contents).
  Pages already carrying an OCR text layer (e.g. from PDF24) are read as text, without OCR.

## ADR-032 — Phones: an offline single-file reader and online access through a tunnel (2026-09-30)
- **Context:** the owner wants their son (a student, Android) to use translated books on his phone; translation keeps
  running on the owner's computer. SPEC places mobile apps (Capacitor, hosted API) in Phase 6.
- **Decision:** two ways now. (1) `GET /books/:id/export/offline`: one self-contained HTML file — book data as
  escaped HTML fragments, a dependency-free reader (contents, target/bilingual/source, search, glossary, font size,
  dark mode, position memory), Vazirmatn embedded, strict CSP, no network. (2) `pnpm share`: builds the web app,
  the API serves it (`SERVE_WEB=1`, one port), and a free Cloudflare quick tunnel gives an https link; the web app
  is installable (manifest + icons).
- **Consequences:** no app store and no hosting cost; the offline copy has no tutor; the online link lives while
  the owner's computer runs `pnpm share` and changes on every start. Capacitor builds stay in Phase 6.
- **Amendment (first run on Windows):** `pnpm share` prints English — Windows consoles show right-to-left text
  reversed. It opens `http://localhost:8787` itself (the owner kept using the dev port 5173), lists only real network
  cards, starts `cloudflared` without a shell (under `cmd.exe` a missing program failed silently) and also finds it
  in the installer's folders, since a PowerShell opened before `winget install` does not see the new PATH.

## ADR-033 — Remote readers: access password, read-only role, same-origin writes (2026-09-30)
- **Context:** exposing the local app through a tunnel must not expose the library, the keys or the settings.
- **Decision:** requests from this computer (loopback address, localhost Host, no proxy headers) are the owner.
  Everything else needs the access password (scrypt hash, set only by the owner); a login gives a 30-day HttpOnly
  SameSite=Lax cookie (HMAC token, re-keyed when the password changes; 10 failures per address per 10 minutes).
  Remote sessions are **readers**: GET routes, `/assist/*` and sign-out only; settings, uploads, edits and
  deletions answer `READ_ONLY`. Without a password remote access is off (`REMOTE_DISABLED`). State-changing
  requests with a foreign `Origin` are refused (`BAD_ORIGIN`), which also closes CSRF against the local app.
- **Consequences:** the son can read and ask the tutor (on the owner's AI quota) but cannot change anything; the
  UI hides owner actions for readers and shows a sign-in screen on other devices.


## ADR-034 — Open-source release for non-developers: one-click start, CI, free engines only (2026-09-30)
- **Context:** the owner wants friends to download and run the app without developer help, at no cost.
- **Decision:** `start.cmd` (Windows) and `start.sh` (macOS/Linux) are thin wrappers around `scripts/start.mjs`, which
  checks Node ≥ 22.22, enables pnpm (corepack, falling back to `npm install -g pnpm@10.33.0`), installs when
  `node_modules` is missing or older than the lockfile, then runs `scripts/share.mjs --local`: the built app served by
  the API on port 8787 bound to 127.0.0.1 (no tunnel, no remote access). Friends download the ZIP or a GitHub release;
  data stays in each person's `data/`. CI runs lint, typecheck and unit tests on Windows and Linux (e2e stays local:
  browsers and fake servers make it slow on free runners). The paid `anthropic`/`openai` engines stay unbuilt (the
  owner asked for free options only); Claude quality is available at no extra cost through agent mode with Claude Code.
- **Consequences:** each start rebuilds the web app (~30 s); `pnpm share` remains the way to reach phones. Adding the
  paid engine later is a new provider in `packages/ai` behind the existing engine interface.

## ADR-035 — OCR for pages whose text is drawn as vector outlines; figure noise filter (2026-09-30)
- **Context:** the owner's 329-page book is not a scan: its text was "printed" as ~4,000 filled glyph paths per page,
  with no text layer and no images, so the image-coverage test never triggered OCR (12 words extracted). OCR of such
  pages also read figure labels and photos as garbage lines (confidence < 45) that could become fake headings.
- **Decision:** a text-less page with ≥ 300 path operations (`OUTLINED_TEXT_MIN_PATHS`) is OCR'd like a scan. On a
  clean page (median word confidence ≥ 80) words below 45 are dropped as figure noise; poor scans keep every word.
- **Consequences:** ~9.5 s per page (329 pages ≈ 50 min). Text-less pages with large vector charts are OCR'd too
  (cheap, and mostly yield nothing).
- **Addendum:** PDFs OCR'd by other tools (PDF24, ocrmypdf) carry an invisible Tesseract text layer in
  `GlyphLessFont`, which pdf.js reports as monospace; it is now plain body text (it had turned 230,000 words into
  untranslated "code" blocks).

## ADR-036 — Weak/limited free engines: keep item-level QA issues; cheap paid OpenRouter models (2026-10-04)
- **Context:** on the owner's real book the free engines stalled: Gemini answers 403 from the owner's network
  (region block), OpenRouter free models allow ~50 requests a day, Ollama Cloud's free quota ran out after 23% and the
  local `qwen3:14b` fails validation (Latin left in place, dropped numbers). One bad item rejected a whole 36-item chunk,
  which was then retried from scratch.
- **Decision:** (1) after the provider's repair round, an answer whose remaining errors are only `numbers`,
  `target_script` or `markup` is kept (SPEC §9.7: reject → repair → flag); post-processing QA flags those items for the
  review queue. Missing keys, empty translations and schema errors stay fatal; agent results stay strict. (2) The
  OpenRouter model list can include paid models (opt-in, cheapest first, price per million tokens shown); a paid model
  gets pay-as-you-go limits instead of the free daily cap.
- **Consequences:** no wasted chunks; the review queue shows the items to check. A few dollars of OpenRouter credit
  (cards or crypto) finish a 300-page book with a cheap model; the free path is unchanged.

## ADR-037 — Engine labels name the model and what it costs (2026-10-04)
- **Context:** «تنظیمات ترجمه» labelled every engine from a fixed i18n string («OpenRouter (رایگان)»), so after
  choosing a paid OpenRouter model (ADR-036) the page still promised «رایگان» and never said which model would run.
  The rule «is this model paid?» (`:free` suffix) was duplicated in the runner limits, the settings toggle and nowhere
  in the wizard.
- **Decision:** `modelCost(provider, model)` in `packages/shared` is the single source of truth and returns
  `free | paid | local`. The wizard builds its label at render time — «OpenRouter · ⁨vendor/model⁩ (پولی)» — with the
  model id isolated in FSI … PDI, because an `<option>` cannot hold a `<bdi>` (golden rule 1). The same tag follows
  the model in Settings and on the pipeline dashboard (`UsageLine`); the free-tier limits (ADR-036) and the «show paid
  models» toggle call the same function.
- **Consequences:** engine names in `fa.json` no longer carry a cost word (the dashboard's engine line shows the bare
  name). Gemini counts as free because its free tier depends on the key's billing tier, not on the model, so a paid
  Gemini key is still labelled «رایگان». Long model ids shrink the select (`min-w-0`) instead of widening the row, and
  the `:free` suffix is not repeated in the label.

## ADR-038 — Claude Code as an automatic engine; chunks that really run in parallel (2026-10-04)
- **Context:** on the owner's real book (a 45-page Miller's Anesthesia chapter, 2,231 segments) translation sat at
  1% for days. Four separate causes, all of them blocking:
  1. **Every translate chunk waited for the previous chunk of its chapter.** The book is *one* chapter, so exactly
     one chunk was ever runnable: the dashboard showed «۲ بسته در انتظار» forever, and no engine — agent or
     provider — could do more than one piece at a time.
  2. **Agent mode is manual.** Claude Code only works through `/process-batches`, typed by hand, one batch per
     round trip. Fifty chunks is fifty invocations.
  3. **Chunks were cut by words only.** In a two-column OCR'd book a "paragraph" is one broken line, so 2,500
     words became 231 items — one model answer had to carry 231 exact keys, and a single missing key threw the
     whole chunk away.
  4. **No engine the owner can reach works.** Gemini answers 403 from their network, OpenRouter's free models give
     ~50 requests a day and empty answers, Ollama Cloud's quota ran out, local `qwen3:14b` fails validation.
- **Decision:**
  1. A new engine **`claude_code`**: the server runs the `claude` program that is already installed on the owner's
     computer, headless (`claude -p --output-format json`), with the project's own prompts as the system prompt and
     no tools, MCP servers, project settings or session files. No API key — it is paid for by the Claude
     subscription the owner already has — and the answer goes through exactly the same validation and repair round
     as any provider. `--effort low`: translating a chunk is a direct task, and on a real batch low effort was
     2.4× faster, used 2.9× fewer tokens and read better than the default. The client needs Node, so it lives
     behind the `@dozabaneh/ai/claude-cli` subpath and `packages/ai` stays browser-safe.
  2. Translate chunks no longer depend on each other. Document order survives through `seq`, the per-chapter
     first-mention pass (`finalizeChapter`) still fixes the parentheticals, and the edit unit still waits for the
     chunks of its own section. Migration `0004_parallel_chunks.sql` unchains the books already in the queue.
  3. `WORKER_CONCURRENCY` (default 3): the runner keeps three jobs busy instead of one.
  4. `CHUNK_MAX_ITEMS = 60` caps keys per chunk next to the word budget.
  5. Starting again with another engine moves the work that is still queued (`retargetJobs`) and withdraws the open
     Claude Code batches, instead of forcing a cancel-and-restart of the whole book.
  6. «ساختن دوباره‌ی واژه‌نامه» (`POST /books/:id/glossary/rebuild`): the owner's glossary had been written by a
     weak local model — `pregnancy → بازگشت`, `labor → تولید`, `cardiac output → خرج قلبی` — and the prompts tell
     every engine to use those equivalents, so each new chunk repeated the mistakes. The action drops the
     machine-made terms, keeps the ones the user locked, leaves finished translations alone and plans the stage
     again with the engine chosen now. Without it the only way out was deleting the book and OCR'ing it again.
- **Consequences:** a book translates without a key, without a daily quota and without anyone typing a command;
  `claude_code` is first in `PROVIDER_IDS`, so a new book defaults to it. It spends the owner's Claude plan, which
  the settings card says plainly; when the plan's limit is reached the engine waits and resumes (QUOTA with the
  reset time) instead of failing. Chunks that run side by side see fewer already-translated neighbours as context,
  which the chapter pass and the edit stage absorb. Measured on a real batch: 60 items (≈600 words) in ~2.5
  minutes, 60/60 keys correct — about an hour for the owner's chapter at concurrency 3.

### ADR-038 — addendum: why it was still not moving (2026-10-05)
The engine ran, but every call hit the 600 s timeout. Three further causes, found on the owner's own machine:
- **`CLAUDE_EFFORT` is a name Claude Code already uses.** A session exports it into the terminals it opens, so an
  app started with `pnpm dev` in the VS Code terminal silently inherited `xhigh` and translated the book at the
  session's effort level. The setting is now `TRANSLATE_EFFORT`, and the child no longer inherits `CLAUDECODE`,
  `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_ENTRYPOINT` or `CLAUDE_EFFORT` (`childEnv`).
- **Thinking, not translating.** `--effort low` alone was not enough: a 60-item chunk spent 48,400 output tokens
  and 518 s on thinking for 600 words of text. At the default effort the engine now also sets
  `MAX_THINKING_TOKENS=0`; the same chunk takes 80 s and 7,368 tokens and passes the same validation.
  `TRANSLATE_EFFORT=medium` or higher gives thinking back.
- **One shredded fragment killed a whole chunk.** In this two-column scan a "paragraph" is often a broken line
  («pressure» on its own), and the translator answers nothing for it. `empty` is fatal (ADR-036), so 59 good
  translations were thrown away over one fragment, every time, forever. Up to 10% of a chunk's items may now keep
  their source text instead (`rescueEmptyItems`); QA flags them (`target_script`) and the review queue shows them.
  An engine that answers nothing for most of a chunk still fails.
- A job of a **paused** pipeline is no longer claimed, not even one left `running` by a process that died —
  which used to come back to life (and be re-queued) behind the user's «توقف موقت».
Measured afterwards on a real batch of the owner's book: 60 items in 80 s, 60/60 keys, accepted with one item
flagged — about 35 minutes for the whole chapter at three jobs at a time.

## ADR-039 — Two columns read as two columns: the geometry that made a chapter unreadable (2026-10-05)
- **Context:** the owner's chapter came out of extraction as 2,231 tiny segments whose text wove the two columns
  into each other — «more recent human trials demonstrate the use The placenta is a remarkable organ», «over the
  time of gestation. At term, the plasma volume is By the end of the first trimester, maternal cardiac output».
  No engine can translate that and no reader can read it. The PDF carries a text layer written by an OCR tool
  (PDF24, `GlyphLessFont`), so our own OCR never ran: the geometry in that layer is what everything downstream
  believed.
- **Decision** — four changes, each one a separate reason the columns were lost:
  1. **An item's width is capped at what its characters can cover** (`plausibleWidth`, 1.1 em per character, used
     for the text layer and for OCR words). That layer reported 1,639 points for «Tidal volume» on a 612-point
     page.
  2. **A page's text extent comes from percentiles, clamped to the paper** (`orderPage`). One line claiming to end
     at 1,966 used to put the middle of the page at 1,012, where there is no gutter — so the second column was
     never found and the page was read line by line across both.
  3. **Only a line that really runs across the page interrupts the columns.** A short line near the middle (a wide
     table cell, a figure label) used to end the column region, and everything below it was read side to side.
     Such a line now joins the column it sits in.
  4. **The gutter threshold is 1.6 em, not 1.8** (`splitAtGutters`). This book's gutter is exactly 1.8 em, so the
     old test (`gap > 1.8 em`) was false by a hair and the two columns became one line — which no later step can
     take apart. Justified Latin text stretches its spaces to about 1.2 em, so 1.6 em still only ever means a
     gutter.
  5. A block of fewer than five words is a label or a sub-heading, not a sentence the column ran out of room for,
     so it is no longer merged with whatever follows the break («Cardiac Output» had been glued to the table
     beside it and then to the pages after it).
- **Consequences** (measured on the owner's chapter): 2,231 → 1,384 segments, 1,234 → 487 paragraphs, 24 → 55
  words per paragraph, and paragraphs that read as prose. Books already in the library keep the text they were
  ingested with — the fix applies when a book is uploaded again. The synthetic fixtures could not be regenerated
  on Windows (pdf.js draws pdfkit's standard-14 fonts as empty boxes here, so a re-rendered "scan" would be
  unreadable), so the new tests pin the geometry directly instead of through a new fixture.

## ADR-040 — «گرفتن خروجی»: Markdown, Word, and a PDF the browser writes (2026-10-29)
- **Context:** a finished translation could only leave the app as the offline HTML reader, which is made for
  reading on a phone, not for sending to someone, editing, printing or quoting.
- **Decision:** one model (`apps/api/src/export/document.ts`) renders every format, so they cannot drift apart:
  `markdown.ts` (the book's inline markup already *is* Markdown), `word.ts` (`docx`, MIT; direction is a property
  of each paragraph and run, taken from the language registry, so an English quotation inside a Persian book
  keeps its own direction) and `print.ts` (a printable page that opens the browser's print dialog). Each takes
  `mode=target|bilingual|source`. «رونوشت» fetches the same Markdown as `text/plain` and puts it on the clipboard.
- **Why the browser writes the PDF:** no PDF writer in Node shapes Arabic script — pdfkit would hand back
  disconnected letters — and a headless browser would add a 150 MB dependency to an app friends install
  themselves. The browser on this computer already shapes Persian correctly, embeds the fonts we send it, and its
  «Save as PDF» is one dialog away. Word can do the same from the .docx.
- **Consequences:** exports need no new service and no key. The printable page carries Vazirmatn as data URLs
  (≈110 KB) like the offline reader. A book that is only half translated exports what it has: in `target` mode an
  untranslated row falls back to its source text, which is visible rather than silently missing.

## ADR-041 — Reading a book aloud: four sources, because Claude has no voice (2026-10-29)
- **Context:** the owner wants the translation as audio — the whole book and, separately, a shorter telling of it —
  to listen to and to put on a phone. No Claude model produces speech, so the sound has to come from somewhere
  else, and that choice is the owner's: it decides what it costs, how natural it sounds, and whether a file comes
  out at all.
- **Decision:** one setting, four sources (`packages/shared/src/tts.ts`, `apps/api/src/tts/`):
  - `browser` — the voice Windows or the phone already has. Free, nothing to install, and it reads the section on
    screen («بخوان» in the reader, `ReadAloud.tsx`, text taken from the target column as rendered). It **speaks**;
    it does not write a file, so the app says so plainly instead of offering a download that cannot work.
  - `piper` — a small program on this computer with a Persian voice: free, offline, no limit, writes WAV (MP3 when
    ffmpeg is installed).
  - `azure` / `google` / `openai` — natural voices over the internet; a key per service, kept encrypted on the
    server like every translation key (golden rule 7), paid per character.
- **One file per chapter.** A 300-page book as one recording is unusable: a phone's player shows chapters as a
  playlist and remembers where it stopped. Recording takes minutes, so it is a job in the same queue as
  everything else (`stage: 'audio'`), with the progress the page follows.
- **Two kinds.** `full` reads the translation; `summary` reads a chapter summary the assistant engine writes
  first, through the same `/assist` path the reader's summaries use (extracted to `assist/task.ts`, so there is
  one way to ask for a summary).
- **Consequences:** each service's own limit on request size is handled by splitting at sentence ends and joining
  the pieces (MP3 end to end, WAV with one header over the sum). Nothing here was verified against a real Azure,
  Google or OpenAI account or a real Piper install — the services are tested with an injected `fetch` and Piper
  with a stand-in program, exactly as the translation providers are. The first real connection is the owner's.

## ADR-042 — Text written to be read, said out loud (2026-10-29)
- **Context:** the first recordings sounded mechanical and sometimes said the wrong word. That is not the voice's
  fault: a translation is written to be *read*. A speech engine says «۲۰٪» as two digits and a symbol, shouts the
  English term out of the middle of «بی‌هوشی (Anesthesia)», reads footnote markers aloud, and — because Persian is
  written without short vowels — has to guess which of several words «مرد» or «کرم» is in that sentence.
- **Decision:** two passes, split by whether a rule can settle the question.
  1. **By rule** (`packages/text/src/speech.ts`, browser-safe, no model): markup and footnote markers removed; a
     parenthesis whose content is in the other script dropped; numbers, decimals, ranges and percentages written
     as words; short units said in full. The words come from the language registry (`speech: 'fa' | 'en'`), the
     same way `normalizer` and `ocr` do — a language the registry has no spoken forms for keeps its digits rather
     than borrowing another language's words.
  2. **By judgement** (`prompts/speech.md`, a new `speech` task): the assistant engine marks the vowels **only**
     on words whose reading is genuinely in doubt, expands what is still short, and breaks a very long sentence
     at punctuation it already has. It is told not to change what is said — no shortening, no improving: the
     listener must hear the same book the reader reads. A pass that fails leaves the prepared text as it is.
- **The speech task's checks are deliberately not the translation's.** Digits become words and the bracketed term
  disappears, so «same numbers», «same markup» and «same length» would all fire on a correct answer. What is
  checked is that every line comes back, in the target language, and not empty.
- **SSML where it is taken.** Azure and Google get a pause between lines and `<lang>` around a run still written
  in the source language, so the voice switches instead of spelling it out; Piper and OpenAI get plain text.
- **Consequences:** the polish pass costs a model call per 40 lines and is a switch in Settings («ویرایش متن برای
  خوانش»), on by default and skipped when no assistant engine is connected. Full vowelling was deliberately not
  asked for: a fully voweled text reads worse, not better.

## ADR-043 — What a book will cost, before «شروع ترجمه», and a ceiling (2026-10-29)

- **Context:** the owner asked to know what a translation costs before it starts, and to choose the source that pays
  for it. Tokens were already recorded per job (`jobs.tokens_in/out`); `cost_usd` existed and was never written.
- **Two different counts.** *Tokens*, which every engine spends, and *dollars*, which only a pay-as-you-go model
  spends. Claude Code (a subscription), Ollama (this computer) and a free tier cost no money and still have a limit,
  so the estimate always shows tokens and shows dollars only where they are charged — «هزینه‌ی دلاری ندارد»
  instead of a misleading «$0».
- **Rates from the owner's own jobs** (`apps/api/src/pipeline/cost.ts`): a stage with at least 3 finished calls is
  projected from its own tokens per segment (translate, edit) or per call (brief, glossary); until then from
  defaults measured on one real 60-item chunk (`packages/shared/src/cost.ts`). The page says which.
- **Prices** are the ones the provider lists for the chosen model, kept in the provider settings when the model
  list is fetched, so an estimate needs no network. Each finished call of a paid model adds its dollars to
  `jobs.cost_usd`.
- **The ceiling** (Settings → «سقف هزینه», daily and/or monthly, empty = none) adds the paid engines to the runner's
  blocked list while it is reached; their jobs wait, nothing fails, and work resumes at midnight or on the 1st.
  It never stops an engine that spends no money.
- **Consequences:** the estimate is a projection, not a quote — the first chunks of a new book or a new model
  correct it. Only OpenRouter's paid models are «paid» today (`modelCost`); a direct Anthropic API engine would add
  itself there.

### ADR-041 addendum — Piper writes a file, not stdout (2026-10-29)

Piper 1.x (`pip install piper-tts`, OHF-Voice/piper1-gpl) cannot write a WAV to stdout on Windows: it reopens a
temporary file Windows keeps locked (`PermissionError`), and with no output file it plays the sound instead. Each
piece is now written to a file in a fresh temp folder and read back; the stand-in refuses `-` like the real program.
Verified against piper-tts 1.8.0 with `fa_IR-gyro-medium`.

### ADR-041 addendum — «بخوان» uses the chosen voice, not only the browser's (2026-10-29)

Windows often has no Persian voice, so «بخوان» in the reader said «مرورگر شما صدای فارسی ندارد» even with Piper
working in Settings. When a source that writes sound is chosen and ready, the reader now sends the section to
`POST /tts/speak` in pieces of ~700 characters (whole paragraphs), plays them in turn and fetches the next piece
while one plays; the browser voice is the fallback. Only the rules prepare this text — the model pass would make the
reader wait. Measured with Piper `fa_IR-gyro-medium`: ~3 s per piece.

### ADR-041 addendum — Piper reads UTF-8 (2026-10-30)

Python on Windows decodes stdin in the ANSI code page, so the Persian text reached Piper garbled: a sentence with
«ژ» crashed it (`UnicodeEncodeError … surrogates not allowed`), and the rest was read as noise — a four-word test
sentence came back as 10 s of sound instead of 2 s. Every program the speech code starts now runs with
`PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8`; the stand-in refuses to run without them, as the real one fails.

### ADR-044 — Recording formats, progress and pause; «بخوان» that continues (2026-10-30)

- **Formats.** A recording can be saved as MP3, WAV, OGG (Opus) or M4A (AAC). The source's own format needs no
  conversion (Piper: WAV; services: MP3); the others go through ffmpeg (temp files, since M4A cannot be piped), and
  `TtsView.formats` lists only what works now. Omitting `format` keeps the old behaviour — no conversion — so
  nothing changes for callers that do not choose. (Before this, the settings page promised MP3 with ffmpeg but
  nothing converted.)
- **Progress.** A chapter's script is spoken in ~2,500-character segments, so progress moves inside a long chapter:
  `AudioStatus.fraction` (0–1, weighted by chapter length) next to `done/total` chapters.
- **Pause.** `POST /books/:id/audio/control` `{action: pause|resume}`; an in-process set (`tts/control.ts`) checked
  between segments, the job keeps its lease with heartbeats while paused. Lost on a server restart, like the job.
- **«بخوان».** Pause keeps the piece; «ادامه» goes on from it, «از اول» starts over, speed 0.75–2× (audio
  `playbackRate`; the browser voice restarts the current ~300-character piece). The browser voice is paused by
  cancelling, because `speechSynthesis.pause` is unreliable.
- **Tutor.** Errors keep the engine's own message (`errorDetail`) and map HTTP 409/429, so «خطای ناشناخته» can be
  diagnosed from the panel.
- **Shortcut.** `create-shortcut.cmd` / `pnpm shortcut` writes «دوزبانه.lnk» to the desktop (start.cmd, app icon).
  WScript.Shell cannot save a Persian file name, so it saves under a plain name and moves it.

### ADR-044 addendum — a less mechanical Piper (2026-10-30)

Owner's verdict on `fa_IR-gyro-medium`: about 60% natural, words sometimes badly joined. Measured with `piper --debug`:
a zero-width joiner makes the phonemizer see «کتاب‌ها» as two words and stress the first syllable (`kˈetɑbhɑ`);
written joined it keeps the natural stress (`ketˈɑbhɑ`). So the joiner is removed for Piper only. Piper also runs a
little slower (`--length_scale 1.08`) with 0.4 s after each sentence (`--sentence_silence`), both adjustable in
Settings. The voice test now reads a realistic textbook paragraph (plurals, a number with a unit, a foreign term, a
question). The remaining ceiling is the voice model itself; Azure fa-IR (Dilara/Farid) is the step up.
