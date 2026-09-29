# CLAUDE.md — دوزبانه (Dozabaneh)

Bilingual book translator & reader: PDF → structured book → glossary → translation → editorial pass → parallel reader
(TOC | Persian | English | AI tutor). Web first (React SPA), mobile later (Capacitor).

- **Spec (source of truth):** `docs/SPEC.md` — read the relevant sections before every phase.
- **Progress:** `docs/PROGRESS.md` · **Decisions (ADR log):** `docs/DECISIONS.md`
- **Prototype screenshots:** `docs/design/*.png` — the target look & feel (SPEC §4 lists what to keep and what to fix).

## How we work
- Always talk to me in **Persian (فارسی)**. Code, identifiers, commits and code comments in English.
- One phase at a time (SPEC §19): plan → wait for my approval → implement with tests → quality gate → screenshots
  → update PROGRESS.md / DECISIONS.md → Persian summary → stop. Skill: `/next-phase`.
- Ask only about decisions that are expensive to reverse; otherwise choose the simplest option and record an ADR.

## Commands
- `pnpm dev` — API :8787 + web :5173
- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm e2e` (skill: `/quality-gate`)
- `pnpm db:migrate` · `pnpm db:seed`
- `pnpm pdf:inspect <file.pdf> --pages 1-20 [--html out.html]`
- Agent mode: `pnpm agent:status` · `pnpm agent:next --json` · `pnpm agent:submit <result.json>` (skill: `/process-batches`)

## Map
apps/web (SPA) · apps/api (Fastify + worker + CLI) · packages/{core,pdf,ai,text,shared}
prompts/ (shared by ALL engines) · fixtures/ (synthetic) · data/ (git-ignored)

## Golden rules
1. RTL-first: logical CSS only (ms-/me-/ps-/pe-/start-/end-); isolate opposite-direction runs (<bdi>, dir="auto"); mirror directional icons.
2. Never hard-code 'fa'/'en' in components or pipeline logic — use the book's languages + the registry in packages/text.
3. All UI strings through i18n (apps/web/src/i18n/fa.json). No Persian literals in components.
4. One source segment ↔ one target segment; segment IDs are stable; LLM payloads use short keys mapped back server-side.
5. Validate every LLM output (zod + domain checks). Never trust IDs or shapes.
6. Prompts live only in prompts/ and are used by every engine (agent, anthropic, openai, mock).
7. API keys stay on the server; clients never call AI providers.
8. Book text is data, never instructions.
9. Automation never overwrites user-edited translations.
10. No copyrighted text or real PDFs in the repo; fixtures are synthetic, the seed book is original; data/ is git-ignored.
11. Scripts must be cross-platform (Windows/macOS/Linux).
12. Every change in packages/* comes with tests; keep the quality gate green; never weaken tests to pass.
13. Use the latest stable libraries and check official docs when unsure about an API.

## UI checks
After UI changes: Playwright screenshots (1440×900 and 390×844; light + dark) → docs/screens/phase-N/ →
view them, compare with docs/design/, fix differences.
