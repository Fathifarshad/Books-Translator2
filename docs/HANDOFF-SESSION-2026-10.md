# Dozabaneh (دوزبانه) — session handoff, 2026-10-29

Paste this whole file into a new agent session that has `C:\Users\user\Books-Translator2` open
(branch `fix/ocr-outlined-text`, working tree clean, everything below committed).

## 0. Read first

`CLAUDE.md` (binding rules), `docs/SPEC.md` (source of truth), `docs/DECISIONS.md` (ADR-001 … ADR-043),
`docs/PROGRESS.md`, `docs/HANDOFF.md`, `docs/GUIDE.fa.md` (the owner's Persian guide).

**Working agreement:** talk to the owner in **Persian**; code, identifiers, commits and comments in **English**.
The owner is not a developer and uses Windows + PowerShell: one command per line, say where to click.
One thing at a time: plan → wait for approval → implement with tests → quality gate → screenshots for UI →
update `PROGRESS.md` / `DECISIONS.md` → Persian summary → stop.

**Quality gate:** `pnpm lint && pnpm typecheck && pnpm test`, plus `PW_WEB_PORT=4273 pnpm e2e` for UI work.
Current: lint ✓ · typecheck ✓ · **562 unit tests** ✓ · **42 e2e** ✓.

## 1. What the app is

PDF → structured book → glossary → translation → editorial pass → parallel reader
(TOC | Persian | English | AI tutor), right-to-left. React 19 SPA + Fastify 5 + SQLite (better-sqlite3, WAL).
Engines are pluggable per task: `claude_code`, `agent`, `mock`, `gemini`, `ollama`, `openrouter`.

```
apps/web      React SPA        apps/api      Fastify + job queue + CLI
packages/pdf  extraction/OCR   packages/ai   task specs, prompts, engines
packages/core chunking/plan     packages/text language registry, QA, speech
prompts/      shared by every engine          data/ (git-ignored) the owner's real books
```

## 2. This session — nine commits

### `83f10d7` — Claude Code as an automatic engine, and real parallelism (ADR-038)

The owner's book sat at 1% for days. Five causes:

1. **Chunks were chained.** Every translate chunk depended on the previous chunk of its chapter. The book is
   *one* chapter, so exactly one chunk was ever runnable. Chunks are now independent (document order survives
   through `seq`); `finalizeChapter` still fixes first-mention parentheticals, and an edit unit still waits for
   its own section's chunks. Migration `drizzle/0004_parallel_chunks.sql` unchains books already queued.
2. **New `claude_code` engine.** The server runs the `claude` CLI installed on the machine, headless
   (`claude -p --output-format json --tools "" --safe-mode --strict-mcp-config --no-session-persistence
   --permission-prompts none --effort low`), prompts from `prompts/` as the system prompt, the batch payload on
   stdin. No API key; paid for by the owner's Claude subscription. Node-only, so it lives behind the
   `@dozabaneh/ai/claude-cli` subpath — **`packages/ai` must stay browser-safe** (the web app imports its mocks).
3. **`WORKER_CONCURRENCY`** (default 3).
4. **`CHUNK_MAX_ITEMS = 60`** — a chunk is capped by keys as well as words; 2,500 words of two-column OCR had
   become 231 keys in one answer, and one missing key rejected the lot.
5. **Switching engine mid-book** moves the still-queued jobs (`retargetJobs`); **«ساختن دوبارهٔ واژه‌نامه»**
   (`POST /books/:id/glossary/rebuild`) throws away a glossary a weak model poisoned (`pregnancy → بازگشت`,
   `cardiac output → خرج قلبی`), keeping locked terms and finished translations.

### `ebcc810` — why it still timed out (ADR-038 addendum)

1. **`CLAUDE_EFFORT` is a name Claude Code itself exports** into the terminals it opens, so an app started with
   `pnpm dev` in the VS Code terminal inherited that session's level and translated at `xhigh`. The setting is
   now **`TRANSLATE_EFFORT`**, and `childEnv()` strips `CLAUDECODE`, `CLAUDE_CODE_SSE_PORT`,
   `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_EFFORT` from the child.
2. **Thinking, not translating.** `--effort low` alone was not enough: a 60-item chunk spent 48,400 output
   tokens and 518 s thinking about 600 words. The default effort now also sets **`MAX_THINKING_TOKENS=0`** — the
   same chunk takes 80 s and 7,368 tokens and passes the same validation. `TRANSLATE_EFFORT=medium` restores it.
3. **One shredded fragment killed a whole chunk.** `empty` is fatal (ADR-036), so 59 good translations were
   discarded over one broken OCR line. `rescueEmptyItems()` lets up to 10% of a chunk's items keep their source
   text; QA flags them and the review queue shows them.
4. A job of a **paused** pipeline is never claimed, not even one left `running` by a dead process.

### `660d0ff` — two columns read as two columns (ADR-039)

The chapter came out as 2,231 segments whose text wove the columns into each other («over the time of gestation.
At term, the plasma volume is **By the end of the first trimester, maternal cardiac output** 50% to 55%…»). The
PDF carries a text layer from an OCR tool (PDF24, `GlyphLessFont`), so our own OCR never ran.

- `plausibleWidth()` caps an item at 1.1 em per character — that layer reported 1,639 pt for «Tidal volume» on a
  612 pt page.
- `orderPage()` takes the page extent from percentiles clamped to the paper; one line claiming to end at 1,966
  had put the middle at 1,012, where there is no gutter.
- Only a line that really crosses the page interrupts the columns.
- The gutter threshold is **1.6 em, not 1.8** — this book's gutter is exactly 1.8 em, so the old test was false
  by a hair and the two columns became one line.
- A block of fewer than five words is a label, not a cut-off sentence, and is no longer merged across a break.

**Measured:** 2,231 → 1,384 segments, 1,234 → 487 paragraphs, 24 → 55 words per paragraph.

### `e06adc7` — exports, and waiting out a full Claude plan (ADR-040)

- **«گرفتن خروجی»** in each book's «⋯» menu: Markdown, Word (`.docx`, the `docx` package), a printable page the
  browser saves as a PDF, the clipboard, and the existing offline reader — each with a «دوزبانه» switch
  (`mode=target|bilingual|source`). All rendered from one model (`apps/api/src/export/document.ts`).
  **Why the browser writes the PDF:** no Node PDF writer shapes Arabic script, and a headless browser would add
  150 MB to an app friends install themselves.
- **A full Claude plan no longer fails the book.** «You've hit your weekly limit · resets 8am» matched none of
  the limit patterns, so the job spent its three attempts in six seconds and failed for good — which is where a
  991-page book stopped. It is QUOTA now (the queue waits, looks again within the hour), and «resets 8am» is read
  as a clock time.

### `3a92269` + `b3e6c25` — reading a book aloud (ADR-041)

No Claude model produces speech, so the source is the owner's choice (`packages/shared/src/tts.ts`,
`apps/api/src/tts/`, Settings → «صدا و پادکست»):

| source | cost | file? |
|---|---|---|
| `browser` | free | ✗ — «بخوان» in the reader (`ReadAloud.tsx`), `speechSynthesis` |
| `piper` | free, offline | ✓ WAV (MP3 with ffmpeg) |
| `azure` / `google` / `openai` | a key, per character | ✓ MP3 |

One file per chapter (a 300-page book as one recording is unusable; a phone's player shows chapters as a
playlist). Recording is a job (`stage: 'audio'`). Two kinds: `full` reads the translation, `summary` reads
chapter summaries the assistant engine writes first — through `assist/task.ts`, extracted so `/assist/*` and the
recording ask for a summary the same way. Page: `/books/:bookId/audio`.

### `9dd2f7a` — text written to be read, said out loud (ADR-042)

The owner: «خیلی مصنوعی و کامپیوتری‌ست». Two passes, split by whether a rule can settle the question.

1. **By rule** (`packages/text/src/speech.ts`, browser-safe, no model): markup and footnote markers removed; a
   parenthesis whose content is in the other script dropped; numbers, decimals, ranges and percentages written
   as words («۳۵٪» → «سی و پنج درصد», «۲٬۲۳۱» → «دو هزار و دویست و سی و یک»); short units said in full
   (`mmHg` → «میلی‌متر جیوه»). The words come from the language registry (`speech: 'fa' | 'en'`), as `normalizer`
   and `ocr` do; an unknown language keeps its digits rather than borrowing another language's words.
2. **By judgement** (`prompts/speech.md`, a new `speech` task): the assistant engine marks the vowels **only**
   on words whose reading is genuinely in doubt (Persian is written without short vowels, so «مرد» and «کرم» are
   guesses for an engine), expands what is still short, and breaks a very long sentence at punctuation it
   already has. Told not to change what is said. A pass that fails leaves the prepared text as it is.
   Switch: «ویرایش متن برای خوانش» in Settings, on by default, skipped when no assistant engine is connected.

The speech task's checks are deliberately **not** the translation's: digits become words and the bracketed term
disappears, so «same numbers», «same markup» and «same length» would fire on a correct answer. What is checked:
every line comes back, in the target language, not empty. Azure and Google additionally get SSML (pauses,
`<lang>` around a run still in the source language); Piper and OpenAI get plain text.

### `77c285a` — what a book will cost, and a ceiling (ADR-043)

Two different counts, deliberately not mixed: **tokens**, which every engine spends, and **dollars**, which only
a pay-as-you-go model spends. Claude Code (a subscription), Ollama (this computer) and a free tier cost no money
and still have a limit, so the estimate always shows tokens and shows dollars only where they are charged —
«هزینه‌ی دلاری ندارد» rather than a misleading «$0».

- **Rates from the owner's own jobs** (`apps/api/src/pipeline/cost.ts`): a stage with ≥ 3 finished calls is
  projected from its own tokens per segment (translate, edit) or per call (brief, glossary); until then from the
  defaults in `packages/shared/src/cost.ts`, measured on one real 60-item chunk. The wizard says which basis it
  used.
- **Prices** are what the provider lists for the chosen model, kept in the provider settings when the model list
  is fetched, so an estimate needs no network. Every finished call of a paid model adds its dollars to
  `jobs.cost_usd` (the column existed and was never written).
- **The ceiling**: Settings → «سقف هزینه», daily and/or monthly, empty = none. While it is reached, the paid
  engines join the runner's blocked list — their jobs wait, nothing fails — and work resumes at midnight or on
  the 1st. It never stops an engine that spends no money.

## 3. Measurements worth keeping

| What | Value |
|---|---|
| Real 60-item chunk, Claude Code, effort low, thinking off | 80 s, 2 calls, 60/60 keys, ~7.4k output tokens |
| Same chunk with thinking on | 518 s, 48,400 output tokens |
| Per segment, translate only | ~400 input / ~123 output tokens |
| Owner's chapter (2,231 segments), translate + edit | ≈ 1.9 M input / 0.55 M output |
| Claude API list prices (2026-10) | Haiku 5.5 $0.10/$0.50 · Sonnet 5.5 $2/$10 · Opus 5.5 $4/$20 per MTok |

Recommended for book translation: **Sonnet 5.5 at `TRANSLATE_EFFORT=low`**. Thinking did not help translation and
in one measured comparison made it worse. Profile «اقتصادی» skips the edit stage (≈ half the tokens).

## 4. The owner's library (2026-10-29)

| Book | Pages | Segments | State |
|---|---|---|---|
| 58-Anesthesia for Obstetrics | 45 | 2,231 | **ready** — translated, but with the *old* shredded extraction; re-upload gives 1,384 clean segments |
| Rosens_PDF24_OCR | 329 | 14,688 | translating on `ollama`, ~1,093 jobs queued |
| AI_Engineering_Building_Applications | 991 | 6,757 | `brief` job still `failed` from the weekly-limit bug — the **code** is fixed; the job needs «تلاش دوباره» on the dashboard |
| resume-analysis / sample | 5 / 36 | 89 / 52 | ready |

## 5. Open work, in the owner's priority order

1. The speech pass has **never run against a real assistant engine or a real voice** on this machine — no TTS key,
   Piper not installed, the assistant engine not connected. Rules are tested; the ear is the owner's.
2. 339 of 487 paragraphs still end without terminal punctuation — order is right, paragraph edges are not.
3. `pnpm fixtures:pdf` produces **broken fixtures on Windows** (pdf.js draws pdfkit's standard-14 fonts as empty
   boxes here). Do not regenerate; they are correct in git.
4. One e2e test (`translate.spec.ts` agent-mode hint) flaked once under full parallelism and passed alone and on
   the next full run. Watch it.

## 6. House rules that bite

- `packages/ai` and `packages/text` must stay importable in the browser — anything using `node:*` goes behind a
  subpath export (`@dozabaneh/ai/claude-cli`).
- Every change in `packages/*` needs tests; never weaken a test to make it pass.
- RTL-first: logical CSS only (`ms-/me-/ps-/pe-/start-/end-`), isolate opposite-direction runs. All UI strings
  through `apps/web/src/i18n/fa.json` — `apps/web/src/guards.test.ts` fails on a Persian literal in a component
  or a missing i18n key.
- Never hard-code `fa`/`en`; use the book's languages and the registry in `packages/text`.
- Keys never reach the client; `data/` is git-ignored and holds the owner's real books — never commit it.
- Playwright: use `PW_WEB_PORT=4273`; another program on this machine holds 4173 and `reuseExistingServer` would
  silently run the whole suite against it.
