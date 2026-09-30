---
name: quality-gate
description: Run the full Dozabaneh quality gate (lint, typecheck, unit and e2e tests), fix failures at the root cause, and report in Persian.
disable-model-invocation: true
---

# Quality gate

1. Run in order: `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm e2e`.
2. Fix failures at the root cause. Never skip, disable or weaken tests or assertions without asking me first.
3. Re-run until everything is green.
4. Report in Persian: what failed, what you changed and why, and the final status.
