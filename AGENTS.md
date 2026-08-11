# Project agent memory — Verin

**READ [`CHARTER.md`](./CHARTER.md) FIRST, IN FULL, EVERY SESSION.** It is the constitution of
this repo and overrides convenience. The charter is amended only by an ADR referenced in the PR that
changes it (a silent `CHARTER.md` edit fails review). [`charter-map.json`](./charter-map.json) links
each non-negotiable to the fence/gate/procedure that enforces it, and the charter-drift fence
(`src/__tests__/fitness/charter-drift.test.ts`) fails the build if any enforced mapping goes stale.

**Then read [`docs/v3/README.md`](./docs/v3/README.md)** - the ratified v3 direction (Verin as the
governed decision and execution layer; ADRs 0023-0029 and 0055). The 30 v3 invariants are phase-gated in
[`v3-invariants.json`](./v3-invariants.json) (report: `pnpm v3:invariants`, blocking in CI; the registry
stores activation only - pass/fail is computed, never fake green). The gate model's authoritative owners
are [ADR-0055](./docs/adr/0055-gate-a-invariant-ordering.md) (the complete rule set, its amendment log,
and every "Revisit When" trigger), the registry itself, and the shared rule modules under
`scripts/v3-gates/` reached through `scripts/v3-gates.lib.ts` - one implementation imported by BOTH the
gate-ordering fence and the blocking runner, so read the rules there rather than from any prose
restatement. What an agent needs at edit time:
- **The registry, not prompt-sequence prose, states what each gate requires**, as TYPED requirements;
  activation OWNERSHIP (`invariant.gate`) is separate from gate REQUIREMENT, and nothing a gate requires
  may be proven after that gate closes. The ratchets in `scripts/v3-gates/` pin ownership, proof points,
  metadata, complete requirement sets, and every shipped active mechanism tuple: moving one is an
  ADR-0055 + ADR-0023 amendment, never a registry edit alone.
- **`parseCiJobs` (`scripts/v3-gates/ci-workflow.ts`) is the repo's one structured CI authority** -
  charter-drift and both v3 checkers read `ci.yml` through it, it is fail-closed by design (a mapped
  command is evidence only in a dedicated blocking step of a schedulable, unfiltered, unneutralized
  job), and mapped controls invoke their owned entry points directly. When a mapped command or job
  changes, update `charter-map.json` / the registry and their exact-command ratchets in the same PR.
- **The ratified documents registered in `v3-invariants.json` are SHA-256-pinned** (arch-version fence,
  which covers the registry, not the whole directory): editing one updates its pin in the same PR, and a
  conflict between v3's letter and this repo is resolved by an ADR, never by editing the ratified bytes
  (ADR-0024, ADR-0026, ADR-0055). `docs/v3/README.md` is not registered: it is the navigation index and
  originates nothing normative (D-099).
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

The POPULATED WORLD (front-end parity prompt 4, ADR-0057) is a THIRD generated artifact, disjoint from
both: [`docs/world.md`](./docs/world.md) is normative, hand-owned input is
`fixtures/world/spec/{roster,featured}.json`, and `fixtures/world/{manifest.json,households/}` are
GENERATED - never hand-edit them; `pnpm world:validate` regenerates and byte-compares (CI job `world`).
It reuses the corpus's derivation primitives (`scripts/corpus/{seed,clock}.ts`) rather than a second
mechanism; featured households are addressed by KEY, derived ones by SLOT, and one materializer serves
both so the ninety are as deep as the ten. Household DEPTH is EVIDENCE behind a port
(`HouseholdWorldSource`, `src/domain/world/`) whose Wave 0 fixture adapter refuses production and is
REPLACED, not relabeled, when a real EvidenceSource lands (ADR-0024/0027); the house CRM is projected
only what it owns (households, people, open items) at `prov_source='fixture'` and
`record_origin='world-fixture'` - never financial accounts, which the account-opening flow mints. The
RECORD STORE owns IDENTITY (the surfaces render `households.name`, and a CRM household no evidence
describes is LISTED with an honest no-evidence state and a real on-ramp); the port supplies DEPTH
(D-201). HEALTH IS COMPUTED, NEVER STORED
(`src/domain/world/health.ts`, six weighted factors); the generator emitting a health field fails the
`world-provenance` fence. Vocabularies live in `src/domain/world/household-world.ts` and the generator
IMPORTS them, so a fixture cannot carry a value the product cannot render;
the TWO beneficiary sets live there too and NEITHER answers the other's question -
`BENEFICIARY_SCORED_REGISTRATIONS` (does a missing designation count against health?) is read by the
health factor AND the deficiency note, so the two cannot disagree; `BENEFICIARY_CAPABLE_REGISTRATIONS`
(can this registration carry one at all?) is read by the empty panel, because an individual or joint
account takes a transfer-on-death designation and telling a reader it cannot is the same false claim
as calling the absence a gap (D-195, D-197). Holding confidence is measured against the world's `asOf`,
never against the observation itself, so the receding treatment reads a real signal (D-197).
Clean slate is COUNTED, and what it counts is the ROW's ORIGIN, never its value provenance:
`prov_source` moves when a human edits a value (a rename re-stamps it `user-input`, so an advisor's
own words render un-watermarked) while `record_origin` never moves, so a seeded household somebody
renamed is still purged - two facts, two columns, neither answering the other's question (D-201).
EVERY path that writes a demonstration row NAMES the origin column at its insert - `world-seed.ts`,
`ledger-store.ts` through the REQUIRED `recordOrigin` on `recordDecision`/`appendDecisionEvents`, and
the seed's own tenant scaffolding (`seed-demo-store.ts`'s org insert, and `createUser`'s REQUIRED
`recordOrigin`): a default is a claim about rows you did not write, and an unnamed one made the sweep
report `decision_ledger 0` over the chain `pnpm db:seed` had just written there and `orgs 0`/`users 0`
over the demo firm and its committed-password accounts (D-217, D-218). `demo-seed` is that
scaffolding's and that chain's origin - not the world's, and classified in `DEMONSTRATION_ORIGINS`
rather than falling into the clean half. Marking a row makes it VISIBLE, not removable: the decision
and audit chains are append-only by trigger and the tenant and identities they are anchored to cannot
be deleted while they exist, so the seed is IRREVERSIBLE and the guarantee is that production was never
seeded (`assertSeedableEnvironment` refuses `APP_ENV=production` before a store is opened) AND that any
demonstration row is COUNTABLE if one is there. That guarantee end to end - the COMPLETE
`seedDemoStore`, purged through the LIVE catalog, measured over EVERY base table's row count before
and after rather than over the tables carrying the marker, with each surviving table NAMED and its
reason given (`IRREVERSIBLE_SEED_RESIDUE`, exact in both directions) - is the FIRST case in
`src/__tests__/integration/fixture-purge.test.ts`; the rest are optimisations of it, never
substitutes (D-217, D-218).
`pnpm fixture:check` derives its swept tables from the shipped DDL (any table with `prov_source`),
counts `record_origin` in them, and fails on the first demonstration-origin row; a sweep over zero
tables is a problem, never a pass, and so is a provenance-bearing table the DDL never gives an origin
column (checked from the DDL and again from the store's catalog). That
derivation is read THREE ways that share no code - a structural parse of each table's balanced body
and its top-level column items, a text scan for every `prov_source` DECLARATION (the name followed by
one of a CLOSED set of column TYPES - never a list of keywords that may follow a reference, which is
open, so a `CHECK`, an index, an `ALTER ... SET`, a `DROP COLUMN ... CASCADE`, a `NULLS LAST` or a
view's `GROUP BY` is a use and not a false alarm; an unknown TYPE fails the other way and says so),
and the STORE's own column catalog (base TABLES in `ANY(current_schemas(false))`, the same resolution
the sweep's unqualified `SELECT` uses, so a view or another app's schema is not a false alarm either) -
because two readings that resolve a declaration the same way agree by
construction and cross-check nothing; any disagreement is a sweep problem, so a table one reading
misses fails rather than reporting clean unread, and a false alarm on this check is as corrosive as a
false pass (D-206, D-207, D-208, D-209, D-210). The
`--report` path exits 0 for a developer but takes `--expect-rows=<n>` where a caller needs an
assertion (CI uses it after the seed). `seedWorldIntoCrm` counts rows WRITTEN (`RETURNING id`), never
rows offered, and REFUSES (`CONFLICT`, naming the collision) on the CONDITION - a conflicting
household held by ANOTHER org - never on the symptom it shares with a safe case: world ids are
seed-derived and identical across orgs, so only the first org to load a world receives it and a second
firm's silent empty directory is the worst available outcome (`fu-world-org-scoped-ids`), while the
SAME firm re-offered a regenerated world quietly writes whatever is new (D-198). Every roster
instrument is held by some account - the sleeve derives WHICH instruments, not only how many, and
`validateWorld` fails on a roster entry the world can never render. THREE account rules hold for the
hand-authored ten and the derived ninety alike (`accountRuleProblems`): an account never names its own
owner as a beneficiary, never holds one instrument twice, and is never titled to someone the household
records only as an authorized signer (the enforced form of "an entity household's people hold no
personal accounts inside it" - a generator filter is not a check), and a household's own prose names
no PERSON from a household it links to (`crossHouseholdProseProblems`), because a firm that cannot see
that household may not be told who is in it. A household's `evidence` block
carries each class's PROVENANCE rather than a bare instant, measured once against the world's `asOf`,
so no surface can mint a second confidence for the same observation. An unauthorized cross-household
counterparty is withheld WHOLE - an opaque page-local ordinal numbered across the WITHHELD
counterparties alone (a number that counted named ones too opened a page at "Counterparty 2"), never
the world key, which is `<surname>-<given name>` - and a figure folded over NO records is labeled
synthetic rather than taking the `computed`/`high`/not-a-demonstration standing an empty derivation
reports (`fu-empty-fold-provenance`). Every figure summarizing MORE than one record folds over all of
them (`foldAccountBalances`, the four summary cards): a total that publishes one contributor's record
provenance claims a cleanliness the sum does not have, so both surfaces label one sum one way. No
metric-class figure reaches a screen outside `<Metric>` - the directory's health badge carries the
BAND WORD and the panel's factor cards a band, a bar and a sentence, because a bare
demonstration-derived score carries no watermark (D-200). The directory's world-derived rows AND each
household's folded origin are built once per worldDigest; only the fold over the caller's own
authorized book is per request.
The domain configuration schema (v3 prompt 10, ADR-0056) makes a decision DOMAIN data:
`src/domain/config/` holds the thirteen-section grammar, the seven-stage loader (inert -> grammar ->
reference closure -> type check -> coherence -> completeness -> identity; every failure a value, never a
throw), the firm binder, the prompt-9 registry derivation, the plan compiler, the version diff, and the
intake/label projections. The DATA is `config/domains/{account-opening,money-movement}.yaml` plus the
`versions.json` content-hash pins; exactly one module reads that directory
(`src/infrastructure/config/domain-config-source.ts`), and what a configured `commandType` DOES - its
span, SQL and audit action - lives in `src/infrastructure/execution-adapters.ts` as static literals the
observability fence still derives from real call sites. [`docs/domain-config.md`](./docs/domain-config.md)
is the normative contract; [`docs/domain-config-gaps.md`](./docs/domain-config-gaps.md) is the required
gap report. Load-bearing rules an agent trips over:
- **THE GRAMMAR RULE:** every non-label string is an id from a closed vocabulary, and every composite
  value (conflict/idempotency keys, command payloads, copy) comes from the closed SEGMENT GRAMMAR. The
  ONLY interpolation in the system is `{slot:…}`/`{context:…}`; any other brace is a load error.
- **A domain is DATA, never a module.** `src/domain/workflow/flows/account-opening.ts` is DELETED
  (ADR-0010 amended); the shipped `/app/account-opening` flow and its form are COMPILED from the YAML, so
  deleting that file breaks the live journey (X-9; proof log PF-251). Invariant 3 is active on the
  `domain-configuration` fence, whose forbidden vocabulary DERIVES from the published documents' own ids.
- **Tenancy enters once,** at `bindDomainConfig(loaded, firmRegistry)`; the document may not carry a
  `firmId` anywhere. A parameter needing a tenant-scoped ref uses the one `{ $ref: { kind, class } }`
  placeholder, and never in a key-shaping parameter (D-184/D-185).
- **Never name a Zod schema type (or any deeply recursive type) in an exported `src/domain/` signature**
  (D-193): the sealed-authority fences expand parameter types structurally and a schema generic makes
  that walk exhaust its heap - the worker DIES mid-file and vitest reports a partial run, not a failure.
  Export named types and narrow ports; each section module carries a collapsed-export note.
- Editing a published document without bumping its `version` fails the build; update `versions.json` and
  `authorship.changeFromParent` (checked against the bytes) in the same commit.

The walking skeleton (v3 prompt 3, D-036) lives at `/app/demo` (launcher + `/app/demo/[station]`):
typed view models `src/app/demo/model.ts`, fake service `src/app/demo/journey.ts` + `build-*.ts`,
branch data `src/app/demo/data.ts` fenced EQUAL to scenarios.yaml, and surfaces under
`src/app/demo/surfaces/` fenced to import only view models + presentation (both rules:
`src/__tests__/fitness/demo-skeleton-honesty.test.ts`). Gate 0 surface completeness is fenced by
`src/__tests__/fitness/demo-surface-completeness.test.ts`, which binds the normative section 4 list to
the exact twelve surface identities in the SHA-pinned ratified demo contract, the typed manifest, each
route case's imported component and exact journey view model, its resolved identifier spread without
overrides, the dynamic page's reachable return, and policy authoring's query-derived approval input,
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
`pnpm corpus:{generate,validate,report}` (replay corpus; `validate` is the blocking `corpus` gate) ·
`pnpm world:{generate,validate}` (populated world; `validate` is the blocking `world` gate) ·
`pnpm fixture:check` (clean slate; the same `world` job runs it on a fresh store and again with
`--report --expect-rows` after `pnpm db:seed`). All gates
also run in `.github/workflows/ci.yml` (blocking, never advisory). Node 22 in CI (`engines` floor ≥20);
the house-CRM store is PGlite (real Postgres) in dev/CI behind the store interface (`SqlDb` in
`src/infrastructure/store/db.ts`), managed Postgres in prod.
`pnpm test` runs `scripts/fitness-tests.ts` - the SAME owned entry point the blocking CI test job
invokes directly, so local and CI run one gate. It executes the complete suite and recursively
enumerates every Vitest-admitted fitness extension through the same matcher used by Vitest (the config's
fitness include is derived from those exported constants), requiring a per-file result even if include
or exclude configuration drifts. `pnpm test:vitest` is the bare suite without the inventory. The
complete-suite and v3 runners associate results only by exact canonical repository-relative path and
reject duplicate exact results.

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
  A new column's DEFAULT cannot answer for rows that already exist: a marker column a GUARANTEE reads
  (`record_origin`, migration 9) BACKFILLS the rows already in the store from whatever marker they were
  written with, or the guarantee fails open on every upgraded store while CI's virgin data directory
  walks only the bootstrap path (D-202). Each backfill is its OWN version (10,
  `record-origin-backfill`, for the world's rows; 11, `demo-tenant-record-origin`, for the demonstration
  org and its two demo users, which no provenance condition can name and which re-seeding skips), never
  an edit to a version that shipped: the ledger matches `(version, name)`, so appending to a shipped
  version reaches every store EXCEPT the upgraded ones the repair exists for (D-217, D-219). Those two
  and their limits - including `decision_ledger`, which the append-only trigger puts beyond ANY
  backfill - are stated in `store/record-origin-migration.ts`; a data-correcting version says where its
  reach stops. The demonstration identity both the seed and migration 11 key on is named once in
  `store/demo-tenant.ts`.
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
  neutralizers invoked through `bind`, `call`, `apply`, or direct and bound `Reflect.apply` values and
  transitively invoked local helpers, follows static `Reflect.get` reads of neutralizers and hooks, and
  fails closed on unresolved local callable indirection and unresolved computed Playwright members,
  proves Playwright forbids focused exclusion and
  selects the required specs, derives the complete Next `page.tsx` inventory, and binds every public,
  authenticated, and demo route to its loaded-state
  scan. Required callbacks admit only their typed loops and canonical uninstrumented login call with
  explicit `PRINCIPAL`; the login helper has exactly two plain required parameters.
  Required specifications may register no Playwright hooks or invoke Playwright neutralizers. The same
  hook, neutralizer, and Axe-runtime prohibitions
  cover every named root and their complete runtime local import graph, including side-effect imports and
  TypeScript path aliases; unresolved, unclassified, non-literal, and indirect CommonJS runtime imports
  are non-evidence, as is ambient `process.getBuiltinModule("module")` loader construction. Required route collections cannot be supplied
  through reassigned aliases, and conditional callback exits before a scan make the proof non-evidence.
  Required specs cannot import the Axe runtime, and the sanctioned helper cannot carry module-scope
  executable instrumentation, executable parameter defaults, or anything but exactly two plain
  parameters and the side-effect-free `{ page }` builder configuration. Charter-drift uses symbol-aware Vitest registration analysis for computed,
  aliased, namespace, global, `suite`, x-prefixed, todo, fails, skipIf, and runIf neutralizers while
  preserving locally shadowed application callables. Registration option objects and unshadowed
  `globalThis` and Node `global` paths are included. A `.each`/`.for` case collection is refused when
  PROVABLY empty (empty literal, empty direct-frozen literal, empty tagged rows); a derived or spread
  collection defers to its fence's own contract - the corpus fences iterate the injected corpus world's
  classes, non-empty by construction (ruling `g8-relight-askuser` 2a). Registration option inputs keep
  the immutable rule, and a reassigned or disagreeing identifier string fails closed everywhere the
  analysis resolves one. A fitness callback may not reach `skip`/`todo` on its TestContext, and aliasing
  or dynamically membering the context fails closed. Fitness registrations must be reachable at module
  scope or directly inside an enabled reachable module-scope suite callback. Every fitness entry's
  complete local runtime import graph is inspected, and imported helpers may not import Vitest or
  register tests - `_corpus-world.ts` is the ONE reviewed exception, permitted exactly `{ inject }`
  (D-175/D-176). Higher-order callable
  values are propagated through reachable imports and re-exports. Stable global intrinsic aliases stored
  in object properties are resolved, while incomplete computed property provenance fails closed. Axe route collections are non-empty declarative frozen literals;
  page coverage is credited only to the winning Next route. Hook provenance follows object-property
  callables, member writes, direct or aliased `Object.assign`, `Object.defineProperty`, and `Reflect.set`
  mutations, and unresolved reflective or computed
  ambient CommonJS loaders are non-evidence. Vitest registrations invoked through `Reflect.apply` or
  obtained through `Reflect.get` remain visible across conditional, logical, and sequence callables and
  every initializer or preceding assignment source; unresolved reflected members and sources fail closed.
- **Displayed metrics (balances, health scores, counts) go through `<Metric>` / `DisplayMetric`**
  (`src/contracts/metric.ts`, `src/app/presentation/metric.tsx`) — the `metric-provenance` fence fails the
  build on a naked metric-field render (a field marked `display:"metric"` in the data dictionary rendered
  in JSX without provenance). A value computed from any synthetic input auto-becomes a watermarked
  "demonstration" via `deriveArtifactProvenance` and is refused by `canFeedComplianceDecision`
  (charter #3 extension, ADR-0022). Seeding the populated world / building compliance-scan must use these.
- **Product UI composes the canonical presentation primitives, never feature-local recipes.** Core
  controls, cards, badges, pills, and empty states live in `src/app/presentation/ui.tsx`; compact sorted
  and virtualized registers live in `src/app/presentation/table.tsx`; interactive leaves stay in their
  focused siblings under `src/app/presentation/`. The `presentation-primitives` fence rejects native
  feature buttons and repeated button, badge, or pill recipes with `file:line`, including ones spelled
  as interpolated templates or exported class-string constants; an element that cannot BE a primitive
  (a Next `Link` wearing the button recipe) takes `buttonClassName()` / `cardClassName()`. Its escape
  list is EXACT-PATH, so renaming or splitting a primitive file fails the staleness guard rather than
  silently exempting nothing. `Table` columns are unsortable by default and sortability is opted in
  one column at a time: a register of a SET of cases may be sortable, a register of a SEQUENCE of
  causes (execution timeline, precedence trace) may not (D-196). A sortable register must be reviewed
  into `register-sortability`'s registry with the visible column that carries recorded order, must
  declare its own short `regionName` (a caption asserting an order cannot double as a landmark name,
  D-201), and any cell it sorts must offer RAW typed data - `compareSortValues`
  (`presentation/table-order.ts`) is the tier's one ordering, and formatted text collates as text.
  A foundation primitive may sit callerless ONLY as a named deferral in `PORT-LEDGER.md` citing the
  front-end prompt that lands its first caller, and that prompt is its EXPIRY - a real caller or a
  deletion, never a re-deferral (ADR-0056 amends ADR-0012's port-on-first-use rule this narrowly and
  no wider; the five current rows are in D-192). Nothing else may land ahead of its surface.
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
  `scripts/*.ts` (top-level runners plus their shared library files), NOT `scripts/**/*.ts`, so a never-referenced
  export under `scripts/corpus/`, `scripts/v3-gates/`, or any future subdirectory now fails the dead-export gate. Build-time
  tooling is a legitimate home for generators — it is not an unmeasured one. `src/__tests__/**` is still
  in no bucket: that gap is DEFERRED, not exempt (D-172, follow-up `fu-corpus-test-tree-budget`).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
