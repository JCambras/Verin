# Project agent memory — Verin

**READ [`CHARTER.md`](./CHARTER.md) FIRST, IN FULL, EVERY SESSION.** It is the constitution of
this repo and overrides convenience. The charter is amended only by an ADR referenced in the PR that
changes it (a silent `CHARTER.md` edit fails review). [`charter-map.json`](./charter-map.json) links
each non-negotiable to the fence/gate/procedure that enforces it, and the charter-drift fence
(`src/__tests__/fitness/charter-drift.test.ts`) fails the build if any enforced mapping goes stale.

**Then read [`docs/v3/README.md`](./docs/v3/README.md)** - the ratified v3 direction (Verin as the
governed decision and execution layer; ADRs 0023-0030). The 30 v3 invariants are phase-gated in
[`v3-invariants.json`](./v3-invariants.json) (report: `pnpm v3:invariants`, blocking in CI; the registry
stores activation only - pass/fail is computed, never fake green). **The registry, not the prompt-sequence
prose, is the authoritative statement of what each gate requires**: all ten gates (0, A, B, C, D, E, F,
G, H, I) declare `{wave, prompts, requires, entryGates, entryCondition, outcome}` with TYPED requirements
(`invariant`/`artifact`/`fitness`/`ci-gate`, plus `evidence` for an outcome clause nothing decides yet,
which never reads green). Activation OWNERSHIP (`invariant.gate`) is separate from gate REQUIREMENT: a
gate must require every invariant it owns and may reference one another gate owns when it is fully proven
by the time this gate closes. Gate B explicitly awaits prompt-10 schema validation and shared-engine
binding for both domain YAML files; file existence alone proves nothing. Invariant 3 pins both YAML
artifacts and `src/__tests__/fitness/domain-configuration.test.ts` as activation prerequisites, so an
unrelated naming fence cannot activate it. One shared rule
set (`scripts/v3-gates.lib.ts`) is enforced by BOTH the gate-ordering fence and the blocking runner - it
rejects a gate requiring anything whose PROOF POINT (last `activationPrompts` entry, else the owning
gate's closing prompt) falls after that gate closes, a gate with no machine-checkable requirement, and a
`ci-gate` that does not name the command its blocking job runs (ADR-0030 - Gate A owns 1/2/4/5 and
references prompt-5 guarantees 7/8/9;
invariant 3 is required at Gate B because its prerequisite is prompt 10). `ci-gate` evidence is a real
YAML parse of `ci.yml` walking `jobs.<k>.steps[].run` plus a restricted shell-command parse of the
effective workflow/job/step shell and working directory. The workflow must run on unfiltered normal
push and pull request events, every mapped command runs from the repository root, and mapped controls
invoke their owned entry points directly. The required
command must be a dedicated simple command whose exit status controls its step, and the job must BLOCK:
a command in a comment, echo argument, short-circuited expression, heredoc, step `name:`, `env:` value,
commented-out block-scalar line, or a job/step carrying `continue-on-error` or an `if:` proves nothing.
Unsupported runners, custom shells, evidence jobs with non-empty `needs` dependencies, and evidence
jobs using `strategy.matrix` also prove nothing. Declared `activationPrompts` are validated for every
status, the prompt-5 proof points for invariants 7, 8, and 9 are pinned exactly, and every shipped active
invariant's complete mechanism tuple set is ratcheted. The active invariant ID set must exactly match
the mechanism-ratchet keys through one shared validator invoked by both the registry fence and blocking
runner.
That parse (`parseCiJobs`) is the repo's one structured CI authority - charter-drift reads its enforced
`ci-gate` mechanisms through it too. Every enforced charter CI mapping pins its exact command; malformed,
empty, unsupported-shell, and fully skipped jobs prove nothing. The charter ratchet pins every complete
effective enforced mechanism tuple, including mechanism-level status. Both v3 mappings pin
`pnpm exec tsx scripts/v3-invariants.ts`, and the runner exits nonzero for every mapped fitness failure
or missing result. Readiness computes every gate's structural `entryGates`, so a later
gate cannot report green while a predecessor is non-green. Five ratchets in the shared gate library pin the
30-invariant gate-assignment map, the prompt-5 proof points for invariants 7, 8, and 9, invariant 3's
activation artifacts and fitness mechanism, complete gate metadata (wave, predecessor chain, entry
condition, outcome), and every gate's COMPLETE TYPED requirement set including each non-invariant proof
prompt: moving one, including deleting an `evidence` clause, is an ADR-0030 + ADR-0023 amendment, never a
registry edit alone. The ratified documents registered in
`v3-invariants.json` are SHA-256-pinned by the arch-version fence, which covers that registry and not the
whole directory: editing a registered document requires updating its pin in the same PR, and a new
ratified document must be registered in the PR that adds it - but a conflict between v3's letter and this
repo is resolved by an ADR, never by editing the ratified bytes (ADR-0024, ADR-0026, ADR-0030).
`docs/v3/README.md` is not registered: it is
the navigation index, and it originates nothing normative, only restating registered documents, ADRs, the
charter, and `DECISIONS.md` entries, so a new normative statement originates in one of those instead (D-099).
Salesforce work is DEFERRED until sandbox access (ADR-0024); demo UI uses the established design system,
not v3 §18's visuals (ADR-0028); UI prompts read `docs/demo-design-language.md` first (now authored -
the ADR-0028 gate is satisfied).

Then read [`PLAN.md`](./PLAN.md) and [`DECISIONS.md`](./DECISIONS.md) for what was decided and why.

The standing product thesis lives in [`docs/product-guide.md`](./docs/product-guide.md) (D-098) - test
every design, prompt, and demo choice against it; it states the thesis
[`PRODUCT-DIRECTION.md`](./PRODUCT-DIRECTION.md) serves, and is subordinate to the charter, v3,
`PRODUCT-DIRECTION.md` itself, and the demo contract/design language - each of those wins on conflict.

Demo work is governed by [`docs/demo-contract.md`](./docs/demo-contract.md) (the normative Phase 1
investor-demo contract, D-034) with its machine-usable matrix [`config/demo/scenarios.yaml`](./config/demo/scenarios.yaml)
and acceptance map [`docs/demo-contract-checklist.md`](./docs/demo-contract-checklist.md). Salesforce is
deferred-pending-sandbox (labeled fakes until then; Phase 1 never declared complete on fakes), and all
demo UI derives its look from `docs/demo-design-language.md`, not v3's visual prescriptions.
Expected engine outcomes are fixed by the golden-case truth set [`docs/golden-cases.md`](./docs/golden-cases.md)
plus `fixtures/golden/` (D-035): captain-signoff-gated (agents never sign; the captain signed all 16 cases
on 2026-07-26, making their expected outcomes binding product truth), validated by `pnpm golden:validate`
(CI job `golden-cases`) and the `golden-cases` fence.

The replay corpus (v3 prompt 11, ADR-0052) is a SEPARATE artifact from the signed 16 and disjoint from
them by construction: [`docs/corpus.md`](./docs/corpus.md) is normative, hand-owned input lives in
`fixtures/corpus/spec/`, and `fixtures/corpus/{manifest.json,synthetic/}` are GENERATED - never hand-edit
them, `pnpm corpus:validate` regenerates and byte-compares (CI job `corpus`). Derivation is path-keyed
(`SHA-256(seed‖path‖field)`), so adding a household changes only that household's bytes. The real-derived
partition ships EMPTY behind a fail-closed intake contract ([`docs/corpus-scrub-procedure.md`](./docs/corpus-scrub-procedure.md));
`detectionRate` is `null` with a reason code and is NEVER substituted by the synthetic figure, whose name
is `syntheticDefectCoverage`. Signoff is per corpus version bound to `corpusDigest`, including exact case
bytes and labels, schemas, taxonomy, freshness, and declarative plus executable replay semantics.
Both partitions require typed expected-versus-observed treatment, and a defect without a context-bound
mismatch fails closed. Defect labels and detector attributions are exact singletons. Both partitions use
explicit selected funding, with synthetic pending semantics bound to that exact request-household set.
Synthetic identity context carries raw UTF-8 bytes, exact candidates, and household bindings instead of
assumption-only proof. Real-derived replay uses entity-kind-scoped references with firm ids excluded from
generic subjects, exact kind/subject/source evidence, exact-integer aggregate selected funding, pending
actions bound to the request and selected account, and threshold treatment selected by signed comparator
policy. Regeneration invalidates signoff, and agents never sign.

The walking skeleton (v3 prompt 3, D-036) lives at `/app/demo` (launcher + `/app/demo/[station]`):
typed view models `src/app/demo/model.ts`, fake service `src/app/demo/journey.ts` + `build-*.ts`,
branch data `src/app/demo/data.ts` fenced EQUAL to scenarios.yaml, and surfaces under
`src/app/demo/surfaces/` fenced to import only view models + presentation (both rules:
`src/__tests__/fitness/demo-skeleton-honesty.test.ts`). Gate 0 surface completeness is fenced by
`src/__tests__/fitness/demo-surface-completeness.test.ts`, which binds the normative section 4 list to
the exact twelve surface identities in the SHA-pinned ratified demo contract, the typed manifest, each
route case's imported component, the dynamic page's reachable return and query-derived approval input,
the exact ordered clickable journey controls without registered Playwright hooks, and screenshots that
verify the corresponding URL and loaded marker. CI then runs
`scripts/demo-screen-artifacts.ts` to require every canonical artifact to exist and be non-empty, and
upload-artifact fails when missing, conditionally disabled, or failure-neutralized.
Landing a real path = replace the corresponding builder and remove
its `DevProvenanceBadge` in the SAME PR (design §11.3).

The decision-primitive vocabulary (v3 prompt 8, ADR-0039) lives at `src/contracts/primitives/`
(six primitives, set 1.0.0, provisional), mirrored by root `primitive-set-version.json` and
`docs/primitive-rationale.md` (razor, falsification criteria, cross-domain matrix) - the
`primitive-catalog` fence keeps all three in sync, domain-neutral, and pure. Adding or
stretching a primitive is a version bump through the declared-future list, never a quiet edit;
prompts 9-10 consume the catalog (published keys -> AST context vocabulary; bindings -> config).

The policy AST + interpreter (v3 prompt 9, ADR-0053) are the grammar in
`src/contracts/decision-core/policy.ts` (CLOSED: exactly the ratified variants; grammar 1.0.0
active, 1.1.0 adds only the reserved `elapsed` op, which the loader refuses as grammar-only) and
the pure module `src/domain/policy/` (ten files: seven-check loader - every effect-reading check
lives in `load-effects.ts` - conservative effect-conflict prover that REJECTS when disjointness is
unprovable, four-phase fail-closed evaluator; no Date/Intl/IO - temporal math is integer-only in
`temporal.ts`). A primitive's KEY-SHAPING parameters (the catalog's `keyShapingParameters`, the
ones its `publishedKeys` reads) are configuration-only: the loader refuses a policy write to one as
`key-shaping-parameter-not-writable`, and prompt 10's binding model must not re-open that (D-184).
A context key resolves by its DECLARED ORIGIN (primitive-origin from the published facts,
intent-origin from the intent slots), so a stray intent entry can never substitute for a fact an
unevaluable primitive did not publish (D-185). A fact under an `iso-date`/`iso-timestamp`-typed
registry path resolves ONLY from canonical bytes: `PolicyContextPlane` carries the declared
evidence/instruction registries, and `resolveValue` lands non-canonical bytes (a `'2026-8-1'`, an
offset timestamp, a non-string) as the same miss a non-scalar gets - rule unevaluable, blocker
synthesized. Prompts 14-16 still owe assembly-time canonicalization; the guard is a backstop, not
a substitute (D-186). Predicate arms are a DISCRIMINATED union on `op`
(a plain union re-parses every arm's children: measured 2^depth), and `loadPolicy` refuses a
document nested past a structural cap BEFORE parsing - bounding admission once is what keeps the
parse and all five recursive walks below it total, since the evaluator only ever consumes a
`LoadedPolicy` (D-181). Extending the grammar or the interpreter is a
version bump re-proving the migration fixture (`fixtures/policy/migration-1.0.0.json`), never a
quiet widening - the `policy-ast` fence pins the vocabulary, purity, domain neutrality, fixture
digests, and named-deferral reachability (callers land at prompts 10/16/20). Invariant 16 is
active on this module.

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
`pnpm golden:validate` (16-case golden truth set) ·
`pnpm corpus:{generate,validate,report}` (replay corpus; `validate` is the blocking `corpus` gate). All gates
also run in `.github/workflows/ci.yml` (blocking, never advisory). Node 22 in CI (`engines` floor ≥20);
the house-CRM store is PGlite (real Postgres) in dev/CI behind the store interface (`SqlDb` in
`src/infrastructure/store/db.ts`), managed Postgres in prod.
The test job also runs `scripts/fitness-tests.ts`, which requires a per-file result for the complete
fitness inventory even if Vitest include or exclude configuration drifts.

## Sharp edges (hard-won — read before touching these areas)

- **Store singleton:** `getDb()` caches on `globalThis`, NOT a module-local var — Next bundles route
  handlers and server components/actions separately, so a module-local singleton opens TWO PGlite
  instances (writes to one invisible to the other → "session not found"). PGlite is single-connection;
  `db.ts` serializes all ops with a mutex.
- **Schema = versioned migrations (D-016/D-029), not in-place DDL.** `migrations.ts` is an ordered
  `MIGRATIONS` list applied by `runMigrations` (records each version in `schema_migrations`). A schema
  change APPENDS `{version, name, sql}`; never edit a shipped migration's DDL. Before mutation, the
  runner proves the ledger is an exact contiguous `(version, name)` prefix of that list and proves a
  missing/empty ledger belongs to a virgin managed schema. All pending versions share one transaction;
  each read-only preflight runs immediately before its DDL, and tenant-edge orphans are reported for
  operator repair, never silently rewritten. Temporal columns are
  `timestamptz`, but the app boundary stays ISO strings BOTH ways: writers emit `toISOString()`; a read
  parser in `db.ts` (OID 1184 → `new Date(v).toISOString()`) normalizes reads to canonical UTC ISO - do
  NOT expect `Date` objects, and the byte-exact round-trip is what keeps the audit hash chain verifiable.
  Adding a table? Classify it in the `org-id-required` fence (it derives from this DDL).
- **Decision history is NOT `audit_log`.** The prompt-7 source of truth is the sibling
  `decision_ledger` plus immutable replay tables (`src/infrastructure/ledger/`, ADR-0041).
  `recordDecision` commits source rows and recording events together;
  `appendDecisionEvents` runs inside its CALLER'S transaction so CRM audit-outbox intent and a
  decision event can commit atomically, and both require the producer's `RecordProvenance` -
  surfaces classify a row from the stored `prov_source`, never from an actor name. Ledger hashes
  cover a versioned envelope of stored `payload_json` bytes plus producer provenance. Never rewrite
  old bytes; raw inserts into an immutable
  source table belong ONLY in `ledger-store.ts` (chain) or `ledger-sources.ts` (content-addressed
  evidence/bundle/record rows, reusable when the bytes match). Derived state lives in
  `ledger-projection-store.ts` and is rebuilt through `ledger-rebuild.ts`. Reservation reuse is
  generation-bound: a release cites its reservation ref, owning decision, and creation ledger entry,
  so an old release cannot affect a later reuse. L1-L4 plus immutable replay-source verification and
  the `ledger-append-only` fence enforce these assumptions; the register authenticates the complete
  chain from a consistent non-locking snapshot while bounding disclosure and replay, and
  `audit-chain-verify` verifies both chains and retained replay sources whole.
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
  fails loudly if the clock is UTC. That config also HOLDS the execution policy, so no invocation path
  (`pnpm test`, `test:watch`, the run `scripts/v3-invariants.ts` spawns) can lose it: two projects -
  `fitness` (serial; several fences each build their own full-repository ts-morph program) and `app`
  (parallel) - each declaring its OWN `include`, because `extends: true` CONCATENATES arrays and a root
  `include` would be added to both (D-172/D-173/D-174). The fitness project computes one shared
  `validateCorpus()` world in `globalSetup` (`_corpus-world-setup.ts`, which re-pins the clock because
  global setup does not inherit `test.env`) and rebuilds it on a watch rerun via `forceRerunTriggers`;
  read the corpus world through `_corpus-world.ts`, never by calling `validateCorpus()` at module scope
  (D-175/D-176).
- ESLint pinned to 9.x (typescript-eslint 8 is incompatible with ESLint 10's scope-manager API);
  TypeScript pinned to 6.x (not the Go-based TS 7) for tooling compatibility.
- Fences prefer AST (`ts-morph`) over regex; a weak/tautological fence is worse than none — the self-audit
  caught two of my own fences passing vacuously (`no-pii-in-audit-store`, `org-id-required`). When adding a
  fence, prove its companion actually rejects a real violation.
- **Receded (0.7-opacity) treatments and axe:** fade CONTENT, never a StatusBadge (a blended
  amber badge lands ~4.1:1 and fails), and secondary text inside a faded block must be slate-800+
  (slate-600 at 0.7 is ~3.5:1). E2E axe scans settle animations first
  (`document.getAnimations().map(a => a.finished)`) or the 0.4s container fade reads as false
  contrast failures. Required E2E specs await the sanctioned `e2e/axe.ts` helper; the Axe fence pins the
  exact non-mutating animation settlement, complete WCAG scan, and direct unmodified-violations
  assertion, rejects scope skips and expected failures through normalized direct, wrapped, or aliased
  Playwright symbols, rejects TestInfo neutralizers from callback parameters or `test.info()` values in
  required tests and their registered hooks, requires stable positive helper provenance, follows
  neutralizers invoked through `bind`, `call`, `apply`, or `Reflect.apply` and transitively invoked local helpers, and
  fails closed on unresolved local callable indirection, proves Playwright forbids focused exclusion and
  selects the required specs, derives the complete Next `page.tsx` inventory, and binds every public,
  authenticated, and demo route to its loaded-state
  scan. Required callbacks admit only their typed loops and canonical uninstrumented login call.
  Required specifications may register no Playwright hooks. Required route collections cannot be supplied
  through reassigned aliases, and conditional callback exits before a scan make the proof non-evidence.
  Required specs cannot import the Axe runtime, and the sanctioned helper cannot carry module-scope
  executable instrumentation. Charter-drift uses symbol-aware Vitest registration analysis for computed,
  aliased, namespace, x-prefixed, todo, fails, skipIf, and runIf neutralizers.
- **Displayed metrics (balances, health scores, counts) go through `<Metric>` / `DisplayMetric`**
  (`src/contracts/metric.ts`, `src/app/presentation/metric.tsx`) — the `metric-provenance` fence fails the
  build on a naked metric-field render (a field marked `display:"metric"` in the data dictionary rendered
  in JSX without provenance). A value computed from any synthetic input auto-becomes a watermarked
  "demonstration" via `deriveArtifactProvenance` and is refused by `canFeedComplianceDecision`
  (charter #3 extension, ADR-0022). Seeding the populated world / building compliance-scan must use these.
- **Sealed security types (v3 §15, D-061) construct ONLY via their factories** - all SEVEN of
  `Tokenized<T>`, `TenantContext`, `ActionGrant`, `ActorRef`, `Principal`, `WriteActor`, `ObservabilityId`
  (`tenantOf`/`tenantFromIdentity`/`systemTenant` in `contracts/tenant.ts`;
  `authorizeGovernedAction`/`actorRefOf` in
  `contracts/authz.ts`; `writeActorOf`/reviewed system-actor factories in `contracts/principal.ts`;
  `tokenizeText`/`tokenizeRecord` in `infrastructure/pii/tokenize.ts`;
  `authorityObservabilityId`/`generatedObservabilityId`/`keyedDigestObservabilityId`/
  `observabilityIdOrRedacted` in `domain/observability/safe-values.ts`). A cast,
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
  LLM request text comes only from `trustedStaticProjectionText`: the factory owns the reviewed literal
  template and exact sensitive spans. Account references use `sensitiveAccountReferences` for extraction,
  masking, and residual refusal, including space-separated and hyphenated forms.
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
  each explicit `TenantContext` must be compared with every grant. A wrapped authority is read exactly
  once into a `const` binding before those assertions and is never re-read from its carrier.
  `assertSameTenant` checks both org and actor identity, so authorities that disagree on either cannot
  reach work. Closed unions and fixed
  tuples are accepted only when every arm exposes one identical complete authority inventory; optional
  authorities, arrays, open records, and index signatures are refused as runtime-dynamic. Demanding a literal
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
  flags a dynamic span name. Client-supplied record IDs parse through `parseMachineRecordId` before
  repository work. Log/trace record ids do NOT trust UUID shape alone: direct cryptographic mints use
  `generatedObservabilityId`, while request-derived UUIDs pass through `keyedObservabilityId`, which
  emits a tenant- and field-scoped HMAC digest under a domain-separated purpose key. A failed mint
  redacts rather than aborting failure reporting; the governed audit chain retains the raw record id.
- **Test-only vocabulary/authority enters through injection seams, never production allowlists:**
  `registerTestSpanName` (`domain/observability/safe-values.ts`), `registerTestSystemActor`
  (`contracts/tenant.ts`), and `registerTestLedgerIdentifier`/`registerTestLedgerIdentifierPrefix`
  (`infrastructure/ledger/ledger-pii.ts`, reserved `test:` namespace). All are fenced to have NO
  shipped caller, keyed on resolved symbol so an aliased import cannot evade it. The observability
  vocabularies (span names, log messages, actions, enums, numeric fields, id fields) are derived from
  real call sites BOTH ways by `observability-vocabulary` - an unregistered value would silently log
  as `[REDACTED]`; `ledger-pii-vocabulary` does the same for the immutable-source PII allowlists (no
  shipped `REGISTERED_*` entry may live in the reserved namespace). A ledger export that no shipped
  surface or script can reach fails `ledger-reachability` unless it is a NAMED deferral (D-116)
  saying which prompt lands its caller - knip cannot see this, since every export has a test.
- **`scripts/**` is budgeted AND dead-export-gated now (ADR-0052, D-171).** Both budget fences used to
  walk `src/` only, so moving code to `scripts/` was an escape hatch. `line-budget` has a `tooling` bucket
  and `max-file-size` walks `scripts/**` under the same 500-line per-file ceiling. `knip.json` entries are
  `scripts/*.ts` (top-level runners plus two library files), NOT `scripts/**/*.ts`, so a never-referenced
  export under `scripts/corpus/` or any future subdirectory now fails the dead-export gate. Build-time
  tooling is a legitimate home for generators — it is not an unmeasured one. `src/__tests__/**` is still
  in no bucket: that gap is DEFERRED, not exempt (D-172, follow-up `fu-corpus-test-tree-budget`).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
