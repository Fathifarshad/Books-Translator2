# Books-Translator2 — «دوزبانه» (Dozabaneh)

Bilingual book translator and parallel reader with an AI tutor. English book PDF → structured book → glossary →
translation → careful editorial pass → a four-column RTL reader (TOC | Persian | English | «بپرس از مدرس»).
Web first (React SPA), wrapped as Android/iOS apps later (Capacitor).

- Spec (source of truth): [`docs/SPEC.md`](docs/SPEC.md)
- Progress: [`docs/PROGRESS.md`](docs/PROGRESS.md) · Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Persian README (run & test instructions): [`README.fa.md`](README.fa.md)

```bash
corepack enable
pnpm install
pnpm dev                          # API :8787 + web :5173
pnpm lint && pnpm typecheck && pnpm test && pnpm e2e
```

Status: Phase 0 (foundation) and Phase 1 (reader + tutor with an original sample book and the mock engine) are in
place; PDF ingestion (Phase 2), the agent-mode translation pipeline (Phase 3) and API engines (Phase 4) follow.
