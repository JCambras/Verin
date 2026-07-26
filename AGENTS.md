# Project agent memory — Verin

**READ [`CHARTER.md`](./CHARTER.md) FIRST, IN FULL, EVERY SESSION.** It is the constitution of
this repo and overrides convenience. The charter is amended only by an ADR referenced in the PR that
changes it (a silent `CHARTER.md` edit fails review). [`charter-map.json`](./charter-map.json) links
each non-negotiable to the fence/gate/procedure that enforces it, and the charter-drift fence
(`src/__tests__/fitness/charter-drift.test.ts`) fails the build if any enforced mapping goes stale.

**Then read [`docs/v3/README.md`](./docs/v3/README.md)** - the ratified v3 direction (Verin as the
governed decision and execution layer; ADRs 0023-0028). The 30 v3 invariants are phase-gated in
[`v3-invariants.json`](./v3-invariants.json) (report: `pnpm v3:invariants`, blocking in CI; the registry
stores activation only - pass/fail is computed, never fake green). Every ratified doc under `docs/v3/` is
SHA-256-pinned (arch-version fence): editing one requires updating its pin in the same PR. Salesforce
work is DEFERRED until sandbox access (ADR-0024); demo UI uses the established design system, not v3
§18's visuals (ADR-0028); UI prompts are blocked on `docs/demo-design-language.md`.

Then read [`PLAN.md`](./PLAN.md) and [`DECISIONS.md`](./DECISIONS.md) for what was decided and why.

Demo work is governed by [`docs/demo-contract.md`](./docs/demo-contract.md) (the normative Phase 1
investor-demo contract, D-034) with its machine-usable matrix [`config/demo/scenarios.yaml`](./config/demo/scenarios.yaml)
and acceptance map [`docs/demo-contract-checklist.md`](./docs/demo-contract-checklist.md). Salesforce is
deferred-pending-sandbox (labeled fakes until then; Phase 1 never declared complete on fakes), and all
demo UI derives its look from `docs/demo-design-language.md`, not v3's visual prescriptions.

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
(Playwright + axe) · `pnpm knip` · `pnpm v3:invariants` (three-state v3 invariant report). All gates
also run in `.github/workflows/ci.yml` (blocking, never advisory). Node 22 in CI (`engines` floor ≥20);
the house-CRM store is PGlite (real Postgres) in dev/CI behind the store interface (`SqlDb` in
`src/infrastructure/store/db.ts`), managed Postgres in prod.

## Sharp edges (hard-won — read before touching these areas)

- **Store singleton:** `getDb()` caches on `globalThis`, NOT a module-local var — Next bundles route
  handlers and server components/actions separately, so a module-local singleton opens TWO PGlite
  instances (writes to one invisible to the other → "session not found"). PGlite is single-connection;
  `db.ts` serializes all ops with a mutex.
- **Schema = versioned migrations (D-016/D-029), not in-place DDL.** `migrations.ts` is an ordered
  `MIGRATIONS` list applied by `runMigrations` (records each version in `schema_migrations`). A schema
  change APPENDS `{version, name, sql}`; never edit a shipped migration's DDL. Temporal columns are
  `timestamptz`, but the app boundary stays ISO strings BOTH ways: writers emit `toISOString()`; a read
  parser in `db.ts` (OID 1184 → `new Date(v).toISOString()`) normalizes reads to canonical UTC ISO - do
  NOT expect `Date` objects, and the byte-exact round-trip is what keeps the audit hash chain verifiable.
  Adding a table? Classify it in the `org-id-required` fence (it derives from this DDL).
- **Prod guards key on `APP_ENV`, never `NODE_ENV`:** `next build`/`next start` force `NODE_ENV=production`
  even in dev/CI, so the config fail-closed guards and the secure-cookie flag use `APP_ENV` (real
  deployment env). Same for the e2e webserver.
- **Auth uses a Server Action** (`src/app/login/actions.ts`): it sets the cookie + redirects atomically,
  avoiding the client Set-Cookie/navigate race and hydration race. Client forms are uncontrolled
  (FormData) and gate submit on `useHydrated()` so a pre-hydration click can't do a native submit.
- **Session lifecycle: renewal/rotation happens ONLY in `requirePrincipal`, never `resolveSession`**
  (ADR-0008, D-030). `resolveAndRenewSession` slides an active session past its half-life (extends
  `expires_at`) and rotates the id, returning a cookie the app layer re-sets via `cookies().set()` - valid
  only in a Route Handler / Server Action. `resolveSession` is the read-only path (the server-component
  `/app` guard + logout, which CANNOT set a cookie) and must never rotate. Do not call `requirePrincipal`
  from a server component (it would throw on the cookie write). Renewal drives off the already-selected
  `expires_at`, so the pinned org-id-required SELECT escape is unchanged.
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
