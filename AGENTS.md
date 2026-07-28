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
§18's visuals (ADR-0028); UI prompts read `docs/demo-design-language.md` first (now authored -
the ADR-0028 gate is satisfied).

Then read [`PLAN.md`](./PLAN.md) and [`DECISIONS.md`](./DECISIONS.md) for what was decided and why.

Demo work is governed by [`docs/demo-contract.md`](./docs/demo-contract.md) (the normative Phase 1
investor-demo contract, D-034) with its machine-usable matrix [`config/demo/scenarios.yaml`](./config/demo/scenarios.yaml)
and acceptance map [`docs/demo-contract-checklist.md`](./docs/demo-contract-checklist.md). Salesforce is
deferred-pending-sandbox (labeled fakes until then; Phase 1 never declared complete on fakes), and all
demo UI derives its look from `docs/demo-design-language.md`, not v3's visual prescriptions.
Expected engine outcomes are fixed by the golden-case truth set [`docs/golden-cases.md`](./docs/golden-cases.md)
plus `fixtures/golden/` (D-035): captain-signoff-gated (agents never sign; the captain signed all 16 cases
on 2026-07-26, making their expected outcomes binding product truth), validated by `pnpm golden:validate`
(CI job `golden-cases`) and the `golden-cases` fence.

The walking skeleton (v3 prompt 3, D-036) lives at `/app/demo` (launcher + `/app/demo/[station]`):
typed view models `src/app/demo/model.ts`, fake service `src/app/demo/journey.ts` + `build-*.ts`,
branch data `src/app/demo/data.ts` fenced EQUAL to scenarios.yaml, and surfaces under
`src/app/demo/surfaces/` fenced to import only view models + presentation (both rules:
`src/__tests__/fitness/demo-skeleton-honesty.test.ts`). Landing a real path = replace the
corresponding builder and remove its `DevProvenanceBadge` in the SAME PR (design §11.3).

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

- `src/contracts/` - types + pure functions, no project-local imports from outer layers
  (`Result<T,E>`, `AppError`, roles) plus the v3 decision-core Zod contracts
  (`contracts/decision-core/`, ADR-0029; zod is the layer's ONLY permitted external import - a
  second one needs its own ADR).
- `src/domain/` — entities, use-cases, ports (interfaces), the workflow engine + flow definitions.
- `src/infrastructure/` — adapters/port implementations. `process.env` is read ONLY in
  `src/infrastructure/config` (fence: `no-process-env`).
- `src/app/` — Next.js App Router + the presentation tier (`app/presentation/`). Any demo/UI
  surface work follows [`docs/demo-design-language.md`](./docs/demo-design-language.md) (normative;
  tokens live only in `globals.css` + the presentation tier - never fork them).

## Commands (pnpm via corepack)

`corepack pnpm install` · `pnpm dev` · `pnpm build` · `pnpm typecheck` · `pnpm lint` ·
`pnpm test` (unit+integration+fitness, **non-UTC clock**) · `pnpm test:fitness` · `pnpm test:e2e`
(Playwright + axe) · `pnpm knip` · `pnpm v3:invariants` (three-state v3 invariant report) ·
`pnpm golden:validate` (16-case golden truth set). All gates
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
- **One identity per request:** `requirePrincipal` memoizes its in-flight promise on a `WeakMap` keyed
  by the `NextRequest`. A route may bind several grants (`/api/audit` holds `audit.export` AND
  `pii.view`), and a second resolution would re-read the cookie the client SENT after renewal already
  rotated that id away - a 401 that only appears once the session passes its half-life.
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
- **Receded (0.7-opacity) treatments and axe:** fade CONTENT, never a StatusBadge (a blended
  amber badge lands ~4.1:1 and fails), and secondary text inside a faded block must be slate-800+
  (slate-600 at 0.7 is ~3.5:1). E2E axe scans settle animations first
  (`document.getAnimations().map(a => a.finished)`) or the 0.4s container fade reads as false
  contrast failures.
- **Displayed metrics (balances, health scores, counts) go through `<Metric>` / `DisplayMetric`**
  (`src/contracts/metric.ts`, `src/app/presentation/metric.tsx`) — the `metric-provenance` fence fails the
  build on a naked metric-field render (a field marked `display:"metric"` in the data dictionary rendered
  in JSX without provenance). A value computed from any synthetic input auto-becomes a watermarked
  "demonstration" via `deriveArtifactProvenance` and is refused by `canFeedComplianceDecision`
  (charter #3 extension, ADR-0022). Seeding the populated world / building compliance-scan must use these.
- **Sealed security types (v3 §15, D-061) construct ONLY via their factories** - all SEVEN of
  `Tokenized<T>`, `TenantContext`, `ActionGrant`, `ActorRef`, `Principal`, `WriteActor`, `ObservabilityId`
  (`tenantOf`/`systemTenant` in `contracts/tenant.ts`; `authorizeGovernedAction`/`actorRefOf` in
  `contracts/authz.ts`; `writeActorOf`/reviewed system-actor factories in `contracts/principal.ts`;
  `tokenizeText`/`tokenizeRecord` in `infrastructure/pii/tokenize.ts`;
  `observabilityId`/`observabilityIdOrRedacted` in `domain/observability/safe-values.ts`). A cast,
  literal, sub-interface that merely EXTENDS one, type predicate, a type argument the call YIELDS
  (explicit OR inferred, whenever the signature INVENTS that parameter - names it in the return and in
  no parameter), or a sealed annotation/return/class property/assignment/parameter default filled from
  an `any`/`unknown` (a `JSON.parse`, an awaited `Promise<any>`) fails the `tokenized-factory-only`
  fence. Merely NAMING a sealed type in a generic position is fine (`new Map<string, TenantContext>()`
  mints nothing), and so is `const p: Principal | null = null` - null is a CHECKED value. The ESLint mirror is the edit-time cast/literal SUBSET only: its `SEALED_TYPES`/
  `SEALED_FACTORY_FILES` must match that fence's registry AND the rule must stay wired into every shipped
  layer - the fence asserts both, resolving the real config for representative files.
  Every repository/port call requires a TenantContext (`tenant-context-required` fence; capability-keyed
  loads are exact-match escapes IN the fence). Nothing under `src/infrastructure/llm/` may (transitively)
  import a PIIBearing-marked type or a PII-shaped exported VALUE (`llm-pii-boundary` fence - a new
  interface with a raw PII-named field must extend `PIIBearing` or be reviewed into that fence's escapes).
  Config secrets are `SecretValue`s: the raw string leaves only through the free function `revealSecret()`
  (there is no `.reveal()` member), and only in the fence-allowlisted HMAC consumers.
- **Governed sinks are reachable only from a REQUEST-HANDLING surface**, which calls
  `requireActionGrant(req, "<action>")` rather than a bare role check. That hook needs the framework's
  `NextRequest` and calls `requirePrincipal` (which writes a rotated cookie), so a Server Action
  (`"use server"`), a reserved App Router component file (`page`/`layout`/…), or any default-exported
  component can never satisfy it - reaching a governed sink from one is its own fail-closed
  `governed-actions` violation. A plain app-layer helper that takes the request IS supported (the rule
  keys on what the surface is, not on the file name); a request-less authorization entry point is later
  architecture, not an escape. The authorization PROLOGUE may bind several grants - `/api/audit` holds
  `audit.export` AND `pii.view` - but every (bind, fail-closed guard) pair comes before any route work,
  and the authorized value must reach the sink's own `ActionGrant` PARAMETER. A sink handed to another
  function as a value is refused: there is no call site left to authorize.
- **Authority assertions live in ONE contiguous prologue, not in a fixed statement slot.**
  `authorityPrologueViolations` (`_fence-utils.ts`) is shared by the governed-actions and
  tenant-context-required fences, so they cannot disagree: the prologue is the maximal contiguous
  LEADING run of sealed-authority assertions, and any required assertion outside it fails. Order is
  free; anything else (a db call, a branch, a side effect) ENDS the prologue. Every `ActionGrant` owes
  its exact action assertion. Every grant pair owes `assertSameTenant(left.tenant, right.tenant)`, and
  each explicit `TenantContext` must be compared with every grant. `assertSameTenant` checks both org
  and actor identity, so authorities that disagree on either cannot reach work. Demanding a literal
  statement #1 in each fence separately is what made dual-authority signatures unbuildable.
- **The app layer holds NO raw SQL.** A resolved `db.query(...)`/`tx.exec(...)` anywhere under `src/app/`
  fails the build (`detectAppLayerSqlAccess`, asserted by BOTH the governed-actions and
  tenant-context-required fences). Both derivations read repository signatures under
  `src/infrastructure/`, so an inline query has no signature to carry an `ActionGrant` or a sealed
  `TenantContext` - it is outside both fences, not a smaller version of a repository call. The executor
  is resolved by the name it is DECLARED under, so `const { query } = db` and `db["query"](...)` are the
  same violation. A repository is exempt from `pii.view` only when it is a WRITE boundary and nothing
  else - DML whose only reads are the locking pre-image reads it takes; adding an audit INSERT to a
  plain read does not buy it an exemption.
- **Audit actions and entity types are TYPES, not strings**: `ObservabilityAction` /
  `ObservabilityEntityType` (`domain/observability/safe-values.ts`) are what `auditedWrite`/`auditEvent`
  accept. A `string` there is a build failure - an unlisted value degrades to `[REDACTED]` in the very
  log line an operator needs, and the vocabulary fence flags a dynamic attribute value the same way it
  flags a dynamic span name.
- **Test-only vocabulary/authority enters through injection seams, never production allowlists:**
  `registerTestSpanName` (`domain/observability/safe-values.ts`) and `registerTestSystemActor`
  (`contracts/tenant.ts`). Both are fenced to have NO shipped caller, keyed on resolved symbol so an
  aliased import cannot evade it. The observability vocabularies (span names, log messages, actions,
  enums, numeric fields, id fields) are derived from real call sites BOTH ways by
  `observability-vocabulary` - an unregistered value would silently log as `[REDACTED]`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
