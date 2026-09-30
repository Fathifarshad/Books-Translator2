# PRD — دوزبانه (Dozabaneh): bilingual book translator & reader

> **راهنمای استفاده (فارسی):** این «سند نیازمندی‌های محصول» است: برنامه برای چه کسی است، چه کارهایی باید بکند،
> کدام بخش‌ها ساخته شده (✅)، کدام نیمه‌کاره است (🟡) و کدام مانده (⬜). اگر بخواهید پروژه را از صفر با ابزار دیگری
> بسازید یا به کسی بسپارید، این فایل را به‌عنوان PRD بدهید. برای ادامه‌ی همین پروژه، `docs/HANDOFF.md` را ببینید.
> جزئیات فنی کامل در `docs/SPEC.md` است.

Version 1.0 · 2026-09-30 · Owner: the repository owner (Persian-speaking, non-developer) · Status legend:
✅ done · 🟡 partial · ⬜ planned.

---

## 1. Problem & vision

Serious English books (textbooks, technical and medical references) are hard to study for Persian readers:
machine translation breaks structure, loses terminology consistency and cannot be read side by side with the
original. **Dozabaneh** turns an English book PDF into a **carefully edited Persian translation** with a
book-specific glossary and shows it in a **parallel bilingual reader** with an **AI tutor** that answers questions
about the passage being read. It should cost nothing to run (free AI engines or Claude Code), run on an ordinary
Windows PC, and let a student read on an Android phone.

## 2. Users

| Persona | Needs |
|---|---|
| **Owner / translator** (Windows PC, not a developer) | Upload PDFs (incl. scanned), control translation quality and terminology, fix translations, use free AI engines, share books with family. Needs click-by-click guidance in Persian. |
| **Reader / student** (Android phone) | Read the Persian translation next to the English, search, look up terms, ask the tutor, read offline, install it like an app. Read-only. |
| **Future: multi-user readers** (Phase 6) | Own accounts and private libraries on a hosted server, native apps. |

## 3. Goals & non-goals

**Goals**
1. Faithful, natural, publication-quality Persian (style guide `prompts/style/fa.md`) with consistent terminology.
2. Perfect structure: chapters → sections → paragraphs; no running heads, page numbers or broken paragraphs.
3. Paragraph-aligned parallel reading, RTL-correct, light/dark, desktop and phone.
4. Engines are configuration, not code: agent (Claude Code), mock, free providers, later paid APIs.
5. Resumable, idempotent pipeline; human edits are never overwritten.
6. Zero running cost by default; local-first privacy.

**Non-goals (for now)**
- Public sharing or publishing of translated books (personal use only; exports carry a notice).
- Real-time collaborative editing; payments; app-store distribution before Phase 6.
- Handling copyrighted text inside the repository (fixtures are synthetic; user data stays in git-ignored `data/`).

## 4. Key user journeys

1. **Add a book:** upload PDF → live extraction progress (OCR for image-only pages) → report (pages, words, warnings,
   OCR pages) → structure review (rename, skip, promote/demote, merge/split) → confirm.
2. **Translate:** choose engine per task and quality profile → estimate → brief → glossary review (approval gate) →
   translate in chapter order → editorial pass → QA → review queue → book «آماده». Sections become readable as soon
   as they are done; «ترجمه‌ی این بخش را الان انجام بده» moves a section to the front.
3. **Read:** TOC | Persian | English | tutor; toggles for columns; glossary popovers; select text → «بپرس درباره‌ی
   این»; paragraph tools (ask, edit with diff/undo, copy, flag, note); section summary; chapter quiz; search (Ctrl/⌘+K).
4. **Share with a phone:** (a) library «⋯» → «نسخه‌ی آفلاین برای موبایل» → one HTML file sent by Telegram/WhatsApp,
   opened in Chrome, works without internet; or (b) Settings → «دسترسی از موبایل» → set password → `pnpm share` →
   send the https link → phone signs in (read-only) → «Add to Home screen».

## 5. Functional requirements & status

### 5.1 Ingestion (`packages/pdf`)
- ✅ Text PDFs via pdf.js in a worker thread; header/footer removal; columns; de-hyphenation; continuation merge
  across lines/columns/pages; block typing (headings, lists, quotes, code, captions, footnotes).
- ✅ Structure from the PDF outline, a printed Contents page, or headings; page labels; front/back matter skips.
- ✅ Large books (300+ pages) without blocking the API, live SSE progress; duplicates detected (SHA-256).
- ✅ OCR for scanned pages (tesseract.js, English, ~216 dpi render), automatic when a page has no text but images;
  report counts OCR pages; unreadable books get a clear alert and `NOTHING_TO_TRANSLATE`.
- 🟡 Validation on the owner's real PDFs (text and scanned) — owner's run pending.
- ⬜ OCR speed (parallel workers, ETA), Persian OCR data, OCR number clean-up; original-PDF page viewer; figures/tables.

### 5.2 Translation pipeline (`packages/core`, `packages/ai`, `packages/text`, `apps/api`)
- ✅ Per-section job DAG: brief → glossary → **human glossary gate** → translate chunks → edit per section →
  chapter first-mention pass; translation memory; leases/retries; pause/resume/cancel/priority/retry.
- ✅ Deterministic Persian post-processing (characters, ZWNJ, ezafe, punctuation, digits) that never touches code,
  URLs, markup or Latin runs; QA checks → review queue (J/K navigation).
- ✅ Manual edits on the server with revisions and undo; automation only *suggests* for user-edited segments.
- ✅ One task spec + one validation (zod + domain checks) for every engine; one JSON repair round for providers.
- 🟡 Quality profile «بهترین»: stricter threshold only; back-translation check not built.
- ⬜ Global glossary across books + CSV import/export.

### 5.3 AI engines & settings
- ✅ `agent` (Claude Code via batch files + `/process-batches` skill + `agent:*` CLI), `mock`.
- ✅ Free providers: **Gemini** (key link + paste + automatic test), **OpenRouter** (one-click OAuth PKCE),
  **Ollama** (local or cloud models via the local server, native `/api/chat` with JSON schema, 16k context).
- ✅ Keys encrypted on the server (AES-256-GCM), write-only; rate limits per minute/day with waiting instead of
  failing; a rejected key/model pauses that provider; per-job token usage; dashboard provider panel.
- ✅ Assistant engine (tutor/summary/quiz) selectable: mock or any connected provider.
- ⬜ Paid `anthropic` and `openai` engines, cost estimate, budget cap, Message-Batches mode.
- ⬜ Deferred tutor answers through Claude Code («ارسال برای پاسخ با Claude Code»; schema exists).

### 5.4 Reader & tutor (`apps/web`)
- ✅ Four-column RTL reader, aligned rows, glossary popovers (collision-aware), selection toolbar, paragraph tools,
  summaries, chapter quiz, themes (light/sepia/dark/system), display settings, keyboard shortcuts (`event.code`),
  deep links, reading progress, phone layout (TOC drawer, tutor bottom sheet), axe-clean.
- ✅ Tutor: send-time context from the current section + selection, streamed answers, validated citation chips,
  retry without duplicates, modes, history, Markdown export.
- 🟡 Tutor history, reading progress and summaries are per device (browser storage).
- ⬜ Highlights & notes (+ list page), footnote/figure improvements, sentence-level hover alignment, virtualization.

### 5.5 Phones & access
- ✅ Offline single-file HTML export per book (contents, Persian / bilingual / English modes, search, glossary,
  font size, dark mode, remembers position; no network, strict CSP; personal-use notice).
- ✅ `pnpm share`: builds the app, serves it from the API on one port, opens a Cloudflare quick tunnel, shows the
  link in Settings; LAN address as fallback; clear Windows messages.
- ✅ Access control: this computer = owner; other devices need the access password (scrypt, 30-day HttpOnly
  session, 10 tries / 10 min / IP) and are **read-only** (read, download offline copy, use tutor); same-origin
  check for writes; Host spoofing from the LAN rejected.
- ✅ Installable web app (manifest + icons).
- ⬜ Stable link (named tunnel or hosting), offline cache inside the installed app (service worker + IndexedDB),
  native Android/iOS (Capacitor, Phase 6).

### 5.6 Export
- ✅ Offline HTML reader (above).
- ⬜ EPUB / DOCX / Markdown (bilingual or target-only, RTL-correct, personal-use notice).

### 5.7 Multi-language
- ✅ Language registry (`packages/text`), no hard-coded `fa`/`en` in components or pipeline; OCR codes per language.
- ⬜ Arabic + one LTR target to validate (Phase 6); English UI file.

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| RTL & bidi | Logical CSS only; isolate opposite-direction runs; mirrored icons; per-run digit localisation. |
| i18n | Every UI string in `apps/web/src/i18n/fa.json`; guard test fails on Persian literals in components. |
| Reliability | Pipeline survives crashes/restarts; double submit is a no-op; leases expire and resume. |
| Performance | 300+ page ingestion off the main thread, `/health` < 500 ms meanwhile; reader loads one bundle per book. |
| Security | Keys never leave the server; clients never call AI providers; book text is data (delimited, injection-safe); validated LLM output; remote readers read-only; CSRF origin check. |
| Privacy & copyright | Local-first; no real PDFs/copyrighted text in the repo; exports for personal use. |
| Accessibility | Keyboard-only navigation; axe: no serious/critical issues. |
| Portability | Windows/macOS/Linux; Node ≥ 22.22; pnpm 10.33; no bash-only scripts. |
| Licences | MIT/Apache/BSD/ISC (fonts OFL); **no AGPL** without approval. |
| Quality gate | `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e` green before every push; screenshots for UI changes (1440×900 and 390×844, light + dark). |

## 7. Roadmap (remaining work, in suggested order)

| # | Item | Done when |
|---|---|---|
| 1 | Owner's real run: scanned textbook → OCR → translate with Ollama → read on Android | book «آماده», counter 100%, offline file and tunnel link work on the son's phone |
| 2 | OCR performance & quality | 2–4× faster on a 300-page scan (worker pool), ETA shown, number errors reduced, tests on fixtures |
| 3 | Phone polish | stable link documented/automated; offline cache in the installed app; tutor history on the server |
| 4 | Phase 4 leftovers | deferred tutor answers via Claude Code; `anthropic` + `openai` engines with cost tracking and budget cap; back-translation check |
| 5 | Phase 5 power features | PDF page viewer, figures/tables, highlights & notes, EPUB/DOCX/Markdown export, global glossary + CSV, sentence alignment, virtualization, a11y audit — each with tests and screenshots |
| 6 | Phase 6 mobile & multi-user | auth (bearer tokens), Postgres, object storage, Docker, Capacitor Android build running reading + tutor against the hosted API, notifications, 2 more target languages |

## 8. Success metrics

- Structure: TOC equals the PDF outline; < 1% suspected mid-sentence breaks; no running heads in text.
- Translation: every translatable segment has exactly one final translation; QA flags per 1,000 segments trending
  down; glossary terms used consistently.
- Reliability: zero lost work after a crash/restart; no overwritten user edits.
- Usability: the owner completes add → translate → read → share without developer help, following `GUIDE.fa.md`.
- Cost: $0 with free engines; tokens recorded per job.

## 9. Constraints & risks

- Free-tier limits change (Gemini, OpenRouter); the limiter adapts after 429s and limits are editable.
- OCR quality on poor scans; OCR time on large books.
- Quick-tunnel links change each run and need the PC on; some networks may block them.
- The owner's PC is the server until Phase 6 hosting.
- Real providers and the real tunnel were only tested against fakes in the build sandbox.

## 10. Architecture (summary)

React SPA (`apps/web`) ⇄ REST + SSE ⇄ Fastify API (`apps/api`: routes → services → SQLite/Drizzle/FTS5; job runner →
`packages/pdf` ingestion → `packages/ai` engines). Agent mode exchanges JSON batches with Claude Code through
`data/exchange/`. Details: `docs/SPEC.md` §5–§17, decisions: `docs/DECISIONS.md`.

## 11. Terms

| Term | Meaning |
|---|---|
| Segment | One source paragraph/block with a stable id; paired with exactly one target segment. |
| Brief | Short book description (genre, audience, tone) that guides every task. |
| Glossary gate | Pipeline pause until the owner approves the book glossary. |
| Editorial pass | «ویراستاری دقیق»: a second model pass with minimum necessary edits. |
| Agent mode | Claude Code processes batch files with `/process-batches`; no API cost. |
| Reader (role) | A remote device signed in with the access password; read-only. |
