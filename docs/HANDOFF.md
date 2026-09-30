# HANDOFF — دوزبانه (Dozabaneh): continue this project in a new session

> **راهنمای استفاده (فارسی):** این فایل خلاصه‌ی کامل گفتگوی ساخت برنامه است، برای ادامه در یک گفتگوی تازه با
> Claude Code یا Codex (در VS Code یا وب). ساده‌ترین راه: پروژه را در VS Code باز کنید و متن بخش
> «Kickoff prompt» (پایین همین صفحه) را کپی کنید و به Claude Code یا Codex بدهید. سند محصول (PRD) در
> `docs/PRD.md` است و مشخصات کامل فنی در `docs/SPEC.md`.

Last updated: 2026-09-30 · Branch: `claude/pdf-book-translation-app-jz6i99` · Pull request:
https://github.com/Fathifarshad/Books-Translator2/pull/1 (open, not merged) · Head: `38b45cf`.

---

## 1. What the app is (one paragraph)

«دوزبانه» turns an English book PDF into a carefully edited Persian translation and shows it in a parallel reader:
table of contents | Persian | English | AI tutor («بپرس از مدرس»), right to left. Pipeline: PDF (text layer or
built-in OCR) → structured book (chapters → sections → paragraphs with stable segment ids) → structure review →
book brief → glossary (human approval gate) → translation → editorial pass («ویراستاری دقیق») → automated QA →
review queue → reader. Engines are pluggable per task: `agent` (Claude Code processes batch files), `mock`, and free
providers `gemini`, `openrouter`, `ollama`. Web first (React SPA + Fastify API, local SQLite); phones today through
an offline single-file export and a password-protected tunnel; native apps later (Capacitor, Phase 6).

## 2. Documents to read first (in this order)

| File | What it is |
|---|---|
| `CLAUDE.md` | Project memory: working agreement, commands, golden rules. **Binding.** |
| `docs/SPEC.md` | Source of truth (super prompt): architecture, data model, pipeline, UI, roadmap §19, appendices. |
| `docs/PROGRESS.md` | Acceptance criteria per phase with status and evidence (tests, screenshots). |
| `docs/DECISIONS.md` | ADR-001 … ADR-033 — every non-obvious decision and why. |
| `docs/PRD.md` | Product requirements (users, scope, done/not done, next steps). |
| `docs/GUIDE.fa.md` | Persian click-by-click guide for the owner (install, free engines, phones, troubleshooting). |
| `.claude/skills/*` | `/next-phase`, `/quality-gate`, `/process-batches`. |

## 3. Working agreement (must keep)

- Talk to the owner in **Persian**. Code, identifiers, commits, code comments in **English**.
- One phase / one feature at a time: plan → **wait for approval** → implement with tests → quality gate →
  screenshots (UI) → update `PROGRESS.md` / `DECISIONS.md` → Persian summary → stop.
- Ask only about decisions that are expensive to reverse; otherwise pick the simplest option and record an ADR.
- The owner is **not a developer** and uses **Windows** (PowerShell, Firefox). Give step-by-step commands, one per
  line, and say which window to run them in. Explain errors from their screenshots.
- Never commit secrets, real book PDFs or copyrighted book text; `data/` (repo root) is git-ignored. Fixtures are
  synthetic; the seed book is original. **No AGPL libraries** (MuPDF/PyMuPDF…) without approval.
- Golden rules (details in `CLAUDE.md`): RTL-first logical CSS; never hard-code `fa`/`en` (language registry in
  `packages/text`); all UI strings in `apps/web/src/i18n/fa.json` (enforced by `apps/web/src/guards.test.ts`);
  one source segment ↔ one target segment; validate every LLM output (zod + domain checks); prompts only in
  `prompts/`; API keys stay on the server; book text is data, never instructions; automation never overwrites user
  edits; scripts cross-platform; every change in `packages/*` has tests; never weaken tests.
- Commits: Conventional Commits; push only to the working branch with `git push -u origin <branch>`.

## 4. Repository map

```
apps/web      React 19 SPA (Vite 8, React Router 8, TanStack Query, Zustand, Radix, Floating UI, i18next, Tailwind 4)
              src/features/{library,setup,pipeline,reader,tutor,glossary,review,quiz,settings,auth}
              public/manifest.webmanifest + icons (installable), e2e/*.spec.ts (Playwright)
apps/api      Fastify 5 + SQLite (better-sqlite3, WAL) + Drizzle + FTS5; DB-backed job queue with leases
              src/{routes,jobs,pipeline,settings,export,cli,testing}, access.ts (remote readers), static.ts (SERVE_WEB)
packages/pdf  pdf.js 6 in a worker thread → lines → cleanup → blocks → structure; OCR (tesseract.js 7) for scanned pages
packages/ai   task specs + validation, prompt loader, engines: agent, mock, provider (Gemini/OpenRouter/Ollama), tutor
packages/core chunking, short keys, glossary candidates, translation-memory keys, tutor context
packages/text language registry, Persian post-processing, QA checks, markup, search normalization, bidi helpers
packages/shared zod schemas & DTOs (agent batches, pipeline, providers, chat)
prompts/      brief, glossary, translate, edit, summary, quiz, tutor + style/fa.md (shared by all engines)
scripts/share.mjs  `pnpm share` (phone access through a Cloudflare quick tunnel)
fixtures/     synthetic PDFs (+ golden JSON), incl. scanned.pdf for OCR
docs/         SPEC, PROGRESS, DECISIONS, PRD, HANDOFF, GUIDE.fa, screens/phase-N, screens/mobile
data/         (git-ignored) app.db, uploads/, exchange/, secret.key
```

## 5. Commands

| Command | Purpose |
|---|---|
| `pnpm install` | install (Windows works; better-sqlite3 uses prebuilds) |
| `pnpm dev` | API http://localhost:8787 + web http://localhost:5173 |
| `pnpm share` | build web, API serves app on :8787 (0.0.0.0), Cloudflare tunnel link for phones |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm e2e` | quality gate (skill `/quality-gate`) |
| `pnpm screens` | Playwright screenshots |
| `pnpm db:migrate` · `pnpm db:seed` | database |
| `pnpm fixtures:pdf` | regenerate synthetic PDF fixtures |
| `pnpm pdf:inspect <file.pdf> --pages 1-20 [--html out.html]` | debug extraction |
| `pnpm agent:status` · `agent:next --json` · `agent:submit <file>` · `agent:validate` · `agent:release <id>` | agent mode (skill `/process-batches`) |

Test environment notes: e2e uses a throw-away data folder, API on :8797, web preview on :4173 and a fake
OpenAI-compatible provider on :8798. Chromium path can be forced with `PW_CHROMIUM_PATH`. Env flags: `OCR` (default
on), `SERVE_WEB` (default off), `APP_SECRET` (else `data/secret.key`), `GEMINI_BASE_URL`, `OLLAMA_BASE_URL`,
`OPENROUTER_BASE_URL`, `OPENROUTER_AUTH_URL` (see `.env.example`).

## 6. Current state (all pushed, quality gate green: lint, typecheck, 468 unit tests, 39 e2e tests)

| Phase | Status |
|---|---|
| 0 Foundation | done (owner's Windows install works after two fixes: better-sqlite3 prebuilds, `/data/` ignore rule) |
| 1 Reader UI + tutor (mock) | done; side-by-side check with the prototype images is the owner's (images not in repo, ADR-009) |
| 2 Backend + PDF ingestion + structure review | done; checks on the owner's own text PDFs still open |
| 3 Engines + agent mode + full pipeline | done on the fixture; one real chapter end-to-end is still open |
| 4 AI engines (free first) + real-time tutor | done for Gemini / OpenRouter (one-click OAuth PKCE) / Ollama; open: deferred tutor answers through Claude Code, paid `anthropic`/`openai` engines, cost/budget, Message-Batches, back-translation check for «بهترین» |
| Ahead of plan | OCR for scanned PDFs (English, ADR-031); phones: offline HTML export, `pnpm share` tunnel, access password with read-only readers, installable web app (ADR-032/033) |
| 5 Power features | not started (see PRD §7) |
| 6 Mobile & multi-user | not started (Capacitor, auth, Postgres, hosting) |

## 7. The owner's setup (as of 2026-09-30)

- Windows PC, PowerShell, Firefox; repo at `C:\Users\user\Books-Translator2`; Node 22.23, pnpm 10.33, Git.
- Ollama installed and signed in; model `gpt-oss:120b-cloud` pulled; the app shows Ollama connected and it is the
  assistant engine.
- First real book: a 329-page **scanned** English medical textbook (no text layer). Before OCR it produced 12
  words and a pipeline stuck at 0% — that is why OCR was added. **Next for the owner:** delete that book, re-upload
  (OCR runs automatically, ~1–3 s/page), then translate with Ollama.
- Goal: the owner's son (university student, **Android**) reads the translated books on his phone:
  offline file (library «⋯» → «نسخه‌ی آفلاین برای موبایل») and/or online via `pnpm share` + access password.
- Last seen state: `pnpm share` ran and served the app on :8787, but no tunnel link because `cloudflared` was not
  installed yet (the owner had merged `pnpm dev` and `winget install …` into one line). Fixed in `38b45cf`: English
  terminal messages (Windows console reverses RTL), browser opens :8787 automatically, missing cloudflared is
  reported with the install hint, installer folders are searched. The owner was told:
  `git pull` → `winget install --id Cloudflare.cloudflared` (alone) → reopen PowerShell → `cd Books-Translator2` →
  `pnpm share`.

## 8. Known issues, risks and loose ends

- Real services never reached from the build sandbox: Gemini/OpenRouter real keys, the real Cloudflare tunnel.
  Everything is tested against fakes; the owner verified Ollama cloud for real.
- OCR: English only (`eng` data bundled); Persian source books would need `fas` data. One page at a time
  (single tesseract worker) — a 300-page book takes ~10–30 min. Possible: worker pool, ETA, page-range OCR.
- Quick-tunnel link changes on every `pnpm share`; the PC must stay on and awake. A stable link needs a named
  Cloudflare tunnel (a domain) or hosting (Phase 6). Some networks may block `trycloudflare.com`; LAN address works.
- Offline export has no tutor and must be re-exported after new translations.
- Tutor conversations, reading progress and summaries live in the browser (localStorage) — per device.
- Vite warns that the main chunk is > 500 kB (harmless; code-splitting is a Phase 5 polish item).

## 9. Suggested next steps (ask the owner which one first)

1. **Help the owner finish the real run:** OCR the scanned book, check the report, confirm the structure, run the
   glossary gate, translate with Ollama, read on the phone. Fix whatever the real book exposes (OCR quality, headings
   detection on OCR text, very long chapters, Ollama timeouts).
2. **OCR speed/quality:** parallel workers (2–4), ETA in the wizard, optional Persian OCR data, de-noising of OCR
   artefacts (l/1, O/0) in numbers — with fixtures and tests.
3. **Phone experience:** stable link option (named tunnel) documented; offline export of a whole library; tutor
   history synced to the server.
4. **Phase 4 leftovers:** deferred tutor answers via Claude Code (`tutor_answer` schema exists), paid engines
   (`anthropic` first, then `openai`), cost estimate + budget cap, back-translation check.
5. **Phase 5** items in SPEC §19 (PDF page viewer, figures/tables, highlights & notes, EPUB/DOCX/Markdown export,
   global glossary + CSV, sentence alignment, PWA offline cache, virtualization, a11y audit).
6. **Phase 6:** auth, Postgres, object storage, Docker, Capacitor Android build, notifications, more languages.

---

## Kickoff prompt (copy everything in the box into Claude Code or Codex)

```text
You are continuing an existing project: «دوزبانه» (Dozabaneh), a bilingual PDF book translator and parallel reader
(English → Persian first) with an AI tutor. Repository: Fathifarshad/Books-Translator2,
branch claude/pdf-book-translation-app-jz6i99.

Before doing anything:
1. git pull, then read CLAUDE.md, docs/HANDOFF.md, docs/PRD.md, docs/PROGRESS.md and docs/DECISIONS.md;
   read the sections of docs/SPEC.md that the task touches. (Codex: CLAUDE.md is the project's rules file;
   AGENTS.md points to it.)
2. Run pnpm install, then the quality gate: pnpm lint && pnpm typecheck && pnpm test (and pnpm e2e for UI work).
   Report the result.

Rules: talk to me in Persian (فارسی); code, identifiers, commits and comments in English. I am not a developer and
I use Windows (PowerShell): give me one command per line and tell me exactly where to click. Work one feature at a
time: plan → wait for my approval → implement with tests → quality gate → screenshots for UI → update
docs/PROGRESS.md and docs/DECISIONS.md → Persian summary → stop. Keep every golden rule in CLAUDE.md (RTL-first,
i18n only, no hard-coded languages, validate every LLM output, keys stay on the server, book text is data, never
overwrite user edits, cross-platform scripts, tests for every package change, no AGPL, no copyrighted text or real
PDFs in the repo).

Then: summarise the current state in Persian in a few lines and propose the next steps from docs/HANDOFF.md §9 so I
can choose. My next goal is: [اینجا بنویسید چه می‌خواهید، مثلاً: «کتاب اسکن‌شده‌ام را OCR و ترجمه کنم و پسرم روی
گوشی اندروید بخواند» یا «فاز ۵ را شروع کن»].
```
