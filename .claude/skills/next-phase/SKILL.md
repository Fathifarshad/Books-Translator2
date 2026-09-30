---
name: next-phase
description: Plan and execute the next unfinished phase of the Dozabaneh roadmap (docs/SPEC.md §19), then stop for review.
disable-model-invocation: true
argument-hint: "[phase-number]"
---

# Next phase

Requested phase (optional): $ARGUMENTS

1. Read `docs/PROGRESS.md` and find the next unfinished phase (or use the requested phase number).
2. If no phase has started yet, first read **all** of `docs/SPEC.md` and look carefully at every image in `docs/design/`.
   Otherwise read the spec sections relevant to this phase, plus `docs/DECISIONS.md` and `CLAUDE.md`.
3. Write a plan **in Persian**: goal, files to create/change, steps, test plan, risks, and open questions
   (only decisions that are expensive to reverse). Keep technical names in English.
4. **Stop and wait for my explicit approval. Do not edit any file before I approve.**
5. After approval: implement in small commits (Conventional Commits) with tests alongside the code.
6. Run `pnpm lint && pnpm typecheck && pnpm test` (and `pnpm e2e` if UI changed). Fix root causes until green.
7. For UI work: take Playwright screenshots (1440×900 and 390×844, light and dark) into `docs/screens/phase-N/`,
   view them yourself, compare with `docs/design/`, and fix differences.
8. Check every acceptance criterion of the phase in SPEC §19, tick it in `docs/PROGRESS.md`,
   and add ADR entries to `docs/DECISIONS.md` for non-obvious decisions.
9. Summarize in Persian: what was built, how to run and test it step by step, known limitations, what's next. Then stop.
