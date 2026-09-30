# Contributing

Thanks for helping! Issues and pull requests are welcome (bug reports in Persian or English are fine).

1. Read [CLAUDE.md](CLAUDE.md) (golden rules) and the relevant part of [docs/SPEC.md](docs/SPEC.md).
2. `corepack enable && pnpm install`, then `pnpm dev`.
3. Before opening a PR: `pnpm lint && pnpm typecheck && pnpm test` (and `pnpm e2e` for UI changes). CI runs the same
   checks on Windows and Linux.

Key rules: RTL-first logical CSS; all UI strings in `apps/web/src/i18n/fa.json`; never hard-code `fa`/`en` (use the
language registry in `packages/text`); validate every model output; prompts only in `prompts/`; tests for every change
in `packages/*`; **never commit real PDFs or copyrighted book text** — fixtures are synthetic. Commits follow
Conventional Commits. By contributing you agree to license your work under the [MIT License](LICENSE).
