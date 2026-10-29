# Dozabaneh (دوزبانه) — session handoff, 2026-10-29

Paste this whole file into a new agent session that has the repository
`C:\Users\user\Books-Translator2` (branch `fix/ocr-outlined-text`) open.

## 0. Read first

`CLAUDE.md` (binding rules), `docs/SPEC.md` (source of truth), `docs/DECISIONS.md`
(ADR-001 … ADR-039), `docs/PROGRESS.md`, `docs/HANDOFF.md`, `docs/GUIDE.fa.md`
(the owner's Persian guide).

Working agreement: talk to the owner in **Persian**; code, identifiers, commits and
comments in **English**. The owner is not a developer and uses Windows + PowerShell.
Quality gate before every hand-off: `pnpm lint && pnpm typecheck && pnpm test`, and
`PW_WEB_PORT=4273 pnpm e2e` for UI work (port 4173 is taken by another program on
this machine, and Playwright would otherwise silently run the whole suite against it).

## 1. What the app is

PDF → structured book → glossary → translation → editorial pass → parallel reader
(TOC | Persian | English | AI tutor), right-to-left. React 19 SPA + Fastify 5 + SQLite.
Engines are pluggable per task: `claude_code`, `agent`, `mock`, `gemini`, `ollama`,
`openrouter`.

## 2. What was done in this session (3 commits)

### `83f10d7` — Claude Code as an automatic engine, and real parallelism (ADR-038)

The owner's book sat at 1% for days. Five separate causes:

1. **Chunks were chained.** Every translate chunk depended on the previous chunk of
   its chapter. The book is *one* chapter, so exactly one chunk was ever runnable —
   one batch for Claude Code, no parallel provider calls. Chunks are now independent
   (document order survives through `seq`); `finalizeChapter` still fixes first-mention
   parentheticals, and an edit unit still waits for its own section's chunks.
   Migration `apps/api/drizzle/0004_parallel_chunks.sql` unchains books already queued.
2. **New `claude_code` engine.** The server runs the `claude` CLI installed on the
   machine, headless (`claude -p --output-format json --tools "" --safe-mode
   --strict-mcp-config --no-session-persistence --permission-prompts none --effort low`),
   with the project's prompts as the system prompt and the batch payload on stdin. No
   API key; paid for by the owner's Claude subscription. Node-only, so it lives behind
   the `@dozabaneh/ai/claude-cli` subpath — **`packages/ai` must stay browser-safe**
   (the web app imports the mock engines from it).
3. **`WORKER_CONCURRENCY`** (default 3) — the runner keeps three jobs busy.
4. **`CHUNK_MAX_ITEMS = 60`** — a chunk is capped by keys as well as words; 2,500
   words of two-column OCR had become 231 keys in one answer.
5. **Switching engine mid-book** moves the still-queued jobs (`retargetJobs`) instead
   of forcing a cancel-and-restart; **«ساختن دوبارهٔ واژه‌نامه»**
   (`POST /books/:id/glossary/rebuild`) throws away a glossary a weak model poisoned
   (`pregnancy → بازگشت`, `labor → تولید`, `cardiac output → خرج قلبی`), keeping locked
   terms and finished translations.

### `ebcc810` — why it still timed out (ADR-038 addendum)

1. **`CLAUDE_EFFORT` is a name Claude Code itself exports** into the terminals it
   opens, so an app started with `pnpm dev` in the VS Code terminal inherited that
   session's level and translated at `xhigh`. The setting is now **`TRANSLATE_EFFORT`**,
   and `childEnv()` strips `CLAUDECODE`, `CLAUDE_CODE_SSE_PORT`,
   `CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_EFFORT` from the child.
2. **Thinking, not translating.** `--effort low` alone was not enough: a 60-item chunk
   spent 48,400 output tokens and 518 s thinking about 600 words. At the default effort
   the engine now also sets **`MAX_THINKING_TOKENS=0`** — the same chunk takes 80 s and
   7,368 tokens and passes the same validation. `TRANSLATE_EFFORT=medium` or higher
   gives thinking back.
3. **One shredded fragment killed a whole chunk.** `empty` is fatal (ADR-036), so 59
   good translations were discarded over one broken OCR line. `rescueEmptyItems()` now
   lets up to 10% of a chunk's items keep their source text; QA flags them
   (`target_script`) and the review queue shows them.
4. A job of a **paused** pipeline is never claimed, not even one left `running` by a
   process that died.

### `660d0ff` — two columns read as two columns (ADR-039)

The owner's chapter came out as 2,231 tiny segments whose text wove the two columns
into each other («over the time of gestation. At term, the plasma volume is **By the
end of the first trimester, maternal cardiac output** 50% to 55% above…»). The PDF
carries a text layer written by an OCR tool (PDF24, `GlyphLessFont`), so our own OCR
never ran and that layer's geometry is what everything believed.

- `plausibleWidth()` (`packages/pdf/src/lines.ts`) caps an item at 1.1 em per
  character — that layer reported 1,639 pt for «Tidal volume» on a 612 pt page.
- `orderPage()` takes the page extent from percentiles clamped to the paper; one line
  claiming to end at 1,966 had put the middle at 1,012, where there is no gutter.
- Only a line that really crosses the page interrupts the columns; a short one near
  the middle joins the column it sits in.
- The gutter threshold is **1.6 em, not 1.8** — this book's gutter is exactly 1.8 em,
  so the old test was false by a hair and the two columns became one line.
- A block of fewer than five words is a label, not a sentence the column ran out of
  room for, and is no longer merged across a break.

Measured on the owner's chapter: 2,231 → 1,384 segments, 1,234 → 487 paragraphs,
24 → 55 words per paragraph.

## 3. Measurements worth keeping

| What | Value |
|---|---|
| Real 60-item chunk, Claude Code, effort low, thinking off | 80 s, 2 calls, 60/60 keys, ~7.4k output tokens |
| Same chunk with thinking on | 518 s, 48,400 output tokens |
| Owner's usage so far, `claude_code` | 3.27 M input / 1.77 M output over 127 jobs |
| Owner's usage so far, `ollama` | 2.18 M / 2.05 M over 424 jobs |

## 4. State of the owner's library (2026-10-29)

| Book | Pages | Segments | State |
|---|---|---|---|
| 58-Anesthesia for Obstetrics | 45 | 2,231 | **ready** (translated; still the *old* shredded extraction — re-upload would give 1,384 clean segments) |
| Rosens_PDF24_OCR | 329 | 14,688 | translating on `ollama`, ~1,093 jobs queued |
| AI_Engineering_Building_Applications | 991 | 6,757 | **stuck**: `brief` job `failed` — «You've hit your weekly limit · resets 8am» |
| resume-analysis | 5 | 89 | ready |
| sample | 36 | 52 | ready |

## 5. Known defects / next work

1. **Claude weekly-limit text is not recognised.** `LIMIT_HINT` in
   `packages/ai/src/engine/claude-cli.ts` matches `usage limit|rate limit|limit
   reached|too many requests|429` — but the CLI says «You've hit your **weekly
   limit** · resets 8am (America/Santiago)». It falls through to `UNKNOWN`, which is a
   job failure, so attempts are consumed and the job fails for good instead of waiting
   for the reset. `resetDelayMs()` also only parses an ISO timestamp, not «resets 8am».
2. 339 of 487 paragraphs still end without terminal punctuation — sentences still break
   at some column/page boundaries. Order is correct; only the paragraph edges are.
3. `pnpm fixtures:pdf` produces broken fixtures **on Windows**: pdf.js draws pdfkit's
   standard-14 fonts as empty boxes here, so a re-rendered "scan" is unreadable. Do not
   regenerate the fixtures on this machine; they are correct in git.
4. Requested but not built: export to Markdown / Word / PDF / clipboard; text-to-speech
   (podcast) of the translation and of a summary; a chooser for which API or source
   pays for the translation.

## 6. House rules that bite

- `packages/ai` must stay importable in the browser — anything using `node:*` goes
  behind a subpath export.
- Every change in `packages/*` needs tests; never weaken a test to make it pass.
- RTL-first: logical CSS only (`ms-/me-/ps-/pe-/start-/end-`), isolate opposite-direction
  runs. All UI strings through `apps/web/src/i18n/fa.json` — `apps/web/src/guards.test.ts`
  fails on a Persian literal in a component or a missing i18n key.
- Never hard-code `fa`/`en`; use the book's languages and the registry in `packages/text`.
- `data/` is git-ignored and holds the owner's real books — never commit it.
