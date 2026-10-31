# Dozabaneh (دوزبانه) — session handoff, 2026-10-30

Paste this file into a new agent session opened on `C:\Users\user\Books-Translator2`, branch `fix/ocr-outlined-text`
(pushed, working tree clean). It continues `docs/HANDOFF-SESSION-2026-10.md`. Read that one for the app, the
architecture and the earlier ADRs (038–042); this file covers only what changed since.

## 0. Read first

`CLAUDE.md` (binding rules), `docs/SPEC.md`, `docs/DECISIONS.md` (now up to **ADR-043** plus three ADR-041
addenda), `docs/PROGRESS.md`, `docs/HANDOFF-SESSION-2026-10.md`.

**Working agreement:** talk to the owner in **Persian**; code, commits and comments in **English**. The owner is
not a developer and uses Windows + PowerShell: give one command per line and say where to click. Work one thing
at a time: plan → wait for approval → implement with tests → quality gate → screenshots for UI → update
PROGRESS/DECISIONS → Persian summary → stop. The owner wants **few tokens**: keep replies short.

**Quality gate:** `pnpm lint && pnpm typecheck && pnpm test`, plus `PW_WEB_PORT=4273 pnpm e2e` for UI work.
Current: lint ✓ · typecheck ✓ · **567 unit** ✓ · **42 e2e** ✓.

## 1. This session — four commits

### `77c285a` — cost estimate before «شروع ترجمه», and a spending cap (ADR-043)

A previous session had left this half-written, and it broke lint and typecheck. It is now finished.

- `packages/shared/src/cost.ts` holds the types, the default rates, `tokensOf`/`usdOf` and `budgetStatus`.
- `apps/api/src/pipeline/cost.ts` holds `measureRates` (from the library's own succeeded jobs, ≥3 per stage),
  `estimateCost`, `spend`, `budgetState`, `get/setBudget` (app setting `budget`).
- `estimatePipeline` (`pipeline/control.ts`) now returns `cost`. The setup page shows it through `CostLine` in
  `TranslationSetup.tsx`: tokens always, and dollars only for a `paid` model. Everything else shows «هزینه‌ی دلاری
  ندارد».
- Each paid call adds to `jobs.cost_usd` (`addUsage(..., usd)`, `ProviderService.usdOf`). The price is the
  provider's listed one, remembered when the model list is fetched (`rememberPrice`).
- Settings → «سقف هزینه» (`BudgetSection.tsx`, `GET/PUT /settings/budget`) sets a daily/monthly cap.
  `ProviderService.blockedEngines()` adds the paid engines while the cap is reached; their jobs wait and nothing
  fails.
- Only OpenRouter non-`:free` models count as `paid` (`modelCost`). Claude Code = subscription, so it shows tokens
  only. **There is no direct Anthropic API engine**; one was offered to the owner as a possible next step.

### `4f74884` · `f4346b7` — Piper actually works on Windows (ADR-041 addenda)

Verified against the owner's real install: `pip install piper-tts` (1.8.0, OHF-Voice/piper1-gpl) and the voice
`fa_IR-gyro-medium`, both at `C:\Users\user\piper-voices\`. `piper.exe` is on PATH and ffmpeg is installed, so MP3
works.

1. **No stdout.** Piper 1.x on Windows cannot write a WAV to stdout (it reopens a locked temp file and gets a
   `PermissionError`), and without `--output_file` it *plays* the sound. Each piece is now written to a file in a
   fresh temp folder and read back.
2. **UTF-8.** Python decoded stdin in the ANSI code page, so the Persian text arrived garbled. Letters like «ژ»
   crashed Piper (`UnicodeEncodeError … surrogates`), and the rest was spoken as noise: a 4-word sentence came out
   as 10 s instead of 2 s. Every spawned program now gets `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8`.
   `testing/fake-piper.mjs` fails, as the real program does, when given `-` or when UTF-8 mode is missing.

### `abe893f` — «بخوان» in the reader uses the chosen voice

Windows has no Persian `speechSynthesis` voice. When a file source (Piper/Azure/Google/OpenAI) is chosen and ready,
`ReadAloud.tsx` now:
- splits the target column into ~700-char pieces of whole paragraphs (`piecesOf`);
- posts each piece to the new `POST /api/v1/tts/speak` (`routes/audio.ts`, rule-based `speechText` only, with no
  model pass so the reader does not wait);
- plays the pieces in turn and prefetches the next one.

The browser voice is the fallback. Measured: ~3 s per piece. Confirmed working on the owner's running app with a
headless Playwright probe.

## 2. State of the owner's library

| Book | State |
|---|---|
| بیهوشی میلر (Anesthesia, 45 p) | ready, 1,364/1,364, but from the *old* shredded extraction (sentences cut mid-way). Re-upload gives clean segments |
| Rosen (329 p) | translating, 23% |
| Resume analysis / sample | ready |
| AI_Engineering (991 p) | `brief` job may still be `failed`; the owner was told to press «تلاش دوباره» |

## 3. Open work

1. **Tutor panel error.** The owner's screenshot shows «پاسخ ناتمام ماند: خطای ناشناخته» in «بپرس از مدرس» on the
   **Ollama** engine. Not investigated yet; offered to the owner.
2. **The owner has not yet confirmed by ear** that Piper now sounds right after the UTF-8 fix (the tests and the
   probe pass). Ask.
3. Paragraph edges: 339 of 487 paragraphs end without terminal punctuation (from the earlier handoff).
4. Optional: a direct Anthropic API engine (`anthropic`, key on the server) so that Claude via the API gets exact
   dollar estimates. Today Claude-by-API is possible only through OpenRouter.
5. Do not regenerate `pnpm fixtures:pdf` on Windows (broken fonts here). The e2e `translate.spec.ts` agent hint
   flaked once.

## 4. Model / effort advice given to the owner

| Task | Recommended | Cheapest |
|---|---|---|
| translate / glossary / brief / edit | Claude Code, model `sonnet`, `TRANSLATE_EFFORT=low` (default; thinking off) | Gemini free tier / Ollama; profile «اقتصادی» drops the edit stage (≈ half the tokens) |
| audio summaries, speech polish | Sonnet low | Haiku |
| voice | Azure fa-IR (Dilara/Farid) for best quality | browser (free) or Piper (free, offline) |

A 2,231-segment chapter, translate + edit ≈ 1.9 M input / 0.55 M output tokens: ≈ $9 on Sonnet 5.5 API, ≈ $0.5 on
Haiku 5.5. On Claude Code it costs subscription allowance, not dollars.

## 5. Gotchas met this session

- Writing TS through a Python heredoc turned `'\\n'` into a real newline twice. Use the Edit tool for strings
  that contain escapes.
- The owner's `pnpm dev` hot-reloads the API, so a new route can be checked against the running app on `:8787`
  without restarting it.
- `apps/web/src/guards.test.ts` fails on Persian literals in components; every UI string goes in
  `apps/web/src/i18n/fa.json`.
