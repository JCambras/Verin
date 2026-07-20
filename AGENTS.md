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
  `knip` fails the build on dead exports outside `contracts/` (and the `domain/schema` vocabulary, D-013)
  and on unused `dependencies` in `package.json` (D-028).
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
advisory). Node 22 in CI (`engines` floor ≥20); the house-CRM store is PGlite (real Postgres) in dev/CI
behind the store interface (`SqlDb` in `src/infrastructure/store/db.ts`), managed Postgres in prod.

## Sharp edges (hard-won — read before touching these areas)

- **Store singleton:** `getDb()` caches on `globalThis`, NOT a module-local var — Next bundles route
  handlers and server components/actions separately, so a module-local singleton opens TWO PGlite
  instances (writes to one invisible to the other → "session not found"). PGlite is single-connection;
  `db.ts` serializes all ops with a mutex.
- **Prod guards key on `APP_ENV`, never `NODE_ENV`:** `next build`/`next start` force `NODE_ENV=production`
  even in dev/CI, so the config fail-closed guards and the secure-cookie flag use `APP_ENV` (real
  deployment env). Same for the e2e webserver.
- **Auth uses a Server Action** (`src/app/login/actions.ts`): it sets the cookie + redirects atomically,
  avoiding the client Set-Cookie/navigate race and hydration race. Client forms are uncontrolled
  (FormData) and gate submit on `useHydrated()` so a pre-hydration click can't do a native submit.
- Tests must run on a non-UTC TZ (`vitest.config.ts` pins `America/New_York`); `src/__tests__/setup.ts`
  fails loudly if the clock is UTC.
- ESLint pinned to 9.x (typescript-eslint 8 is incompatible with ESLint 10's scope-manager API);
  TypeScript pinned to 6.x (not the Go-based TS 7) for tooling compatibility.
- Fences prefer AST (`ts-morph`) over regex; a weak/tautological fence is worse than none — the self-audit
  caught two of my own fences passing vacuously (`no-pii-in-audit-store`, `org-id-required`). When adding a
  fence, prove its companion actually rejects a real violation.
- **Displayed metrics (balances, health scores, counts) go through `<Metric>` / `DisplayMetric`**
  (`src/contracts/metric.ts`, `src/app/presentation/metric.tsx`) — the `metric-provenance` fence fails the
  build on a naked metric-field render (a field marked `display:"metric"` in the data dictionary rendered
  in JSX without provenance). A value computed from any synthetic input auto-becomes a watermarked
  "demonstration" via `deriveArtifactProvenance` and is refused by `canFeedComplianceDecision`
  (charter #3 extension, ADR-0022). Seeding the populated world / building compliance-scan must use these.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
