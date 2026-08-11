# Verin.

Practice intelligence for registered investment advisers. The third and final build (code name Verin).

## Start here

1. **[`CHARTER.md`](./CHARTER.md)** — the constitution. Read it first, in full. It is code: amended only
   by an ADR, and its enforcement is self-checked by the charter-drift fence.
2. **[`AGENTS.md`](./AGENTS.md)** — how to work in this repo (every session).
3. **[`docs/v3/README.md`](./docs/v3/README.md)** - the ratified v3 architecture direction (ADRs
   0023-0029 and 0055; the ratified documents registered in [`v3-invariants.json`](./v3-invariants.json) are
   SHA-256-pinned by the arch-version fence, which covers that registry rather than the whole directory -
   the index page is not registered, and originates nothing normative, only restating registered
   documents, ADRs, the charter, and `DECISIONS.md` entries, D-099).
4. **[`PLAN.md`](./PLAN.md)** — the foundation plan and pre-mortem.
5. **[`DECISIONS.md`](./DECISIONS.md)** — the decision journal.
6. **`FOUNDATION.md`** — the Part-1 acceptance artifact (lands at the end of the foundation build).
7. **[`PRODUCT-DIRECTION.md`](./PRODUCT-DIRECTION.md)** - the product north star for the demo build,
   subordinate to the charter and grounded in the foundation.
8. **[`docs/product-guide.md`](./docs/product-guide.md)** - the captain-directed differentiating thesis
   (D-098) that the product direction serves; test every design, prompt, and demo choice against it. It
   binds nothing on its own and is subordinate to the charter, v3, `PRODUCT-DIRECTION.md`, the demo
   contract, and [`docs/demo-design-language.md`](./docs/demo-design-language.md) - on conflict, they
   win.
9. **[`docs/demo-contract.md`](./docs/demo-contract.md)** - the normative Phase 1 investor-demo
   contract (D-034), with its scenario matrix [`config/demo/scenarios.yaml`](./config/demo/scenarios.yaml)
   and acceptance checklist [`docs/demo-contract-checklist.md`](./docs/demo-contract-checklist.md).
10. **[`docs/golden-cases.md`](./docs/golden-cases.md)** - the captain-signed golden-case truth set
    (D-035), machine-mirrored in `fixtures/golden/` and gated by `pnpm golden:validate`.
11. **[`docs/corpus.md`](./docs/corpus.md)** - the normative replay-corpus specification (ADR-0052),
    generated into `fixtures/corpus/` and gated by `pnpm corpus:validate`. Its real-derived partition
    ships empty behind [`docs/corpus-scrub-procedure.md`](./docs/corpus-scrub-procedure.md), so no
    detection rate is reported.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript 6 · Tailwind v4 · Vitest 4 · Playwright ·
PGlite/PostgreSQL behind the store interface (`SqlDb`, `src/infrastructure/store/db.ts`) · pnpm (via
corepack) · Node 22 in CI (`engines` floor ≥20).

## Develop

```bash
corepack pnpm install
corepack pnpm dev             # http://localhost:3000
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test            # unit + integration + complete fitness inventory (non-UTC clock)
corepack pnpm test:e2e        # Playwright + axe
corepack pnpm knip            # dead exports / unused dependencies
corepack pnpm v3:invariants   # 30 v3 invariants: active-pass / active-fail / not-yet-active
corepack pnpm golden:validate # 16 golden cases: complete, vocabulary-aligned, signoff-gated
corepack pnpm corpus:validate # replay corpus: regenerate + byte-compare, labels, intake, signoff
corepack pnpm build
```

Every command above except `dev` is also a **blocking** CI gate (`.github/workflows/ci.yml`), never
advisory.

## Architecture

Four layers under `src/` with an inward dependency rule
(`contracts ← domain ← infrastructure ← app`), enforced by ESLint (edit-time) and the fitness fences in
`src/__tests__/fitness/` (authoritative). Decisions live in [`docs/adr/`](./docs/adr/); fence proofs in
[`docs/fences/proof-log.md`](./docs/fences/proof-log.md).
