# Project agent memory — Verin

**READ [`CHARTER.md`](./CHARTER.md) FIRST, IN FULL, EVERY SESSION.** It is the constitution of
this repo and overrides convenience. The charter is amended only by an ADR referenced in the PR that
changes it (a silent `CHARTER.md` edit fails review). [`charter-map.json`](./charter-map.json) links
each non-negotiable to the fence/gate/procedure that enforces it, and the charter-drift fence
(`src/__tests__/fitness/charter-drift.test.ts`) fails the build if any enforced mapping goes stale.

Then read [`PLAN.md`](./PLAN.md) and [`DECISIONS.md`](./DECISIONS.md) for what was decided and why.

## Non-negotiable working rules (from the charter)

- **Fence every invariant in the same PR that states it**, and prove it adversarially (inject a
  violation, watch it fail with `file:line`, revert, append to [`docs/fences/proof-log.md`](./docs/fences/proof-log.md)).
- **Detection is not verification.** Every PASS-emitting check needs a companion proving incomplete
  work cannot pass it.
- **Nothing built-but-not-shipped.** A capability merges only if reachable from UI/API in the same PR;
  `knip` fails the build on dead exports outside `contracts/`.
- **No unlabeled synthetic data.** Every displayed/seeded value carries provenance (`source`/`asOf`).
- Reversible decisions proceed but are logged in `DECISIONS.md`; irreversible/architectural ones stop
  and ask (a `needs-decision`).

## Architecture (authoritative source = the code)

Four layers under `src/`, dependency rule points inward (`contracts ← domain ← infrastructure ← app`).
`app/` may import anything; `contracts/` imports nothing project-local. Enforced at edit-time by ESLint
(`eslint.config.mjs`) and authoritatively by the fitness fences in `src/__tests__/fitness/`.

- `src/contracts/` — dependency-free types + pure functions (`Result<T,E>`, `AppError`, roles).
- `src/domain/` — entities, use-cases, ports (interfaces), the workflow engine + flow definitions.
- `src/infrastructure/` — adapters/port implementations. `process.env` is read ONLY in
  `src/infrastructure/config` (fence: `no-process-env`).
- `src/app/` — Next.js App Router + the presentation tier (`app/presentation/`).

## Commands (pnpm via corepack)

`corepack pnpm install` · `pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` ·
`pnpm test` (unit+integration+fitness, **non-UTC clock**) · `pnpm test:fitness` · `pnpm test:e2e`
(Playwright + axe) · `pnpm knip`. All gates also run in `.github/workflows/ci.yml` (blocking, never
advisory). Node 22; the house-CRM store is PGlite (real Postgres) in dev/CI behind `StorePort`,
managed Postgres in prod.

## Sharp edges

- Tests must run on a non-UTC TZ (`vitest.config.ts` pins `America/New_York`); `src/__tests__/setup.ts`
  fails loudly if the clock is UTC.
- ESLint pinned to 9.x (typescript-eslint 8 is incompatible with ESLint 10's scope-manager API).
- TypeScript pinned to 6.x (not the new Go-based TS 7) for tooling compatibility.
- Fences prefer AST (`ts-morph`) over regex where feasible; a weak/tautological fence is worse than none.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
