# Verin.

Practice intelligence for registered investment advisers. The third and final build (code name Verin).

## Start here

1. **[`CHARTER.md`](./CHARTER.md)** — the constitution. Read it first, in full. It is code: amended only
   by an ADR, and its enforcement is self-checked by the charter-drift fence.
2. **[`AGENTS.md`](./AGENTS.md)** — how to work in this repo (every session).
3. **[`PLAN.md`](./PLAN.md)** — the foundation plan and pre-mortem.
4. **[`DECISIONS.md`](./DECISIONS.md)** — the decision journal.
5. **`FOUNDATION.md`** — the Part-1 acceptance artifact (lands at the end of the foundation build).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 6 · Tailwind v4 · Vitest 4 · Playwright ·
PGlite/PostgreSQL behind the store interface (`SqlDb`, `src/infrastructure/store/db.ts`) · pnpm (via
corepack) · Node 22 in CI (`engines` floor ≥20).

## Develop

```bash
corepack pnpm install
corepack pnpm dev            # http://localhost:3000
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test           # unit + integration + fitness fences (non-UTC clock)
corepack pnpm test:e2e       # Playwright + axe
corepack pnpm knip           # dead exports / unused dependencies
corepack pnpm build
```

Every command above except `dev` is also a **blocking** CI gate (`.github/workflows/ci.yml`), never
advisory.

## Architecture

Four layers under `src/` with an inward dependency rule
(`contracts ← domain ← infrastructure ← app`), enforced by ESLint (edit-time) and the fitness fences in
`src/__tests__/fitness/` (authoritative). Decisions live in [`docs/adr/`](./docs/adr/); fence proofs in
[`docs/fences/proof-log.md`](./docs/fences/proof-log.md).
