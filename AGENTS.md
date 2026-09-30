# AGENTS.md — دوزبانه (Dozabaneh)

Instructions for coding agents other than Claude Code (e.g. Codex). The rules are the same for every agent:

1. Read `CLAUDE.md` first — it is the binding project memory (working agreement, commands, golden rules).
2. Then read `docs/HANDOFF.md` (current state and next steps), `docs/PRD.md`, `docs/PROGRESS.md`,
   `docs/DECISIONS.md`, and the relevant sections of `docs/SPEC.md` (source of truth).
3. Skills referenced in `CLAUDE.md` live in `.claude/skills/*/SKILL.md`; read them as plain checklists
   (`quality-gate`, `next-phase`, `process-batches`).

Quality gate before every push: `pnpm lint && pnpm typecheck && pnpm test` (+ `pnpm e2e` when UI changed).
