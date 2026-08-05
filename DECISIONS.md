# DECISIONS.md — the decision journal

Per the charter's DECISION PROTOCOL: reversible decisions proceed without stopping but are logged here
(what, why, alternatives considered, revert path). Irreversible/architectural decisions stop and ask the
captain via a `needs-decision`; their answers are recorded here too. A decision that is neither logged
nor asked is a defect.

Format: `ID · date · [captain-decision | reversible] · decision`.

---

## Captain decisions (irreversible/architectural — asked via the read-back gate)

Source: `PLAN.md` read-back gate → captain review 2026-07-18 (recorded in the task's
`captain-decisions.md`). PLAN.md APPROVED.

### D-001 · 2026-07-18 · captain-decision · Production DB = PostgreSQL, behind the store port
**Why:** real per-tenant row-level security for `org_id` isolation, mature triggers for append-only
audit, PITR backup/restore for RPO/RTO, scales past pilot without a rewrite — the $1B/SOC2 bar.
**Alternatives:** libSQL/Turso (Iris-proven, simpler) — rejected; its own ADR-0004 defers "real RLS".
**Revert path:** the store hides behind `StorePort`; swapping engines is an adapter change, not a remodel.

### D-002 · 2026-07-18 · captain-decision · Auth = build real credential+session auth now, behind an identity port
**Why:** satisfies "real auth in the skeleton, no secret fallbacks" (charter #12) immediately; avoids an
external dependency for the foundation + falsification session; keeps a WorkOS/Auth0 swap a later adapter.
**Alternatives:** adopt WorkOS/Auth0 now — rejected (external dep + cost before needed).
**Revert path / un-defer trigger:** add a provider adapter behind `IdentityPort` when the first enterprise
customer requires SAML/SSO.

### D-003 · 2026-07-18 · captain-decision · Hosting = container-platform class (managed Postgres + queue)
**Why:** rule 16 needs a stateless app tier + queue-backed work with backpressure; rule 11/14 need
health/readiness + backup-restore + OTel. Final platform pick (Fly/Render/Cloud Run/ECS) waits for the
deploy gate. **Revert path:** deploy target is configuration; the app tier is stateless by design.

### D-004 · 2026-07-18 · captain-decision · Brand = keep "Verin."
Code name and wordmark stand until the captain names the real brand. **Revert path:** a wordmark string
+ a copy pass.

### D-005 · 2026-07-18 · captain-decision (scope directive) · Port the feel; DEFER the populated demo world
Captain annotation: *"I want the feel, but no fake data (yet)."*
- **Port the feel fully:** design tokens, fonts, "Verin." wordmark, micro-components, WhyBubble doctrine,
  presentation-tier budget.
- **DEFER** seeding the rich populated demo world (Meridian's named households/personas/computed-health
  719-line fixture). **Un-defer trigger:** the first demo milestone — the same milestone that un-defers the
  tour/narration/recorder engines. Planned in the demo-tier ADR ([[adr-0012]]) and catalogued in
  `PORT-LEDGER.md`.
- **Minimal, clearly-labeled functional seed IS required** for the walking skeleton, its Playwright specs,
  the house-CRM console, and the load-test gate. Every seeded row carries `source=verin-crm`, `asOf`, and
  visible provenance (charter #3). This supersedes any charter wording like "seeded with the populated
  world"; reconciliation recorded, not stopped.

---

## Reversible decisions (mine — logged, proceeding)

### D-006 · 2026-07-18 · reversible · PGlite as the concrete Postgres store adapter for dev/CI
Implements D-001. PGlite is real PostgreSQL (WASM), durable, supports PL/pgSQL append-only triggers
(verified) and `sha256` for hash-chaining. Production swaps to `node-postgres` behind the same
`StorePort`; SQL/DDL/triggers are portable Postgres. **Why:** hermetic, real-Postgres-semantics tests
with no Docker/service flakiness; keeps the store swappable. **Alternatives:** Docker Postgres service
(heavier, flakier locally); pg-mem (not real Postgres, no triggers) — rejected. **Revert:** implement the
`node-postgres` adapter; both live behind `StorePort`.

### D-007 · 2026-07-18 · reversible · Node built-in `crypto.scrypt` for password hashing
**Why:** zero native dependency (supply-chain minimal), memory-hard, standard. **Alternatives:** argon2id
via `@node-rs/argon2` (prebuilt) — a reasonable upgrade, deferred. **Revert:** swap the hashing function
behind the identity port's credential verifier.

### D-008 · 2026-07-18 · reversible · Toolchain pins — pnpm (corepack), ESLint 9.x, TypeScript 6.x
ESLint pinned to 9.39.5 because typescript-eslint 8 is incompatible with ESLint 10's scope-manager
(`scopeManager.addGlobals` crash). TypeScript pinned to 6.0.3 (not the new Go-based TS 7) for tooling
compatibility (matches the proven Iris stack; within typescript-eslint's peer range). **Revert:** bump
when the ecosystem catches up.

### D-009 · 2026-07-18 · reversible · Hash-chain audit ON TOP OF Postgres append-only triggers + outbox
Reconciles charter #13 (tamper-evident, hash-chained) with report do-again #34 (append-only triggers +
outbox). Both: DB-level UPDATE/DELETE forbidden AND an app-computed hash-chain re-verified by a scheduled
CI job. **Revert:** the chain columns are additive; triggers stand alone if the chain is dropped.

### D-010 · 2026-07-18 (corrected 2026-07-19) · reversible · Load-gate interpretation of "1,000 households × 2,000 accounts"
Read as 1,000 households and ~2,000 accounts total (≈2/household) for the CI pilot-scale gate. The PR
gate AND the nightly scheduled job currently run the SAME pilot-scale `pnpm load:smoke` (the earlier
wording claiming a fast-subset/full-scale split described a split that was never built — corrected here
and in `scheduled.yml`; nightly scale-up is deferred as D-018). The scale-ladder ADR documents 10×/100×.
**Revert:** adjust the seed size + cadence (config).

### D-011 · 2026-07-18 · reversible · `geist` font package instead of `next/font/google`
**Why:** self-contained (no build-time Google Fonts fetch) → reproducible, network-free builds — the
enterprise/supply-chain posture. **Revert:** switch to `next/font/google` (one file).

### D-013 · 2026-07-18 · reversible · Dead-export gate treats `domain/schema` as vocabulary (like `contracts/`)
The canonical schema (`src/domain/schema/*`: entity types, data dictionary, SF mapping, survivorship) is
declarative shared vocabulary consumed flow-by-flow — the same character as `contracts/`, which the charter
explicitly exempts from the dead-export check. So `knip` treats it as an entry root. The gate still fully
covers all business logic and UI in `app/`, `infrastructure/`, and non-schema `domain/` (the real
built-but-not-shipped risk). **Why:** the entities are forward-referenced within the foundation (Phase E
store/flow/console consume them); flagging vocabulary as dead is a false positive. **Revert:** remove the
`src/domain/schema/**` entry from `knip.json` once every entity has a runtime consumer.

### D-012 · 2026-07-18 · reversible · SAST = semgrep; secret scan = gitleaks; both blocking
Charter #15 says "SAST (semgrep-class)" and "secret scanning (gitleaks-class)", "none advisory". Both are
hard CI gates (no `continue-on-error`), unlike Iris's advisory CodeQL. **Revert:** swap rulesets/tools.

### D-014 · 2026-07-19 · captain-decision · Audit/OTel actor = opaque userId; email resolved at render
The audit trail and OTel span attributes attribute actions to the user's opaque `userId`, never the raw
email (ADR-0006: "the AUDIT and log boundaries must never see raw PII"). Display surfaces (console,
audit view, nav) resolve userId → email at render time. Recorded in ADR-0006/0007. **Revert:** a mapping
pass over new entries (old entries keep their persisted actor — the chain is append-only).

### D-015 · 2026-07-19 · captain-decision · Login rate-limiting/lockout DEFERRED; failed logins audited NOW
Failed authentications are recorded through `auditEvent` (`session.login_failed`, attributed to the
matched account's org/userId; unknown emails are logged), closing the repudiation gap. Rate limiting,
lockout, and per-IP throttling are deferred per ADR-0008. **Un-defer trigger:** before the first pilot
with real users.

### D-016 · 2026-07-19 · captain-decision · Schema versioning DEFERRED → EXECUTED (see D-029, deep-review #6)
`migrations.ts` originally stayed a single idempotent DDL script with no schema-version table. **Un-defer
trigger (FIRED):** the FIRST real schema change - deep-review r6 finding #6's text→timestamptz + FK/index
hardening - introduced a versioned migration mechanism instead of editing the DDL in place, exactly as this
trigger required. Executed in D-029: `runMigrations` + a `schema_migrations` ledger; the file header now
documents the mechanism.

### D-017 · 2026-07-19 · captain-decision · Scheduled chain-verify runs against a seeded store (persistent-store evidence deferred)
The scheduled `audit-chain-verify` job seeds a fresh store on an ephemeral runner, so it proves the
verifier executes — not the integrity of any long-lived store. Comments/job names now say so honestly.
**Un-defer trigger:** managed Postgres lands (point the job at the persistent store for dated SOC 2
CC7.4 evidence).

### D-018 · 2026-07-19 · captain-decision · Nightly load scale-up DEFERRED (nightly = the same pilot-scale smoke as the PR gate)
Both runs execute `pnpm load:smoke` at pilot scale (D-010). **Un-defer trigger:** the scale-ladder's
first 10× milestone (ADR-0015) — the nightly job then runs the larger profile the PR gate cannot afford.

### D-019 · 2026-07-19 · captain-decision · SHA/digest-pinning of CI actions + semgrep image DEFERRED (SOC 2 hardening item)
GitHub actions are referenced by major tag and the semgrep container floats `latest`. Pin all actions and
the semgrep image by commit SHA / digest (dependabot keeps them bumped) as a SOC 2 supply-chain hardening
item, recorded in ADR-0017. **Un-defer trigger:** SOC 2 Type II evidence-collection window opens, or the
first production deploy — whichever comes first.

### D-020 · 2026-07-19 · captain-decision · Content-Security-Policy DEFERRED via ADR-0021
No CSP header ships this round (a real CSP in Next.js needs a per-request nonce strategy — deliberate
work, not a header one-liner). Recorded in [ADR-0021](docs/adr/0021-content-security-policy-deferral.md).
**Un-defer trigger:** before the first real (internet-facing) deployment.

### D-021 · 2026-07-19 · captain-decision · Pre-suspend flow writes carry idempotency keys; compensation/retry-by-execution-id DEFERRED
`createHousehold`/`createContact`/`createApplication`/`setEsignRequested` now take per-execution
idempotency keys (`<step>:<executionId>`), so a retry of the SAME execution replays committed writes
instead of duplicating them. Full compensation (rolling back a partially-created execution) and a
retry-by-execution-id recovery path (which would also unwedge the crash window between the suspending
step's commit and the suspended-state save) are deferred in ADR-0011. **Un-defer trigger:** the first
flow whose pre-suspend writes create externally-visible obligations (real custodian/e-sign vendors), or
the first production incident requiring manual flow recovery.

### D-022 · 2026-07-19 · captain-decision · Failed-login timing equalized with a discarded audit-pipeline mirror (no residual enumeration oracle)
Auditing known-account login failures (D-015) added several audit-pipeline DB round-trips that only ran
when the email matched a user — a failure-path timing differential the identity store had deliberately
engineered away. Captain chose EQUALIZE over accept-and-document: the unknown-email branch now runs
`discardedAuditEventWork` (the same enqueue + drain work, rolled back — the enqueue via a sentinel, the
delivery at the real claim-lost guard), so both failure branches cost the same and NOTHING is persisted
(no audit entry may attribute a failure to a nonexistent user). Proven by the audit-chain integration
test (mirror persists zero outbox/chain/anchor rows) and an unknown-email e2e failure-path spec.

### D-023 · 2026-07-19 · captain-decision · Emails canonicalized to lowercase at write and lookup
`createUser` and `findUserByEmail` normalize emails (trim + lowercase), so a case-variant of the same
mailbox can neither split into two identities under `UNIQUE(org_id, email)` nor fail sign-in
(`Alex@Firm.com` registered, `alex@firm.com` typed). This also keeps the deterministic
oldest-account-wins cross-org resolution (ADR-0008) stable. The login-escape SQL in the org-id fence is
unchanged (only the bound parameter is normalized). Proven by the identity integration test.

### D-024 · 2026-07-19 · captain-decision · Poison outbox rows park as dead-letters after 5 failed deliveries
`drainOutbox` retries a failed delivery at-least-once, but a row failing 5 consecutive attempts (corrupt
payload, persistent constraint failure) now moves to a `parked` status that no later drain re-claims,
with a pino error carrying the row id - visible instead of silently churning forever (Vale V14's
dead-letter half; the scheduled drainer remains deferred). Parked rows are excluded from the `/ready`
backlog (they are stuck, not pending delivery); the backlog counts `pending` + `claimed` explicitly.
Proven by the audit-chain integration test (poison row parks at the cap and is excluded thereafter).

### D-025 · 2026-07-19 · captain-decision · Vale V12 CLOSED — displayed-metric→source provenance trace shipped (Wave-1 prereq)
The deferred displayed-metric→source trace (`FOUNDATION.md`; trigger "before any synthetic/estimated value
renders") is closed ahead of the Wave-1 populated-world seed. Mechanism: a `DisplayMetric` type
(`contracts/metric.ts`) that cannot be constructed without provenance and is not a `ReactNode` (so it can
only reach the screen through `<Metric>`), the `<Metric>` surface (`app/presentation/metric.tsx`), and the
build-failing `metric-provenance` fence (RULE A: sanctioned renderers keep provenance required; RULE B: no
metric-class field — derived from the dictionary `display:"metric"` flag — renders in JSX without
provenance). Run in the `provenance-trace` CI gate. **Why:** the populated world renders estimated/derived
values (balances, health scores); charter #3 requires each to trace to a source. **Revert path:** remove
the two fences from `charter-map.json` #3 + `ci.yml`, delete `metric.tsx`/`contracts/metric.ts`, revert the
console metric render; V12 reverts to deferred. Proven adversarially (proof-log PF-018).

### D-026 · 2026-07-19 · captain-decision · Charter #3 EXTENDED to derived compliance artifacts (ADR-0022)
Per the POC strategy directive ("the charter-#3 extension … is non-negotiable"), charter #3 is amended
(additively) so its "synthetic can never feed a compliance decision" rule runs through DERIVED artifacts: a
value computed from any synthetic input is itself a "demonstration" artifact — watermarked, demo-audit-class,
excluded from the real examiner-export. Enforced now: `deriveArtifactProvenance`/`isDemonstration`/
`DEMO_WATERMARK` in `contracts/provenance.ts`, `canFeedComplianceDecision` refuses demonstrations, and the
`derived-provenance` fence proves the law. Demo-audit-class persistence and examiner-export exclusion are the
design contract, deferred to compliance-scan (Wave 1) and examiner-export (Wave 3) respectively, each fenced
in its PR. **Why:** the pre-mortem leak "a demo compliance figure in a real examiner-export." **Un-defer
trigger (watermark removal):** a consenting real design partner supplies real data (ADR-0022 Revisit-When).
**Revert path:** this amends CHARTER.md — reverting requires a superseding ADR (charter operating model);
the code revert is removing the derivation vocabulary + fence and restoring the prior
`canFeedComplianceDecision`. Proven adversarially (proof-log PF-019).

### D-027 · 2026-07-19 · captain-decision · Cross-submit dedup UN-DEFERRED: flow start keys on a client-minted request id (deep-review #10)
The ADR-0011 deferral "cross-submit dedup" is closed: `/api/flows/account-opening` now REQUIRES a
client-minted per-form-session UUID (`clientRequestId`), which becomes the executionId. A double-submit
(network retry, second tab) therefore resolves to the SAME execution — the route returns its current
state (org- and flow-checked, so a guessed foreign id can never leak another tenant's state; the
concurrent-race loser resolves the flow_executions PK conflict the same way) — instead of creating
duplicate households/contacts/applications. Same-execution replay semantics were already in place
(D-021); this puts a stable key in the client's hands. **Alternatives:** a `start:<uuid>` idempotency
scope wrapping only the first write (leaves the application/contact unscoped); server-side payload
hashing (false-dedups two genuinely different submissions with identical fields). **Revert path:** make
`clientRequestId` optional in the route and mint server-side; the wire replay path is inert without a
client id. Proven by the double-submit integration spec (same id → one household + same resume token;
different id → a new execution).
**Final replay semantics (review follow-up):** a replayed id is honored only for an IDENTICAL payload -
a suspended/completed execution reports its current state, and a FAILED one is re-driven from its saved
cursor (`retryFlow`, with any storage throw during the re-drive mapped to a typed AppError, never an
unenveloped 500). A resubmit whose input fields (householdName/firstName/lastName/email/accountType)
differ from the persisted submission is rejected with a typed `CONFLICT` (409) instead of silently
writing the stale values, and the client re-mints its request id after any failed response, so a user
who edits the form and resubmits starts a genuinely fresh execution. Locked by the edited-resubmit
integration specs (CONFLICT on mismatch, no stale write, no duplicate; identical payload still re-drives).

### D-028 · 2026-07-19 · captain-decision · Deep-review quality sweep (r6 findings #2-#5, #9-#14) shipped as one batch
Captain-authorized batch, one PR, each item test- or fence-locked:
- **#2** Finalize OPENS the account: `createFinancialAccount` takes `openDate` (the e-sign `signedAt`
  threaded through the flow payload) and derives `status='open'`; the store now agrees with the UI's
  "Account opened". Locked by integration assertions (`status='open'`, `open_date=signedAt`).
- **#3** `auditedWrite` failure paths: the caught error is logged (with `logLevelFor`) before mapping;
  unknown errors map to INTERNAL/500 (STORE_CONSTRAINT/409 reserved for SQLSTATE class-23 driver codes);
  a void `perform` under an idempotencyKey fails as an explicit invariant (it can neither be cached nor
  replay-detected). Locked by `src/__tests__/integration/audited-write.test.ts`.
- **#4** Audit view: "When" column, newest-first, response capped to the latest 200 + total; the API
  verifies the WHOLE chain and lists from the SAME single scan (`verifyAndListOrgChain`).
- **#5+#9** Observability wired, not ripped out: `otel-provider.ts` registers a NodeTracerProvider +
  OTLP/HTTP exporter when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (ADR-0013 updated); the genuinely-dead
  `lucide-react` removed; knip `dependencies` flipped to `error` (dead deps now fail the build).
- **#11** Threat model T-S3 corrected: HMAC covers the TOKEN; the payload is server-constructed and
  never trusted (doc now matches `esign.ts`/`engine.ts` exactly).
- **#12** no-console fence extended to `src/app/` (server-side files; `"use client"` exempt with the
  browser-console rationale; reviewed-allowlist + staleness guard). Companion cases added; proof PF-020.
- **#13** No fabricated Principal: CRM/application mutations take a narrow `WriteActor`
  (`{orgId, actorUserId}`); the webhook/finalize paths construct one honestly ("this write was driven by
  an external event on behalf of user X") instead of a costume `role:"ops"` Principal that would become
  a forged credential the day port-level role checks land.
- **#14** Housekeeping: `updateHouseholdName` reads its before-snapshot INSIDE the write tx
  (`FOR UPDATE` + late-bound `buildBefore`); speculative exports pruned (`assertNoPII`, `maskValue`,
  `flatMapAsync`, `hasAtLeastRole`+rank table, `isRetryable`; `getHousehold` became dead and was pruned
  too) while `logLevelFor` gained its first real consumer (#3's failure log) — the ERROR_MAP metadata
  stays as the ADR-0002 taxonomy spec; pino redact widened to depth 4 with the limit documented; logout
  reissues the clearing cookie via `sessionCookieOptions()` + `maxAge:0`; `readJsonBody` uses `ok()`.
**Revert path:** each item is a small, independently revertable change; none is schema- or
contract-breaking (the `WriteActor` narrowing is adapter-internal; routes still resolve full Principals
for RBAC).

### D-029 · 2026-07-19 · captain-decision · Store schema HARDENED + versioned migrations UN-DEFERRED (D-016 trigger, deep-review #6)
Executed while there is no production store to migrate (dev/CI stores are ephemeral/reseedable), so the
whole change is one DDL edit rather than a post-deploy migration project. Three parts, one PR:
- **timestamptz everywhere.** Every temporal column (`created_at`, `expires_at`, `revoked_at`,
  `prov_asof`, `open_date`, `due_date`, `updated_at`, `claimed_at`, `applied_at`) is now `timestamptz`,
  not `text`. The app boundary is UNCHANGED - writers still emit `toISOString()` and the data dictionary
  still types these `IsoTimestamp`; the driver serializes the ISO string and a `timestamptz` read-parser
  in `db.ts` (Postgres OID 1184 → `new Date(v).toISOString()`) normalizes reads back to a canonical UTC
  ISO string. This makes ordering and the `claimed_at < $2` reclaim comparison (`audit-store.ts`)
  instant-correct instead of lexicographic on whatever offset a writer emitted, and it round-trips
  byte-for-byte so the audit hash chain (which hashes `created_at`) still verifies.
- **Foreign keys.** `contacts.household_id` and `financial_accounts.household_id` → `households(id)`;
  `sessions.org_id` → `orgs(id)`. Orphaned contacts/accounts/sessions are now rejected by the store.
- **Indexes.** `contacts(household_id)`, `financial_accounts(household_id)`, `sessions(user_id)` - the
  lookups the household detail view (#1) and the load gate issue.

**Versioned-migration mechanism (the D-016 trigger).** `migrations.ts` is now an ordered `MIGRATIONS`
list (version 1 = the hardened baseline) plus `runMigrations(db)`, which applies every not-yet-recorded
version in order and records it in a `schema_migrations` ledger, each version's DDL + its ledger row in
ONE transaction. Future schema changes APPEND a `{version, name, sql}` entry instead of editing shipped
DDL in place. The org-id-required fence classifies `schema_migrations` NON_TENANT (global infra table).
**Locked by** `src/__tests__/integration/store-schema.test.ts` (FKs reject orphans; timestamptz orders by
instant + normalizes reads + the reclaim predicate; the ledger records versions and is idempotent);
adversarial proof PF-021. **Revert path:** the change is additive DDL against an empty store - revert the
column types/FKs and drop `runMigrations` back to a single `db.exec(MIGRATION_SQL)`; only meaningful
before the first prod deploy, which is exactly why D-016 fired now.

### D-030 · 2026-07-20 · reversible · Session lifecycle: sliding renewal + id rotation + cleanup (charter-#12 gap closed, deep-review #8)
The walking-skeleton session was expiry-only: a hard 60-minute logout landed mid-workday regardless of
activity, expired/revoked rows accumulated forever, and charter #12 named "rotation" while ADR-0008 recorded
no rotation deferral (an unrecorded charter gap). All three are now handled inside the single identity-read
chokepoint, so the auth fences hold unchanged:
- **Sliding renewal.** A resolved session past the halfway mark of its TTL has `expires_at` extended by a
  fresh full TTL and its cookie re-set (`resolveAndRenewSession`). Driven off the already-selected
  `expires_at` + config TTL, so the pinned identity-read SELECT (org-id-required reviewed escape) is
  unchanged. Read-only callers that cannot set a cookie (the server-component `/app` guard, logout) use
  `resolveSession` and never rotate; the mutating/API chokepoint (`requirePrincipal`) applies the returned
  rotated cookie via `cookies().set()`.
- **Rotation on renewal.** Each renewal issues a NEW opaque id in one atomic `UPDATE` (id + `expires_at`
  together; nothing references `sessions.id`), mitigating fixation and satisfying the charter's "rotation".
  `created_at` is preserved (a future absolute-lifetime cap).
- **Opportunistic cleanup.** A rotation sweeps sessions expired/revoked more than one TTL ago
  (`deleteDeadSessions`), backed by a new `sessions(expires_at)` index shipped as migration **version 2**
  through the existing versioned-migration mechanism (D-016/D-029) - not an in-place DDL edit.

**Alternatives:** a grace/overlap window so a pre-rotation cookie still resolves briefly (deferred - no
concurrent same-cookie requests exist yet; recorded in ADR-0008 with a trigger); auditing every rotation
(rejected - an audit entry every half-TTL per active user; login create + logout revoke still bracket the
episode; deferred in ADR-0008). **Locked by** `src/__tests__/integration/session-lifecycle.test.ts` (real
PGlite: renewal extends, rotation changes the id, cleanup deletes only long-dead rows; each adversarial),
proof PF-022, and an end-to-end HTTP verification (cookie rotated + session survived past the original hard
expiry at a 2-min TTL). **Revert path:** drop `resolveAndRenewSession`/`renewSession`/`deleteDeadSessions`
and point `requirePrincipal` back at `resolveSession`; the v2 index is additive and harmless if left.

### D-031 · 2026-07-26 · captain-decision · v3 architecture RATIFIED; Salesforce deferred; money movement Phase 1; established design language
Four rulings from the captain's v3 ratification (recorded in `docs/v3/marriage-map.md`, implemented by
ADRs 0023-0028): (1) the v3 direction - Verin as the governed decision and execution layer, the decision
spine, and the 30 §17 invariants as phase-gated commitments - is adopted INTO the charter machinery
(ADR-0023; one constitution, never two). (2) Salesforce directive (2026-07-26): "Salesforce MCP is going
to have to wait, let's do everything else we can without that" - prompts 27/28's real path are DEFERRED,
un-defer trigger = sandbox access granted; in-memory fakes carry every wave; Phase 1 is never declared
complete on fakes (ADR-0024). (3) Money movement is the Phase 1 vertical, superseding read-flows-first
Wave 1 (ADR-0025). (4) Design directive (2026-07-26): the ESTABLISHED Verin design system is normative
for all demo UI; v3's visual prescriptions rejected; v3's UX semantics re-expressed via a
docs/demo-design-language.md authored from the existing presentation tier (ADR-0028). Stack deviations
from v3 §18 (keep Postgres/D-001, Next.js, ts-morph fences; FirmId ≡ org_id) recorded in ADR-0026;
Wave 0 labeled-fakes reconciliation with charter #5 in ADR-0027. The queued p2-p7 demo chain is
superseded by the re-baselined 30-prompt sequence (marriage-map §6).
**Revert path:** captain re-ruling only; each ADR names its own Revisit When triggers.

### D-032 · 2026-07-26 · reversible · v3 invariant registry as a SIBLING of charter-map.json; runner executes fences rather than trusting stored status
Mechanics of the ratification PR ("prompt 0"): (a) the 30 invariants live in `v3-invariants.json`, a
sibling registry, NOT as 30 new charter-map entries - charter entries are all-active and ratcheted,
v3 invariants are phase-gated with activation states; the charter-drift fence still sees the new fences
via two new operatingModel entries (`v3-direction-ratified`, `v3-invariants-phase-gated`), both added to
its ratchet list. (b) HONESTY RULE: the registry stores ONLY `active`/`not-yet-active`; pass/fail is
computed by `scripts/v3-invariants.ts` (CI job `v3-invariants`), which RUNS each active invariant's
mapped fitness fences via vitest and fails on active-fail - a stored PASS would be the false-pass class
charter #4 exists to kill. Fenced by `v3-invariants.test.ts` (registry integrity: 30 present,
activation-only statuses, active ⇒ runnable mechanism, not-yet-active ⇒ named trigger, activation
ratchet [2, 5]). (c) Every ratified doc under docs/v3/ is SHA-256-pinned in the registry, verified by the
`arch-version` fence AND re-verified by the runner (prompt 4's architecture-checksum idea). Active today:
invariant 2 (tenant scoping → org-id-required fence) and invariant 5 (append-only ledger →
audited-write-required fence + audit_log triggers + audit-chain-verify gate), per marriage-map §2.
**Revert path:** delete the registry + runner + two fences + CI job + charter-map entries and the two
ratchet ids; the ratified docs and ADRs stand independently.

### D-033 · 2026-07-26 · reversible · Dependency-audit remediation: next 16.2.12 + pnpm overrides for advisory-flagged transitives + minimatch@3 patch
The dependency-audit CI gate (`pnpm audit --audit-level=high`) flagged 9 high advisories. Remediation:
(a) `next` 16.2.10 → 16.2.12 (`eslint-config-next` kept in lockstep) clears the four Next.js advisories.
(b) next 16.2.12 still pins vulnerable transitives, so `pnpm.overrides` force the advisory-patched
versions using range-scoped selectors that self-expire once upstream catches up: `sharp@<0.35.0 → 0.35.3`,
`postcss@<8.5.18 → 8.5.23` (next pins 8.4.31; our direct 8.5.20 devDep is already clean and untouched by
the selector), `brace-expansion@<5.0.8 → 5.0.8`, and `tar@<7.5.21 → 7.5.22` (moderate, dev-only via
cdxgen, cleared for a fully green audit). (c) brace-expansion 5.x exports `{ expand }` (named, CJS) while
minimatch@3 - vendored by eslint 9, which is pinned per the ESLint-10 incompatibility note - expects
`module.exports = expand`; no fixed minimatch 3.x exists, so `patches/minimatch@3.1.5.patch` unwraps the
namespace (`typeof`-guarded, works with both shapes). Proven at runtime: `pnpm lint` fails with
"expand is not a function" without the patch, passes with it.
**Revert path:** each override deletes independently once its upstream consumer bumps past the advisory
range (the range-scoped selector then matches nothing); the minimatch patch deletes when eslint moves
off minimatch@3 or a fixed 3.x ships.

### D-034 · 2026-07-26 · captain-decision · Phase 1 demo contract landed as committed product truth (v3 build sequence, prompt 1)
The captain-authored demo contract v1 (the 7-minute "Smiths $75k" journey, Firm A/B as pure
configuration, the 12 scenario branches, the provenance-label taxonomy, the measured-proof and §8
completion rules) is committed as `docs/demo-contract.md` with exactly two integrated captain
annotations (both rulings dated 2026-07-26), plus its machine-usable companions
`config/demo/scenarios.yaml` (scenario matrix, state vocabulary, firm parameter sets, per-element
simulated-vs-real marking) and `docs/demo-contract-checklist.md` (timeline moment -> surface ->
visible proof -> LedgerEntry artifact). Docs + inert config data, shipped with the fence charter #1
requires for the invariants the data states: `src/__tests__/fitness/demo-scenarios-contract.test.ts`
(registered in `charter-map.json` as `demo-contract-as-data`, proof PF-025) build-enforces the
scenarios.yaml stability contract (append-only stable ids, never renamed/reused), the inert-data
rule (plain YAML scalars/maps/lists only, no tags), and every internal cross-reference
(dispositions/exercises -> state vocabulary, element reality labels -> provenance taxonomy,
deferred elements -> elements, both directions). No product code.
- **Salesforce deferral.** Everything requiring the REAL managed-Salesforce invocation is marked
  `[deferred-pending-sandbox]`; un-defer trigger = sandbox access granted. All other elements run on
  labeled fake adapters now. §8 stays honestly gated: the demo may run end to end on labeled fakes
  but Phase 1 is never declared complete on them (orchestrator rule 6). The C4 charter-amendment ADR
  formalizing this deferral is a separate ratification task, not this one.
- **Design language.** All demo UI derives its look from `docs/demo-design-language.md` (being
  authored in parallel from the ESTABLISHED Verin design system - OKLCH slate, Geist, presentation
  tier); v3's visual prescriptions are not adopted, v3's UX semantics (Decision Spine, disposition
  treatments, approval-invalidation moment) are kept.
**Why:** prompt 1 of the ratified v3 sequence requires the contract as reviewable product truth
before fixtures, golden cases, or UI exist; the two annotations record captain rulings instead of
silently diverging from the captain's v1 text.
**Revert path:** delete the three files together with their enforcement wiring - the fence
`src/__tests__/fitness/demo-scenarios-contract.test.ts`, the `demo-contract-as-data` entry in
`charter-map.json`, and its line in charter-drift's `RATCHETED_ENFORCED_IDS` (the ratchet makes that
removal a charter-ADR matter, per charter-drift (e)) - drop the now-unused `yaml` devDependency, and
delete this entry. No product code imports any of it (consumers are later prompts 2, 3, 11, 29).

### D-035 · 2026-07-26 · reversible · Golden-case truth set drafted (v3 build sequence, prompt 2) - 16 cases, ALL pending-captain

The prompt-2 minimum truth set lands as `docs/golden-cases.md` + `fixtures/golden/*.json` (16 cases:
the twelve spec-enumerated ones - two of them two-sided, so "recent bank change" = GC-03/GC-04 per
firm and "two simultaneous distributions" = GC-10/GC-11 winner/loser - plus GC-15
approval-invalidation and GC-16 specialist-review-expiration, completing the demo-contract §5 branch
coverage). Every case states trigger, firm configuration, household evidence, policy versions,
household instructions, and the six expected planes (disposition, authority stages, execution
eligibility, explanation nodes, ledger events, verification state), aligned by construction with the
scenarios.yaml vocabularies (D-034, append-only ids untouched) and the v3 core-contracts type names.
Enforcement per charter #1: shared validator core `scripts/golden-cases.lib.ts`, human-readable CI
runner `pnpm golden:validate` (blocking job `golden-cases`), fitness fence
`src/__tests__/fitness/golden-cases.test.ts` (registered as `golden-cases-truth-set`, ratcheted),
proof PF-026.
- **Signoff honesty.** Every case's signoff is initialized `pending-captain` with null attribution;
  the drafting agent may not sign. The validator admits exactly two shapes (pending-captain /
  signed-with-attribution), so the captain's future signing PR stays green while an agent-invented
  in-between state fails the build. Expected results are product truth subject to captain signoff,
  not agent invention.
- **Answers drafted where the contract was silent (flagged in the fixtures' signoff notes,
  awaiting the captain):** Firm B sub-$100k authority = automatic (GC-02); post-invalidation rule =
  re-evaluate on the new bundle, still-proceed re-runs the SAME stages against the NEW decision hash
  (GC-15, fixing the question scenarios.yaml explicitly deferred to prompt 2); single-request
  insufficient liquidity = resolvable block with `scenarioRef: null` (no matrix branch exists for
  it; the matrix is append-only and a new branch is a captain-approved contract change); regulatory
  prohibition modeled as an active legal hold (GC-07); reserve-material freshness window = 30 days
  (GC-09); GC-13 partial-Salesforce carries `deferred-pending-sandbox` per the standing directive.
**Why:** prompt 2's acceptance is that the engine is later judged against explicit domain outcomes
instead of self-generated tests; landing the truth set fenced-and-pending keeps the branch honest
while the captain reviews the §2 summary table.
**Revert path:** delete `docs/golden-cases.md`, `fixtures/golden/`, the two scripts, the fence, the
`golden:validate` script + `golden-cases` CI job, the `golden-cases-truth-set` charter-map entry and
its ratchet line (a charter-ADR matter per charter-drift (e)), and this entry. Nothing else imports
them (consumers are later prompts 11, 16-19, 28).
**Addendum (2026-07-26):** the captain signed all 16 cases as drafted (approval relayed via
firstmate); every fixture's signoff is now `signed` / `captain` / `2026-07-26`, and their expected
outcomes are binding product truth per the §1 protocol.

### D-036 · 2026-07-26 · reversible · Walking skeleton: twelve demo surfaces clickable on labeled fakes (v3 prompt 3, Gate 0)

The full demo surface sequence (demo contract §4, all twelve) ships as a navigable Next.js
App Router experience under `/app/demo` (auth-guarded like every /app surface), built ONLY from
typed view models on static contract data - the walking skeleton the v3 sequence requires before
the engine exists (re-baselined per marriage-map §6: App Router + the existing presentation tier,
NOT the old doc's React/Vite).
- **Typed UI state model** (`src/app/demo/model.ts`): every rendered state - spine stations,
  dispositions, blockers, approval stages, execution statuses, comparison rows - is data on a
  view model. Components have no decision branches; the recorded disposition comes from
  `src/app/demo/data.ts`, which mirrors `config/demo/scenarios.yaml` and is FENCED equal to it.
- **Fake service** (`src/app/demo/journey.ts` + `build-*.ts`): composes per-surface VMs per
  (scenario × firm); blocked/prohibited journeys produce NO authority/safety/execution VMs, so
  no surface can render a station the record has not reached (design §4; charter #4 for UI).
- **New presentation primitives** (design §13 register, first render = this PR, charter #5):
  `DecisionSpine`, `DevProvenanceBadge`, `TapToVerify`, `EvidenceRow` (+conflict/missing),
  `DispositionNotice`, `ApprovalStagePanel`, `ExecutionTimeline`, `ComparisonColumns`, the
  `STATUS_STYLES` additions (§5.1 dispositions + §8.2 honest-status vocabulary, each its own
  key), and the §9 print stylesheet in `globals.css` (tokens only).
- **Every fake-backed element carries the visible `DevProvenanceBadge`** (§11.2) with the
  contract §6 taxonomy label; derived figures go through `deriveArtifactProvenance`, so computed
  reserve/headroom values render the ADR-0022 demonstration watermark, and the printable record
  watermarks every printed page via the running header/footer. Badges are removed only in the PR
  that lands the corresponding real path (§11.3).
- **Fence in the same PR** (charter #1): `demo-skeleton-honesty` - RULE A pins skeleton branch
  data equal to scenarios.yaml (ids, firms, dispositions incl. per-firm splits); RULE B allowlists
  surface imports (react/next, presentation, model, contract types, siblings) so surfaces cannot
  import data/service/builders and start recomputing decisions. Adversarial proof in
  `docs/fences/proof-log.md` (both rules injected, failed with file:line, reverted).
- **E2E extended, nothing displaced**: `e2e/demo-journey.spec.ts` walks the seven-minute journey
  end to end by clicking (Gate 0), proves blocked/prohibited/invalidation/duplicate/NIGO branch
  states, runs axe on every surface, asserts a dev badge on all twelve, and captures a screenshot
  per required screen to `demo-screens/` (uploaded as a CI artifact by a new step in the existing
  e2e job).
**Why:** Wave 0 requires the investor experience tangible before backend completion (orchestrator
rule 5), charter-legal via the ADR-0027 extension: typed fakes, labeled provenance, screens
reachable in the same PR, never declared done on fakes.
**Skeleton-scope choices** (flagged for the golden cases / later prompts, not silently decided):
concrete Smiths figures (accounts, $200k cash, $6k monthly withdrawals, $40k pending) are
demo-fixture placeholders until prompt 2's captain-signed golden cases; Firm B's below-threshold
approval stage renders "contract silence" copy rather than inventing a rule; the approval gate and
policy-activation click advance the recorded choreography via routing (no state is written).
**Revert path:** delete `src/app/demo/`, the new presentation primitives + `STATUS_STYLES`/print
additions, `/app/demo` routes + nav/home links, `e2e/demo-journey.spec.ts`, the `demo-screens` CI
step, and the `demo-skeleton-honesty` fence with its proof-log entry.

### D-037 · 2026-07-26 · reversible · Review-fix round on the walking skeleton (captain-authorized, decision keys nm-review-askuser-s6 / nm-review-rerun-copy-s6)

Eight review findings fixed forward, none by weakening a fence. The one contract amendment is
captain-authorized: `specialist-review-expiration` gains the per-firm split firm-a=proceed /
firm-b=blocked in BOTH `config/demo/scenarios.yaml` and `src/app/demo/data.ts` (ids unchanged,
append-only intact), because Firm B's recorded bank-change handling is
block-until-independently-verified - it has no specialist stage to expire, so under Firm B the same
facts land on the recorded block with the independent-verification affordance (mirrors GC-03/GC-04).
The rest: print-hide scoped to app chrome via a class (never a bare `header` selector), so the
record's identity header prints per design §9; `demo-skeleton-honesty` RULE A now rejects any
skeleton per-firm entry the contract does not record and RULE B walks `.ts` alongside `.tsx`
(companions + injection proofs in `docs/fences/proof-log.md`); the printable record renders
`verification.appended` (later arrivals append on paper as on screen) and uses the §5 badge labels
via the shared `DISPOSITION_LABELS` vocabulary in `model.ts`; unknown `?scenario=`/`?firm=` ids 404
in the route page (absent params still default; surfaces stay data-free); and
`changedRerunResult` is disposition-aware from the recorded disposition (proceed / blocked /
prohibited each state only what the contract records).
**Revert path:** revert this round's commit; the D-036 skeleton stands unchanged beneath it.

### D-038 · 2026-07-26 · reversible · Second review round + print-overlap fix on the walking skeleton (decision key nm-review-invalidation-s6)

Two follow-up rounds on the D-036/D-037 skeleton, no fence weakened:
- **Review round 2** (key nm-review-invalidation-s6): the below-threshold single-approver stage in
  `build-decision.ts` mirrors the voided-approval treatment, so the approval gate, safety check, and
  printable record agree under approval-invalidation at Firm B; `demo-skeleton-honesty` RULE B's
  specifier collector now also catches re-exports, dynamic `import()` / `require()`, non-literal
  dynamic specifiers, and traversal specifiers like `"./../data"` (injection proofs in
  `docs/fences/proof-log.md`); the per-surface execution-timeline row mapping is shared via
  `surfaces/shared.tsx` rather than duplicated.
- **Print-overlap fix:** the printable record's running header/footer strips (decision id + the
  ADR-0022 watermark) ride in a `.print-doc` table as repeating `thead`/`tfoot` rows, because
  Chromium repeats those on every printed page AND reserves their space; the prior
  `position: fixed` strips could overlap page content. On screen the table wrapper is layout-inert
  (`display: contents`), so design §9's running-header/footer requirement is met unchanged.
**Revert path:** revert the two commits; the D-036/D-037 skeleton stands unchanged beneath them.

### D-040 · 2026-07-26 · reversible · Decision-core canonical type system landed (v3 build sequence, prompt 5) as Zod-first contracts

The v3 §5 contracts land as `src/contracts/decision-core/` (ids, actor, trigger, evidence,
authority, execution, decision, serialization): Zod strict schemas are the single source, TypeScript
types are `z.infer`-derived, and the invariant-7/8/9 distinctions are PARSE-LEVEL facts - proceed
requires authority + a non-empty execution plan; blocked/prohibited cannot carry either (unknown
keys are rejections, not stripped); a prohibition has no resolving-evidence channel and a prohibited
record admits no revaluation conditions (GC-07: "stays prohibited as recorded"); disposition and
authority never collapse. Tenant scope is structural (TenantContext spine + cross-tenant
intent/attribution refinements, invariant 2's contract-layer half); replay metadata is pinned in
DecisionInputBundle with a versioned canonical serializer whose byte form is locked by
`fixtures/decision-core/` round-trip fixtures. Vocabulary is drift-locked to
`config/demo/scenarios.yaml` (DecisionResult kinds ≡ the disposition state class, asserted in the
unit suite) and to the golden truth set's freshness/duration/reason-code vocab.
**Why:** prompt 5's acceptance is that the type system enforces the major distinctions without
reviewer discipline; landing schemas-first means every later boundary (store, API, ports, LLM)
inherits the guarantees by parsing.
**Enforcement (charter #1, same PR):** fence `src/__tests__/fitness/decision-core-illegal-states.test.ts`
(registered as the mechanism for v3 invariants 7-9, now ACTIVE; ratchet extended to [2,5,7,8,9];
proof PF-027), unit suite `src/__tests__/unit/decision-core.test.ts`, contracts ceiling re-baselined
600→1550 by ADR-0029 (the ADR-0018 amendment path; zod admitted into `contracts/` by the same ADR).
**Alternatives:** land in domain / split types-vs-schemas across layers / trim to fit the 600
ceiling - all rejected in ADR-0029's table.
**Revert path:** delete `src/contracts/decision-core/`, `fixtures/decision-core/`, the fence and
unit suite, flip invariants 7-9 back (a charter-ADR matter - the v3-invariants ratchet makes the
regression loud), restore the 600 ceiling with ADR-0029 marked superseded, and delete this entry.
Nothing else imports the module yet (consumers are prompts 7, 9-19, 25-26).

### D-039 · 2026-07-26 · captain-decision · Decision hashes use explicit preimages; execution plans reject cycles

Captain-authorized review corrections define versioned, domain-separated SHA-256 preimages before
approval and replay consumers land. `bundleHash` covers every material bundle input but excludes
`id` and `bundleHash`; its set-like instruction-version and evidence-snapshot ID lists are sorted.
`decisionHash` covers the complete decision record except `decisionHash` itself. Both projections
enumerate their fields so contract growth cannot silently alter a versioned digest, and canonical
fixtures lock the resulting digest. `ExecutionPlanSchema` now rejects every dependency cycle at the
boundary, because a non-empty but unschedulable graph is not an executable plan under invariant 7.
**Revert path:** remove the two projection contracts and digest assertions, restore the prior fixture
hashes, and remove cycle detection and its fence case; no production approval or replay consumer
depends on these prompt-5 contracts yet.

### D-041 · 2026-07-26 · reversible · Replay boundary hardening closes review findings F2-F5 and F7-F10

`DecisionInputBundle` now admits only the implemented 1.0.0 schema and canonical serializer, validates
its time zone through the runtime's supported IANA data, and freezes both the parsed bundle and its
replay-ID collections. Hash projections derive from exhaustive key lists checked against the inferred
schema keys, while decision preimages omit explicit undefined optional properties so every parsed
record is hashable. Canonical serialization rejects sparse arrays. The dependency fence now permits
only Zod as an external `contracts/` import and rejects non-literal dynamic imports. The ADR-0029
contracts ceiling is re-baselined from 1400 to 1550 through ADR-0018's amendment path after the
review-hardened implementation measured 1446 lines.
**Revert path:** revert the schema, serializer, projection-key, dependency-fence, and focused test
changes together, then restore the 1400 ceiling and its ADR references.

### D-042 · 2026-07-26 · reversible · Decision-core mutation, projection-growth, import-form, and duplicate-ID gaps closed

Every parsed decision-core object and nested collection is now recursively readonly and frozen, so
post-parse mutation cannot empty a plan, create a cycle, alter authority, or change hash-bound content.
Replay bundles reject duplicate instruction-version and evidence-snapshot IDs at the schema boundary.
Each hash preimage version is bound to a recursive Zod projection-schema fingerprint, including nested
optional properties and union arms. The shared dependency-reference collector now covers TypeScript
import types and import-equals declarations, closing the Zod-only contracts allowlist for all supported
module-reference forms. Adversarial proof extends PF-027; the contracts measurement is 1480 under the
unchanged 1550 ceiling.
**Revert path:** revert the recursive readonly schemas, duplicate refinements, fingerprint lock, and
AST collector additions together; no runtime consumer persists these prompt-5 contracts yet.

### D-043 · 2026-07-27 · reversible · Dependency aliases resolve before boundary classification

The shared dependency-fence classifier now resolves and normalizes every configured alias suffix
against its source root before classifying the destination layer. Layer detection accepts only the
repository source root and the explicit in-memory companion root, so traversal into `node_modules`
cannot become project-local merely because a package contains its own `src` directory. This closes
both alias-traversal forms from review finding F16 without rejecting valid same-layer aliases.
**Alternatives:** reject every aliased `..` segment - safe but less precise than classifying the real
normalized destination; keep prefix classification and special-case the two reported strings -
rejected because equivalent traversal shapes would remain.
**Revert path:** restore prefix-only alias classification and remove the three traversal companions
and PF-002 extension.

### D-044 · 2026-07-27 · reversible · Dependency references fail closed and nested source paths stay enforced

The authoritative dependency detector now consumes every collected module reference directly.
Non-literal dynamic `import()` and `require()` references in contracts, domain, or infrastructure are
reported as unresolved violations because their destination layer cannot be proven; the outermost app
layer remains free to load runtime-selected modules. Detector-local `__tests__` exclusions were removed,
so every file supplied by shipped-source discovery is enforced, including a nested
`src/contracts/__tests__/` path. Only the root `src/__tests__/` tooling tree remains outside shipped
source discovery. The acceptance artifact no longer publishes exact test totals that drift whenever
parameterized coverage grows.
**Alternatives:** drop unresolved references as before - rejected because it fails open; exclude every
nested `__tests__` directory - rejected because those paths are included by the repository's shipped
source and TypeScript discovery.
**Revert path:** restore statically-resolvable-only iteration and detector-local test exclusions, remove
the four companions and PF-002 extension, and restore manual test totals only if they become generated.

### D-045 · 2026-07-27 · captain-decision · Immutable cross-record links are structurally tenant-scoped

Prompt-5 policy-version, household-instruction-version, evidence-snapshot, intent, and input-bundle
links now use strict `{ firmId, id }` references. `DecisionInputBundleSchema` and
`DecisionRecordSchema` reject every referenced tenant that differs from the enclosing record, so
opaque branded ID strings no longer carry an unenforceable tenant convention. The schema and both
hash-preimage envelopes advance from 1.0.0 to 1.1.0; the canonical serializer remains 1.0.0 because
its byte algorithm is unchanged. Canonical fixtures pin the new bytes and digests, and no persisted
consumer exists yet. Replay time zones reject aliases such as `US/Eastern` unless the caller supplies
the runtime's canonical IANA identifier. The shared dependency collector also covers triple-slash
type and path directives, with the contracts external allowlist and layer rule applied to each.
**Why:** these are the bounded F20-F22 contract and governance corrections authorized by the captain;
leaving tenant ownership or dependency form coverage to naming conventions would violate active
invariant 2 and the same-PR fencing rule.
**Revert path:** restore scalar links and the 1.0.0 fixtures/preimages together, remove the tenant-scope
fence from charter #7 and invariant 2, accept non-canonical time-zone aliases, and remove the two
triple-slash companions plus PF-002/PF-028 evidence.

### D-046 · 2026-07-27 · reversible · Decision-record tenant scope is enforced recursively

The D-045 rule now reaches every hash-bound policy, instruction, evidence-snapshot, and
derived-decision link inside a `DecisionRecord`: precedence citations, recursive explanation nodes,
prohibitions, execution preconditions, and derived-decision ancestry all carry strict `{ firmId, id }`
references and must match the enclosing firm. Schema and both hash-preimage envelopes advance to 1.2.0;
the canonical serializer remains 1.0.0, and canonical fixtures lock the new bytes and digests. PF-028
now exercises each recursive path. The contracts ceiling is re-baselined from 1550 to 1650 through
ADR-0029's ADR-0018 amendment path after the complete contract measured 1640 lines.
**Why:** this fixes F23 at the ownership boundary instead of special-casing the three reported fields;
a hash-bound record cannot cite another firm's immutable inputs.
**Revert path:** restore the 1.1.0 decision shapes, fixtures, projection fingerprints, and hashes
together, remove the recursive PF-028 cases, and restore the 1550 ceiling.

### D-047 · 2026-07-27 · captain-decision · External actions, tenant references, replay zones, and dependency fences are structurally complete

Compensating actions now share the execution step's retry-safe external-action shape: stable
idempotency key, conflict keys, tenant-scoped reservation references, preconditions, and a
tenant-scoped verification-rule reference. Parent and compensation keys cannot alias. Approval
templates are tenant-scoped records, and the remaining configuration, source, subject, scope,
template, target, reservation, and verification links carry strict `{ firmId, id }` references.
The decision refinement reaches blockers, revaluation conditions, authority stages, execution
steps, and compensating actions.

Replay time zones now come from a closed registry identified by the persisted
`timeZoneDataVersion`, not the host runtime's ICU data. The schema and both hash-preimage envelopes
advance to 1.3.0, and the canonical fixtures lock the new bytes, projection fingerprints, and
digests. The contracts external-import fence treats JSX as an implicit `react/jsx-runtime` import,
so Zod remains the only permitted external dependency.

The complete contract measures 1779 lines. ADR-0029 re-baselines the contracts ceiling from 1650
to 1800 through ADR-0018's amendment path, and both ADR indexes report the enforced ceiling.
**Why:** these are the bounded F25-F29 correctness and governance corrections authorized by the
captain; leaving compensation retry behavior, tenant ownership, replay validation, or implicit
dependencies to runtime convention would contradict charter #1/#7/#16 and v3 non-negotiables
10-11.
**Revert path:** restore the 1.2.0 schemas and fixtures together, remove the external-action fence
and JSX companion, restore ICU-based validation, and return the contracts ceiling and indexes to
1650.

### D-048 · 2026-07-27 · captain-decision · Replay inputs, secure references, and dependency fences are canonical and fail closed

Set-like instruction-version and evidence-snapshot collections are sorted at the
`DecisionInputBundleSchema` boundary, so one approved bundle hash exposes one evaluator order.
Secure request, event, and blob pointers now carry `{ firmId, id }`; human requests, system events,
evidence snapshots, execution actions, and decision records reject mismatched pointer tenants.
Execution dependency, conflict, reservation, and precondition-evidence collections reject
duplicates, and direct derived-decision self-reference is illegal.

One shared `iana-tzdb/2026b` registry contains all 418 canonical identifiers from the pinned
release, is SHA-256 locked, canonicalizes identifier casing, rejects aliases outside the registry,
and is consumed by both infrastructure configuration and replay bundles. The schema and both hash
preimage envelopes advance to 1.4.0; fixtures lock the new references, versions, fingerprints, and
digests.

The dependency fence now resolves `paths` from each project's TypeScript compiler configuration,
fails closed on local targets outside the four source layers, and checks contracts against an
ES-only library surface so implicit DOM or Node globals are reported. The complete contracts layer
measures 1988 lines, so ADR-0029 re-baselines the ceiling from 1800 to 2000 through ADR-0018's
amendment path.
**Why:** these are the bounded F30-F36 correctness and governance corrections authorized by the
captain. They close hash/evaluator divergence, tenant leakage through secure storage, host-dependent
replay validation, and silent dependency-fence bypasses without adding evaluator or execution logic.
**Revert path:** restore the 1.3.0 schemas, fixtures, time-zone boundary, and hashes together;
remove the new duplicate and lineage refinements plus dependency companions; restore host-ICU
configuration validation; and return the contracts ceiling and indexes to 1800.

### D-049 · 2026-07-27 · captain-decision · Execution, approval, time-zone, and dependency boundaries fail closed

Every retry-safe external action now proves that its payload, reservations, evidence preconditions,
and verification rule belong to the target tenant. Every execution plan proves that all steps and
compensations share one tenant, and each precondition names at least one evidence snapshot to refresh.
Approval-template expiration is strictly positive, and every instantiated approval or specialist stage
expires later than its decision's `createdAt`.

The `iana-tzdb/2026b` registry is derived from all 341 `Zone` records in the release's primary data
files, including `Etc/UTC` and `Factory`. `Link` names remain aliases rather than distinct canonical
replay values. The dependency fence now inspects triple-slash lib directives and source-local `.d.ts`
files, and fails closed on indirect CommonJS loader references such as aliased `require`,
`module.require`, and comma-expression invocation.

The decision schema and both hash-preimage envelopes advance to 1.5.0; fixtures pin the new schema
fingerprints and digests.
**Why:** these bounded F37-F43 corrections close standalone tenant, revalidation, chronology, replay,
and dependency-enforcement gaps without adding evaluator or execution logic.
**Revert path:** restore the 1.4.0 schemas, registry, fixtures, and dependency collector together,
remove the focused companions, and restore this correction's proof-log extensions.

### D-050 · 2026-07-27 · captain-decision · Role ownership, authority order, and dependency resolution are structural

Every immutable firm-configured role link now carries `{ firmId, id }`. Actor, eligible, specialist,
escalation, and evidence-supplier role references must match their enclosing tenant. Role collections
reject duplicates and normalize by firm then opaque ID, while authority stage arrays normalize by their
explicit `order`. The schema and both hash-preimage envelopes advance to 1.6.0, and fixtures pin the
new role shapes, projection fingerprints, and digests.

The dependency fence now performs TypeScript module resolution for aliases, baseUrl modules, package
imports, and package self-references. It rejects Node `createRequire` in inner layers, source-local
ambient runtime and namespace declarations in contracts, and platform-global diagnostics by stable
diagnostic code. The contracts layer measures 2137 lines, so ADR-0029 re-baselines its ceiling from
2000 to 2200 through ADR-0018's amendment path.
**Why:** these bounded F44-F50 corrections close tenant, canonical-hash, and dependency-enforcement gaps
without adding evaluator, policy, or execution behavior.
**Revert path:** restore scalar role links and caller-ordered authority collections, return the schemas,
fixtures, fingerprints, and hashes to 1.5.0, remove the dependency companions, and restore the 2000-line
ceiling.

### D-051 · 2026-07-27 · captain-decision · Approval positivity, replay registries, and one canonical scoped-reference order

Every approval duration - relative stage expiration and escalation delay alike - is strictly positive,
decided by reading the duration's own component magnitudes and refusing any sign. A leading-minus
heuristic silently inherits whichever ISO-8601 profile the validator ships, so the predicate is exported
and asserted directly: today's grammar refuses signed components before the guard ever runs, which would
otherwise leave its soundness unverifiable.

`timeZoneDataVersion` becomes an enum derived from a supported-registry MAP rather than the single
shipped literal, so a bundle can be replayed against the registry it recorded; versions are only ever
added. The pinned release's 257 `Link` aliases are SHA-256-locked in their own registry and resolved to
their canonical `Zone` at the CONFIGURATION boundary only, so `FIRM_TIMEZONE=UTC` boots again while
`TimeZone` stays closed over the 341 `Zone` names and one zone keeps exactly one persisted, hashed
spelling. `TimeZone` is branded, so a bare string cannot reach a time-zone field.

`ids.ts` now exports THE canonical `{firmId, id}` comparator and set-identity helper; role sets,
evidence-supplier sets, execution collections, replay collections, and both hash preimages consume them,
replacing five near-identical implementations (two of which deduped in O(n^2)). Trigger arms carry their
own tenant refinements and the discriminated union is composed FROM the refined arms, so no check exists
in two places where only one copy runs. Canonical serialization detects cycles against the ancestors on
the current path and names them, instead of surfacing a host-dependent `RangeError`, and builds its
diagnostic path lazily.

The schema and both hash-preimage envelopes advance to 1.7.0; fixtures pin the new projection fingerprint
and digests. ADR-0029 re-baselines the contracts ceiling from 2200 to 2400 through ADR-0018's amendment
path. (This entry's own line measurement went stale twice as review corrections landed; the FINAL
measured figure lives in D-054 and in ADR-0029's current-state re-baseline, and is the only one to
plan against.)
**Why:** these are the bounded F51-F57 review corrections. They close an unsound positivity guard, an
unguarded escalation delay, a replay-metadata field that could never be used for replay, an operational
boot regression on long-legal timezone identifiers, a comparator that could diverge from the record it
hashes, a duplicated refinement where only one copy ran, and an imprecise unbounded serializer refusal -
without adding evaluator, policy, or execution behavior.
**Revert path:** restore the 1.6.0 schemas, fixtures, fingerprints, and digests together; return
`timeZoneDataVersion` to its literal and the config boundary to Zone-only validation; remove the Link
registry, the shared comparator helpers, and the cycle detector; and return the contracts ceiling to 2200.

### D-052 · 2026-07-27 · captain-decision · The replay registry map is consulted, and one tenant edge is not checked twice

The supported-registry map now decides validity instead of only naming versions. A bundle's `timeZone`
is validated against the registry its OWN `timeZoneDataVersion` names, while a standalone `TimeZone`
admits the union of every supported registry. Both halves are required: a `TimeZone` closed over the
newest registry would make a persisted bundle unparseable the moment a later release demotes one of its
Zones to a Link (tzdb does this routinely), and a union with no per-bundle check would let a NEW bundle
claim a zone its recorded release never had. `timeZoneDataVersion` is typed by the map's key union again,
so an arbitrary string cannot reach a replay-metadata field without parsing.

The version-keyed selection is proven on a CONSTRUCTED two-registry map. With one shipped registry, "the
recorded version selects the registry" and "there is one registry" are indistinguishable through the
shipped map, so the prior companion could only assert that its keys were its keys.

`requireExternalAction` in the decision record collapses to the single step-target edge that adds
information: `execution.ts` already binds every reference inside an action to that action's own
`targetRef`, and every step's and compensation's `targetRef` to the first step's. The removed traversal
was a hand-synchronized second copy; a coherent other-tenant plan inside a decision - the one case only
the record can see - is now an explicit fence case.

`HASH_PROJECTION_SCHEMA_FINGERPRINTS` keeps its Zod-emitter digest and gains its maintenance rule: a Zod
upgrade that changes only emitter representation is reviewed and re-pinned WITHOUT a preimage-version bump
and WITHOUT regenerating recorded hashes, and only once the schema semantics and canonical projection
bytes are shown unchanged. Schema and preimage versions stay 1.7.0 - no projected field, byte, or digest
changes.
**Why:** these are the bounded F58-F61 review corrections. They close a replay-registry map that was
declared but never read, a replay-version type that had degenerated to `string`, a duplicated tenant
traversal, and a blocking fingerprint whose maintenance path pointed at an unnecessary data migration.
**Revert path:** return `TimeZone` to the single shipped registry and drop the bundle's registry check,
restore the `Object.keys(...) as [string, ...string[]]` cast, restore the full external-action traversal
in `decision.ts`, and remove the fingerprint maintenance rule from the constant, ADR-0029, and the
fixtures README.

### D-053 · 2026-07-27 · captain-decision · The configuration boundary is release-scoped, and evidence chronology is structural

Reading an already-persisted record and accepting a NEW operator value are two different time-zone
boundaries, and only the first spans releases. `TimeZone` keeps admitting the union of every supported
release so a persisted bundle stays parseable after a later release reclassifies one of its Zones, but
`FIRM_TIMEZONE` is now validated against the CURRENT release alone. Otherwise a configured Zone that
only an older release shipped would boot and then fail at EVERY bundle parse, because a new bundle
stamps the current version - fail-late, where charter #7's config discipline is fail-closed at boot.

The supported map now keys whole RELEASES, not Zone lists: each entry carries its own `Zone` names and
its own `Link` alias table. A single un-versioned alias table could not follow ADR-0029's own adoption
procedure, which adds "its version key + registries" (plural), so the alias half would have stayed
pinned to 2026b while the Zone half advanced. Both halves are now selected together by version.

An `EvidenceSnapshotRef` can no longer claim it was retrieved BEFORE the observation it records
(`retrievedAt >= observedAt`; equality stays legal). The pair is a hash-bound immutable decision input
and the fresh/stale/unknown label is derived from it, so an inverted pair is an illegal state rather
than a lenient one - the same discipline the approval plane already carries.

ADR-0029 re-baselines the contracts ceiling from 2300 to 2400 through ADR-0018's amendment path. The
prior 2300 left 15 lines, which blocks the next edit of any size rather than budgeting a layer. The
headroom is a budget for finishing prompt 5's contract, NOT standing permission to grow `contracts/`;
the FINAL measured figure against that ceiling is recorded in D-054. No projected field, byte, or
digest changes: schema and preimage versions stay 1.7.0.
**Why:** these are the bounded F62-F64 review corrections. They close a configuration boundary that
silently inherited a replay-only widening, an alias table that could not follow a registry adoption, an
unconstrained evidence chronology, and a ceiling with no honest headroom.
**Revert path:** return the configuration boundary to the cross-release union, flatten the release map
back to Zone lists with one shared alias table, drop the `retrievedAt >= observedAt` refinement and its
companion, and restore the 2300-line ceiling.

### D-054 · 2026-07-27 · captain-decision · Placeholder zones are readable but not configurable, and the canonical refusal stays reachable

The shipped tz release contains exactly one identifier the runtime cannot use: tzdb's `Factory`
placeholder for a system whose zone was never set. CLDR/ICU deliberately omits it, so
`Intl.DateTimeFormat` throws `RangeError` on it - confirmed by sweeping all 341 `Zone`s and 257 `Link`s
against host ICU, where it is the only failure. `FIRM_TIMEZONE=Factory` therefore booted and then threw
at the first local-time render: fail-late, the exact shape D-053's release-scoped boundary exists to
refuse. Placeholders are now a THIRD per-release half beside `Zone`s and `Link`s, subtracted at the
configuration boundary AFTER alias resolution, so an alias of a placeholder is refused too. A bundle
that already recorded `Factory` still parses and hash-verifies - reading a persisted record and
accepting a new operator value remain two boundaries. The completeness companion recorded here swept
the registry through host ICU; **D-055 replaces it** with a proof that is deterministic from the
pinned registry, for the reason recorded there.

The canonical serializer's "only plain objects can be canonicalized" refusal was unreachable on the
only paths that reach it in shipped code. Optional-property normalization rebuilt every nested object
from its own entries, flattening a `Date`/`Map`/class instance to `{}` before `canonicalJson` ever saw
it - two structurally different decision inputs collapsing onto one `bundleHash`, silently, in the
audit-chain-critical path. Normalization now passes non-plain objects through untouched under ONE
shared prototype rule, and the companion proves the refusal through `bundleHashPreimage` /
`decisionHashPreimage` rather than through a direct call, which cannot see this gap. The bundle's
canonical re-sort of its two reference collections moved BEFORE projection, so both preimages now have
exactly one normalization path instead of a second one kept in sync by hand.

`freshness` is documented as the evaluator's RECORDED verdict, not something this contract re-derives:
the staleness threshold is per-evidence-kind policy this layer does not have. The dead
`TIME_ZONE_DATA_VERSION` alias and the `TimeZoneSchema` pass-through export are gone, so the
`DecisionInputBundleSchema` doc block attaches to the schema it describes.

**Deferred, explicitly (charter: deferrals are named, never silent):** `EscalationStep.after` is
constrained for strict positivity ONLY. Whether a delay must fall inside its stage's own `expiresAfter`,
and whether two steps in one `escalationPath` may share a delay (there is no ordering authority on that
array, unlike `ApprovalStage.order`), are approval-BINDING semantics owned by prompts 18/24. Prompt 5 is
a schema layer and does not own them. **Un-defer trigger:** prompts 18/24 landing approval binding.

The contracts layer measures **2364** lines by the line-budget fence's own metric against the 2400
ceiling - **36 lines of headroom**, the FINAL post-review figure. No projected field, byte, or digest
changes: schema and preimage versions stay 1.7.0 and every recorded hash still reproduces.
**Why:** these are the bounded F65-F68 review corrections. They close a config boundary that admitted an
unformattable zone, a normalization step that defeated the serializer's own refusal, a doc block
orphaned by a dead alias, and a comment that overstated what the contract checks.
**Revert path:** drop `placeholderZones` from the release shape and the config filter, restore the
prototype-blind normalization and the post-projection re-sort spread, reinstate the
`TIME_ZONE_DATA_VERSION` alias and the `TimeZoneSchema` re-export, and revert the two comments.

### D-055 · 2026-07-27 · captain-decision · Timezone fences are deterministic from the pinned registry, never from host ICU

D-054's completeness companion swept all 341 `Zone`s and 257 `Link`s of the pinned release through
`Intl.DateTimeFormat` and asserted the unformattable set equalled the declared placeholder list
exactly. That made a BLOCKING test require the running runtime's bundled tzdata to be at least as new
as `iana-tzdb/2026b` - the precise host coupling the version-pinned registry exists to remove
(`.env.example`: "validation never consults host ICU data, so it cannot drift with the OS"). The
registry already carries `America/Coyhaique`, added in tzdata 2025a; `engines.node` is `>=20`, and
Node 20 ships ICU 74/75 (≈ tzdata 2024a-2024b), where real `Zone`s would land in the unformattable set
and turn the build red with no code change - diagnosing as "the placeholder list is wrong" rather than
"the runtime is older than the pin". The exact-array arm was order-sensitive on top of that.

Placeholder membership is therefore a DECLARATION carried by each release entry, reviewed when that
release is adopted (ADR-0029's Revisit-When now says so), and the blocking proofs are deterministic
from the pinned data: the declared set is pinned, the config boundary's admitted set is EXACTLY the
release minus that set (an unlisted placeholder still boots, an over-broad subtraction refuses a real
`Zone` - both fail), no `Link` targets a placeholder (**D-056 replaces that arm** with the equivalence
it was standing in for, for the reason recorded there), `Factory` stays refused at the configuration
boundary while a bundle that already recorded it still parses and hash-verifies, and the CONSTRUCTED
two-release companion still proves the subtraction is release-scoped rather than hardcoded. No
host-ICU observation remains that can fail the build. The `firmTimezone` comment at the boundary now
states the placeholder exclusion that `.env.example` and ADR-0029 already carried.

No contract, schema, projection, or byte changes: schema and preimage versions stay 1.7.0, every
recorded hash still reproduces, and the contracts layer still measures **2364** lines against the 2400
ceiling - **36 lines of headroom**, unchanged, since only a test, an infrastructure comment, and docs
moved. `EscalationStep.after`'s deferral to prompts 18/24 (D-054) stands untouched.
**Why:** a fence that fails on a supported runtime is not a fence; the property worth proving is that
the boundary subtracts exactly what the release declares, which the pinned registry can decide alone.
**Revert path:** restore the `Intl` sweep and the exact-equality arm in the placeholder test, and
revert the `firmTimezone` comment, ADR-0029, and this entry's pointer in D-054.

### D-056 · 2026-07-27 · captain-decision · Non-ratified helpers stay module-local, the require scan reads value position, and placeholder proofs are release-keyed

Four decision-core runtime exports had no consumer anywhere in the repo and no place on the ratified
surface (`docs/v3/verin-core-contracts.ts`): `HumanRequestTriggerSchema` and `SystemEventTriggerSchema`
were zero-caller `.readonly()` aliases - `TriggerSchema` composes the un-readonly `*ObjectSchema`
values, so removing them changes no parse behaviour - and `triggerFirmId` and `scopedReferenceKey` each
had exactly one caller, inside their own module. `knip.json` treats `src/contracts/**/*.ts` as an entry
point (the layer is a vocabulary other layers import from), so its dead-export rule cannot see them and
charter #5 went unenforced here. All four are now module-local or gone. The THREE narrowing guards
`isProceedDecision` / `isBlockedDecision` / `isProhibitedDecision` stay exported unchanged: they ARE
ratified surface (`docs/v3/verin-core-contracts.ts`, SHA-256-pinned) held for later consumers, which is
the distinction that makes the other four dead rather than early.

The dependency-rule fence's `require` scan flagged every identifier spelled `require` that was not
declared in the scanning file, including identifiers in MEMBER-NAME position. A member resolves into
whichever module declares that property, so `cfg.require("x")` on a value imported from a sibling
module - or any access through a receiver typed `any`, where the symbol resolves nowhere - reported as
a `<non-literal require-reference>` layer violation and would have hard-failed an inner layer on a
property that merely shares the spelling. The existing companion only exercised the SAME-FILE case,
which passes because those symbols resolve locally, so the cross-module case was untested. The scan
now reads value position only, and a `require` MEMBER is treated as the CommonJS loader when it hangs
off an ambient global (`module`, `globalThis`) or is itself ambiently declared (`const m = module;
m.require(…)`) - both arms proven live and independently non-vacuous. The implicit-JSX-runtime probe
stopped materializing every node of every shipped file and early-exits at the first JSX node instead.

The placeholder companion asserted `expect(placeholders.has(target)).toBe(false)` for every `Link` -
"no alias of this release targets a placeholder", a DATA property of 2026b, not of the code, which
deliberately handles the opposite case. A future release whose alias table does target a placeholder
would have reddened the build on data this boundary already handles correctly, reading `expected true
to be false` rather than naming the adoption: the same shape as the host-ICU coupling D-055 removed.
The assertion is now the EQUIVALENCE it was standing in for - an alias is admitted exactly when its
target is, and only then resolves to it - which holds for any release, with the refusing arm exercised
on the pinned release plus one constructed alias that does target a declared placeholder. Placeholder
membership is likewise checked against a review record keyed BY RELEASE rather than against a
single-release module constant, so adopting a release ADDS an entry and an unreviewed release fails
outright, while an unlisted or over-broad declaration still fails as before.

`.env.example` and ADR-0029 no longer claim "Migration: none". Every IANA spelling that booted before
ADR-0029 still boots - Zones and `Link` aliases alike, in any casing - but ECMA-402 fixed-offset
identifiers such as `+05:30` and `-08:00`, which the superseded host-`Intl` guard accepted, now fail
FATAL at boot. That is the entire blast radius and it is an explicit NON-GOAL: an offset carries no DST
rules, belongs to no tzdb release, and has no canonical `Zone` to persist and hash, so it can never
carry the release-scoped replay semantics every accepted value does.

No schema, projection, byte, or digest changes: schema and preimage versions stay 1.7.0, both registry
pins are untouched, and every recorded fixture hash still reproduces. The contracts layer now measures
**2360** lines against the 2400 ceiling - **40 lines of headroom**, up from 36, because the dead
exports left. `EscalationStep.after`'s deferral to prompts 18/24 (D-054) stands untouched, and
placeholder membership stays review-enforced at release adoption (ADR-0029 Revisit-When), not
fence-enforced.
**Why:** charter #5 does not exempt a layer knip cannot police; a fence that fails on unrelated code is
worse than none (charter #4); and a proof pinned to incidental release data fails the release it was
meant to protect.
**Revert path:** re-export the four helpers, restore the file-local `require` symbol test and the
whole-AST JSX probe, restore the `no Link targets a placeholder` and module-constant assertions, and
revert the `.env.example` / ADR-0029 migration wording.

### D-057 · 2026-07-27 · captain-decision · Hash-bound sets share canonical authorities and defensive preimages

Every set-like execution collection now rejects duplicates and normalizes through the shared
authorities in `ids.ts`: conflict keys, reservation references, preconditions, each precondition's
required evidence references, and dependency edges. Explanation evidence references and composite
versioned-source citations follow the same discipline recursively. The decision hash preimage
defensively applies the same pure execution and explanation normalizers as the parse boundaries,
without parsing persistence-hydrated objects or weakening `canonicalJson`'s non-plain-object
refusal. Optional-property normalization tracks ancestors before rebuilding containers, so cycles
through either production preimage path return the documented circular-reference `AppError` instead
of overflowing the host stack.

This shared-normalization choice stands independently of the line budget. A separate handwritten
decision-preimage normalizer would duplicate roughly 65 lines of recursive execution and explanation
structure and create a second field list that could drift from the schemas. Parsing inside the hash
builder would change the accepted runtime object boundary and hide intentional serializer refusals.
Shared pure authorities avoid both defects while preserving the explicit, versioned preimage
projections.

`AmbiguityRef.candidateRefs` is now duplicate-free, canonical, and constrained to one tenant. The
tenant fence derives the direct scoped-reference and composite-reference collection inventory from
the decision-core schemas, compares it exactly with the explicit constraint registry, and separately
exercises mixed-tenant and duplicate ambiguity candidates. It therefore proves the registered
boundaries and inventory it actually checks, without claiming a broader subject list.

Each IANA release now carries its data version, Zone registry, Link registry, and placeholders as one
value, and the supported-release map derives its key from that embedded version. All timezone
refusals use one bounded, single-line, release-aware formatter that removes control characters and
reports non-string kinds without echoing arbitrary payloads. The dependency fence now uses its
general expression unwrapper for asserted `node:module` loaders and follows variable provenance so
an ambient `module` alias typed as `any` remains a CommonJS loader.

The final contracts implementation measures **2726** lines by the line-budget fence's own metric.
ADR-0029 re-baselines the contracts ceiling from 2400 to **2800** through ADR-0018's amendment path,
leaving **74 lines of measured headroom**. The ratchet resumes from 2800; this is not standing
permission for unrelated growth. All recorded bundle and decision fixture digests remain
byte-identical, so schema and preimage versions stay 1.7.0.
**Why:** semantically equivalent decisions must bind to one hash, tenant-scoped collections must
reject mixed ownership, structured refusals must survive malformed runtime objects, and blocking
fences must prove the bypasses they claim to close.
**Revert path:** none while decision hashes at version 1.7.0 and the prompt-5 tenant/configuration
boundaries remain supported.

### D-058 · 2026-07-27 · captain-decision · Parse and preimage normalization share complete authorities

Decision-record parse boundaries and decision-hash preimages now share pure normalization authorities
for every canonical collection they bind: actor roles, specialist roles, approval stages, eligible
roles, escalation roles, blocked evidence suppliers, explanations, and execution plans. Each recursive
normalizer preserves non-plain objects instead of spreading them, so `canonicalJson` still rejects
class instances at nested production preimage paths. Bundle preimages use the same release registry
authority as `TimeZoneSchema` to canonicalize accepted Zone casing.

The tenant inventory follows schema provenance through aliases, wrappers, and composite schemas before
comparing the discovered collections with the explicit constraint registry. Its three synthetic
companions prove each indirection form is visible. Standalone execution steps now bind a compensation
target to the parent target's tenant, independently of the plan-level check. Recorded-release timezone
membership refusals use the one bounded formatter and name the bundle's actual release. The dependency
fence follows destructured `require` provenance from ambient `module` receivers, including type-erased
aliases, and the ES-only contracts diagnostic gate includes TypeScript diagnostic 2584 for DOM globals.

The shared-normalization rationale in D-057 remains independent of the line budget. After these
completion corrections, the line-budget fence measures `contracts/` at **3016** lines. ADR-0029
re-baselines the ceiling from 2800 to **3100** through ADR-0018's amendment path, leaving **84 lines
of measured headroom**. The ratchet resumes from 3100 and does not authorize unrelated growth.
Recorded bundle and decision fixture digests remain byte-identical, so schema and preimage versions
stay 1.7.0.
**Why:** hash equivalence must match every parse-time canonicalization, serializer refusals must survive
every nested normalizer, tenant and dependency fences must fail under ordinary syntax indirection, and
diagnostics must describe the actual replay release.
**Revert path:** none while decision hashes at version 1.7.0 and the prompt-5 tenant, execution,
timezone, and dependency boundaries remain supported.

### D-059 · 2026-07-27 · captain-decision · Schema discovery and replay traversal are semantic and stack-safe

The decision-core tenant inventory now walks the exported runtime Zod schema graph. It recognizes every
array, record, tuple, set, or map from which a `{firmId, id}` reference is reachable, independent of the
source expression or wrapper factory that constructed it. The exact registry now includes
`RecommendationSchema.parameters`, and record plus wrapper-factory companions prove those forms cannot
escape discovery. The module inventory is exact as well, so adding a decision-core source module without
classifying its exports fails the fence.

Supported time-zone releases are one ordered list of inseparable release values. Both the supported map
and bundle-schema factory derive version labels from each value's embedded `dataVersion`, and duplicate
embedded versions are refused, so a caller cannot pair one release's zone data with another label.

Optional-property normalization, recursive explanation normalization, and canonical serialization now
use iterative traversals. A 12,000-level acyclic explanation passes through the complete production
decision-preimage path, while the existing cycle and nested class-instance refusals remain unchanged.
CommonJS loader detection resolves destructured receiver provenance through declaration and assignment
forms for both `require` and `createRequire`, including computed literal keys and type-erased aliases.

The shared-normalization rationale in D-057 remains independent of the line budget. These completion
corrections measure `contracts/` at **3158** lines. ADR-0029 re-baselines the ceiling from 3100 to
**3200** through ADR-0018's amendment path, leaving **42 lines of measured headroom**. The ratchet
resumes from 3200 and does not authorize unrelated growth. Recorded bundle and decision fixture digests
remain byte-identical, so schema and preimage versions stay 1.7.0.

**Why:** a completeness fence must follow schema meaning instead of constructor spelling, replay labels
must be inseparable from their data, and unbounded valid inputs must not depend on the host call stack.
**Revert path:** none while decision hashes at version 1.7.0 and the prompt-5 tenant, replay, and
dependency boundaries remain supported.

### D-060 · 2026-07-27 · captain-decision · Exported boundaries prove tenant and retry safety behavior

The decision-core tenant inventory covers every exported Zod value whose runtime schema graph contains
a scoped-reference collection. Export names are unrestricted and shared schema objects are inventoried
once per exported boundary rather than collapsed by identity. The registry is exact, and every entry
supplies a legal payload plus a mixed-tenant payload that the registered exported schema must reject.
Suffixless-export, reused-wrapper, and behavior-failure companions prove all three parts of that claim.

`ExecutionStepSchema` itself rejects a self-dependency and a compensation that aliases the parent
idempotency key. Scoped-reference uniqueness uses the one canonical tuple comparator, so unrestricted
identifier strings cannot collide through delimiter concatenation. Explanation parsing and
decision-record tenant traversal are iterative at the production schema boundary; the 12,000-level
companion now enters through `DecisionRecordSchema.safeParse` before hashing.

The dependency fence resolves computed loader keys through local literals and the latest preceding
simple assignment for both destructuring and element access, shared by `require` and `createRequire`.
Its static proof does not cover runtime, conditional, or configuration-derived property keys and is not
a security boundary against a determined source author. No shipped source contains a `require` token.
**Revisit-When:** shipped code intentionally needs a runtime-computed CommonJS loader key; replace or
augment this fence with a runtime or compiler-level boundary rather than enumerating more spellings.

Independently of the line measurement, parse boundaries and hash preimages continue to share pure
normalization authorities so canonical collections cannot drift and non-plain inputs remain visible to
the serializer refusal. The final contracts implementation measures **3412** lines. ADR-0029
re-baselines the ceiling from 3200 to **3500** through ADR-0018's amendment path, leaving **88 lines of
measured headroom**. The ratchet resumes from 3500 and does not authorize unrelated growth. Recorded
bundle and decision fixture bytes and digests remain unchanged, so schema and preimage versions stay
1.7.0.

**Why:** exported validation boundaries must prove their actual tenant behavior, intrinsic retry
hazards must fail at the standalone step boundary, and valid input depth must not depend on the host
call stack.
**Revert path:** none while prompt-5 tenant, execution, replay, and dependency boundaries remain
supported.
### D-061 · 2026-07-26 · reversible · Security boundaries landed (v3 build sequence, prompt 6): sealed TenantContext, governed-action authz, Tokenized factory + llm/ boundary, secret containment
**What:** Implemented v3 §15 as structural seams over the existing substrate (marriage-map §6: EXTEND the
org-id fence / PII scrub / RBAC / no-secret-fallback, displace nothing).
**Rebase note:** This decision was D-036, then D-039, on the topic branch. Prompt-6 implementation
references to either number refer to this entry; origin/main had already assigned D-036 through D-060.
- **TenantContext** (`contracts/tenant.ts`): compile-time unique-symbol brand + runtime module-private
  seal; minted ONLY by `tenantOf(principal)` / `systemTenant(systemId, orgId)`. Every repository and port
  call requires it (writes carry it inside `WriteActor`); capability-keyed loads (session id, e-sign
  token, resume token) and the identity-provider internals are exact-match reviewed escapes, mirroring the
  org-id fence's NON_TENANT classification. Missing context cannot compile (TS2741) or parse (repository
  asserts reject casts/spreads/JSON impostors with `INTERNAL`). Fence: `tenant-context-required` (PF-030).
- **Per-action authorization** (`contracts/authz.ts`): `ActorRef` (human role-holder | system actor) +
  the seven v3 §15.3 permission points (eight actions - policy drafting and approval are distinct) with
  Phase 1 role allowlists. Surfaced actions mirror the previous
  route allowlists EXACTLY (no behavior change): `pii.view` = all roles (households GET), `execution.initiate`
  = advisor/ops/principal/admin (account-opening POST), `audit.export` = ops/cco/principal/admin (audit GET).
  Unsurfaced actions drafted per v3 §11 semantics with separation of duties: compliance authority
  (`policy.draft/approve`, `decision.approve`, `decision.override`) EXCLUDES the IT-admin role, approval
  actions exclude the requesting-advisor role, and `evidence.supply`/`cco` are separated (review vs doing).
  System actors are refused every governed action (machines never approve; policy-automatic paths arrive
  with their own typed authority in prompt 18, which also brings quorum/actor-distinctness — these
  allowlists are the role-level floor, not the authority machinery). Fence: `governed-actions` (PF-033).
- **Tokenized + llm/ boundary**: `Tokenized<T>` lands with the ratified shape (verin-core-contracts.ts)
  and is constructible only via the scrubber factory `infrastructure/pii/tokenize.ts` (runtime-sealed,
  scrub-by-construction); `infrastructure/llm/` holds the ONLY LLM-bound shapes (masked request schema +
  evidence-to-LLM projection with deterministic known-entity masking) and no model client (first LLM
  surface = prompt 13; charter #5's no-dead-scaffolding is honored by keeping the boundary to the seam the
  ratified invariant 1 requires — v3 invariant 1 is ACTIVATED by this PR, per its registry activation
  clause). Fences: `tokenized-factory-only` (PF-031) + `llm-pii-boundary` (PF-032) + an ESLint edit-time
  mirror.
- **Secret containment** (`contracts/secret.ts`): config secrets become closure-held `SecretValue`s
  (every coercion path redacts; the free function `revealSecret()` allowlisted to the two HMAC consumers — PF-034). Span
  attributes and span error messages are PII-scrubbed at the trace boundary (values by pattern, keys by
  the same field-name rule as the log scrubber); pino redact list extended to account/routing numbers;
  `safeReason` is the sanctioned exception-text log helper (a free-form deep-scrub helper lands with its
  first real consumer at the prompt-13 LLM logging surface, per charter #5).
- **ADR-0032** (`docs/adr/0032-line-budget-wave-a-security-boundaries.md`): line-budget amendment
  (contracts 600→1000, infrastructure 2500→3000 against the pre-decision-core base) — the sanctioned
  ADR path for growth scheduled by the ratified sequence; ratchet-down at wave gates unchanged.
  Composed on rebase with main's decision-core raise (3500), the shipped contracts ceiling is 3900.
**Why:** v3 prompt 6's acceptance is that the security seams are structural even though Phase 1 uses a
simplified identity provider — the seams are types + factories + fences, so swapping the identity provider
or landing the real LLM surface later cannot move the boundary.
**Alternatives:** naming-convention discipline (rejected: reviewer discipline is what §15.1 forbids
relying on); Zod-only runtime checks without compile brands (rejected: an impostor should fail to
compile, not merely 500); marking PII types by hand-maintained list (rejected: the fence DERIVES the
marked set from field names, so a new PII type cannot ship unmarked).
**Revert path:** delete `contracts/{tenant,authz,tokenized,secret}.ts`, `infrastructure/pii/tokenize.ts`,
`infrastructure/llm/`, the four fences + the reveal-allowlist checks, the ESLint mirror; restore
`WriteActor{orgId}` signatures and plain-orgId repository params; flip v3 invariant 1 back to
not-yet-active and drop invariant 2's added mechanism; restore ADR-0018 ceilings (delete ADR-0032);
remove PF-030..PF-034 and this entry.

### D-062 · 2026-07-26 · reversible · Prompt-6 security boundaries hardened after adversarial review

All eleven review findings were legitimate manifestations of four deeper gaps:
security identities could be minted at untrusted call sites, relational
ownership was scoped in queries but not in foreign keys, free text and
credential-bearing configuration remained serializable, and several
authoritative fences matched syntax rather than semantics.

- `Principal` and authenticated identity results are runtime-sealed and
  compile-time branded. Only credential verification and signed-session
  resolution mint principals. Session creation accepts a sealed authenticated
  user plus its tenant and uses an ownership-qualified `INSERT ... SELECT`;
  session reads join user and organization as one key. System tenant ids are a
  closed registry, retained in `TenantContext`, and mint call sites are
  semantically allowlisted across shipped source and operational scripts. The
  load smoke now authenticates and creates a real session instead of minting a
  principal.
- Migration 3 appends tenant-qualified composite foreign keys for session users,
  household parents and advisors, contacts, financial accounts, applications,
  tasks, and assignees. Repository integration tests prove crossed references
  fail in real PGlite, not only in application predicates.
- Raw evidence projection contracts moved from `infrastructure/llm` to
  `infrastructure/pii`. Known sensitive values are deterministically replaced
  with typed slots before `Tokenized` sealing, and unresolved name/account text
  fails closed. The llm boundary derivation floor now recognizes raw request
  and evidence names and rejects a PII-bearing declaration inside `llm/`.
- Secret bytes moved behind a module-private `WeakMap` plus a semantically
  fenced `revealSecret` function. Database URLs are sealed alongside HMAC
  secrets. Exception reasons are static codes; logs and traces scrub ambiguous
  names, bare account numbers, and PII-named fields instead of forwarding
  exception text.
- PF-030 through PF-034 now use semantic type/call resolution where syntax-only
  matching admitted aliases, shorthand literals, classes, computed access, or
  another handler's authorization call. Exact escapes and liveness checks stay
  intact. Executed adversarial proofs are recorded in
  `docs/fences/proof-log.md`.

**Why:** the prompt-6 contract requires these seams to survive ordinary refactors
and hostile input. A query predicate or naming convention alone cannot prove
tenant ownership, authenticated provenance, PII removal, or secret
non-observability.

**Alternatives:** add one-off ownership lookups in each adapter (rejected because
new write paths could omit them and checks could race); broaden regex fences
(rejected because aliases and inferred types remain false green); allow raw
exception messages after more pattern matching (rejected because names and
credentials have no complete safe regex).

**Revert path:** revert this review-fix changeset, remove migration 3 only if it
has not shipped to a persistent store, and restore the prior PF-030 through
PF-034 implementations. D-039 remains the underlying prompt-6 decision.

### D-063 · 2026-07-26 · reversible · Prompt-6 authority, token immutability, and semantic boundary fences hardened

All six second-round review findings were legitimate instances of three
remaining structural gaps: authorization and masking still accepted
caller-assembled metadata, sealed wrappers did not make their payloads
immutable, and two completeness fences classified contracts by declaration
names or direct properties instead of their semantic callable shape.

- `ActorRef` is now compile-time branded, runtime-sealed, frozen, and derived
  only from a sealed `Principal`. `authorizeGovernedAction` rejects unsealed
  actors before consulting the role allowlist, so a caller cannot combine a
  valid tenant with a fabricated elevated role. `ActorRef` construction is
  included in the sealed-security-types fence.
- Evidence projection accepts sealed `EntityMaskBinding` values rather than
  caller-declared masks. Binding and tokenization factories are semantically
  callsite-fenced, with token creation owned by the projection boundary and no
  shipped entity-binding mint site until deterministic resolution lands.
- `Tokenized<T>.value` is deeply readonly in the contract. The scrubbed clone is
  recursively frozen before the wrapper is sealed, so neither the source object
  nor nested arrays or records can mutate a valid token afterward.
- The tenant-context fence now inspects every callable member and direct call
  signature on exported domain interfaces, independent of `Port`, `Store`, or
  `Deps` naming. The flow step contract and every `AccountOpeningDeps` method
  receive the sealed tenant explicitly; the adapter rejects a scope that does
  not match its bound actor.
- Observability exposes only allowlisted PostgreSQL SQLSTATE categories.
  Caller-controlled five-character codes fall back to `unexpected-error`.
- The PII marker floor now resolves `PIIBearing` and `Tokenized` by declaration
  identity and inspects method parameters, callable properties, call
  signatures, inline objects, and return types. A locally named `Tokenized`
  cannot create an exemption.

**Alternatives:** authorize directly from `Principal` and remove `ActorRef`
(rejected because the ratified contracts retain actor references beyond the
authorization seam); expand name and account regexes again (rejected because
mask ownership, not probabilistic text recognition, is the durable boundary);
add `Deps` to the port-name regex (rejected because the next naming variation
would recreate the false green).

**Revert path:** revert this changeset and restore the prior `ActorRef`,
projection input, shallow token contract, flow dependency signatures, driver
code pattern, and PF-030 through PF-032 implementations. D-039 and D-062 remain
the underlying prompt-6 decisions.

### D-064 · 2026-07-27 · reversible · Prompt-6 execution proof, write attribution, workflow PII, and declaration-form fences hardened

All five third-round findings were legitimate instances of three deeper gaps:
authorization proof stopped at the HTTP route, actor attribution was not sealed
at the audit chokepoint, and semantic fences still depended on declaration
syntax.

- Account opening now requires a sealed, action-parameterized
  `ActionGrant<"execution.initiate">` at the execution boundary. The runtime
  verifies the exact action and derives both tenant and write actor from the
  grant.
- `WriteActor` is branded, WeakSet-sealed, and frozen. `auditedWrite` accepts
  the actor object rather than independent tenant and actor strings, then
  validates it before SQL. Direct actors must match the identity retained by
  their tenant; e-sign and failed-login attribution use an explicit delegated
  factory restricted to reviewed system actors and call sites.
- Prompt-6 runtime seals now verify factory-minted object identity through
  module-private WeakSets. Prototype-derived or reflected-symbol copies cannot
  inherit authority from a valid principal, tenant, actor, grant, token, or
  entity-mask binding.
- Workflow data, persisted execution state, and flow results retain the
  `PIIBearing` marker. The PII fence resolves mapped, union, and intersection
  alias properties. The tenant fence resolves exported callable objects,
  interfaces, type aliases, and classes while ignoring inherited standard
  library methods, including bindings exported in a separate declaration.

**Alternatives:** keep authorization as a route-only convention (rejected
because internal callers could bypass it); validate actor strings independently
at every repository (rejected because the next write path could omit the
check); reject type aliases and object repositories entirely (rejected because
their semantic callable shape is enforceable).

**Revert path:** revert this review changeset and restore Principal-based flow
start, tuple-shaped audited-write attribution, unmarked workflow state, and the
prior declaration-form-specific PF-030/PF-032 implementations. D-039 and D-062 through
D-063 remain the underlying security-boundary decisions.

### D-065 · 2026-07-27 · reversible · Prompt-6 recovery and completeness fences hardened

All eight fourth-round findings were legitimate instances of five remaining
structural gaps: retry attribution did not distinguish the initiating human
from the webhook system actor, LLM slot labels admitted free text, PII and
tenant fences did not close over all executable forms, governed-route coverage
was manually enumerated, and secret reveals were trusted at file scope.

- Failed webhook finalization now reuses the matching sealed human
  `WriteActor` on an identical form resubmit. Only the webhook-owned path
  delegates from the reviewed `esign-webhook` system actor.
- LLM placeholders use generated opaque ids in the closed
  `slot_0001` through `slot_9999` format. Projection bindings and adapter
  parsing use `slotId`, so a name cannot be carried in placeholder metadata.
- The PII fence recursively inspects nested project types, mapped utilities,
  and exported callables. It treats `Tokenized` and `SecretValue` as the two
  sanctioned sealed wrappers and rejects nonliteral module loads anywhere in
  the LLM import closure.
- Repository directories are closed by default: every exported callable must
  carry `TenantContext` or `WriteActor`, with exact reviewed escapes and exact
  non-repository module exclusions. This covers internal `getDb`, captured
  handles, and future repository files without relying on exposed SQL types.
- Governed route entries are derived from semantically resolved governed-sink
  calls. Authorization and fail-closed helpers resolve to
  `app/_server/context.ts`; local shadows do not count. Secret access is
  restricted to direct `revealSecret` arguments at the exact reviewed
  `createHmac` calls, not merely their containing files.

**Alternatives:** preserve friendly slot labels and scan them for names
(rejected because single-token names remain ambiguous); detect hidden database
use through body dataflow only (rejected because closed repository directories
are simpler and cover future capture forms); retain manual route entries or
file-level secret allowlists (rejected because both fail open when call sites
move).

**Revert path:** revert this changeset and restore the prior retry actor
selection, slot-name schema, SQL-signature repository classification, manual
surface table, and file-level reveal allowlist. D-039 and D-062 through D-064 remain the
underlying security-boundary decisions.

### D-066 · 2026-07-27 · reversible · Prompt-6 trusted-set, sink-authority, and compiler-resolution boundaries hardened

All six fifth-round findings were legitimate instances of four remaining
structural gaps: entity masks were sealed individually without a complete-set
proof, privileged factory modules could be reflected through namespace access,
governed authorization stopped at the route, and repository and LLM fences
derived coverage from hand-maintained paths or partial module resolution.

- LLM projection now accepts one sealed `CompleteEntityMaskSet`, verifies exact
  sensitive-slot coverage, masks every trusted value, proves none remains, and
  fails closed on unresolved embedded proper names.
- Privileged identity, tenant, actor, entity-set, tokenization, and secret
  modules reject namespace imports, re-exports, dynamic access, and
  unverifiable module loads. Exact named factory and HMAC consumers remain
  semantically allowlisted.
- PII reads and audit-row exports require and validate action-specific grants
  inside their repository functions. Operational audit verification and counts
  retain tenant-scoped, non-exporting paths.
- Tenant repository coverage is derived from the transitive SQL module graph
  across infrastructure and includes exported domain function and variable
  callables. LLM reachability resolves modules through the TypeScript compiler,
  including `.js` specifiers that substitute to `.ts`.

**Alternatives:** expand residual PII regexes while retaining caller-assembled
bindings (rejected because ownership, not pattern count, proves completeness);
analyze every route-to-helper call graph (rejected because action proof at the
sink is simpler and survives refactoring); add more adapter directories and
extension candidates to manual lists (rejected because both recreate false
green coverage).

**Revert path:** revert this changeset and restore individual entity bindings,
route-only governed authorization, directory-scoped tenant discovery, manual
LLM path resolution, and direct-symbol-only privileged access checks. D-039 and
D-062 through D-065 remain the underlying prompt-6 decisions.

### D-067 · 2026-07-27 · reversible · Prompt-6 completeness proofs and governed repository entry guards hardened

All five sixth-round findings were legitimate instances of four remaining
false assurances: a caller could label an arbitrary entity list complete,
evidence keys were outside residual scanning, privileged factory review was
file-scoped, and repository governance checked declarations without deriving
runtime behavior.

- LLM projection no longer exposes a factory that seals caller-assembled
  completeness. It validates resolved entities against their slot kinds and
  the complete request-plus-evidence payload, admits only a closed residual
  vocabulary after tokenization, and includes evidence keys in both residual
  entity scans.
- Privileged factory consumers are allowlisted by exact containing function.
  A new wrapper in a reviewed module is rejected unless that function is itself
  a reviewed authority boundary.
- Governed sinks are derived from action-grant parameters, PII-bearing return
  types, and action-marked export return types. Audit chain rows and account
  opening start results carry semantic action markers, so new PII or audit
  exports cannot depend on a manually updated sink table.
- Every non-exempt SQL-backed repository entry must call the canonical runtime
  assertion for its TenantContext, WriteActor, or ActionGrant as its first
  statement. Write adapters now assert actor seals at their own entry points in
  addition to the audited-write chokepoint.

**Alternatives:** preserve the public complete-set seal and add more residual
regexes (rejected because the seal would still certify caller intent); add
wrapper names and governed functions to manual registries (rejected because
new declarations would remain fail-open); trust compile-time tenant brands at
repository entries (rejected because casts and deserialization cross runtime
boundaries).

**Revert path:** revert this changeset and restore the public complete-set
factory, file-level privileged factory allowances, manual governed sink table,
and signature-only tenant fence. D-039 and D-062 through D-066 remain the underlying
prompt-6 security decisions.

### D-068 · 2026-07-27 · reversible · Prompt-6 resolver, observability, and callable-boundary proofs hardened

All five seventh-round findings were legitimate instances of three remaining
false assurances: projection trusted caller-supplied entity bindings,
observability treated some arbitrary strings as safe, and semantic fences
stopped at exported function declarations instead of executable boundaries.

- Sensitive entities are now derived by a deterministic domain resolver from
  the complete request and evidence payload. Callers cannot provide bindings.
  Subject names, account references, evidence keys, strings, and primitive
  leaves are classified before the projection can be sealed. Unknown keys,
  unclassified numbers, unmatched entity counts, and residual text fail closed.
- Logs and traces admit dynamic primitives only through field-specific closed
  vocabularies for opaque identifiers, statuses, error categories, actions,
  entity types, and operational counts. Generic strings, including a single
  name in any position, are redacted.
- The tenant fence inspects callable methods returned by repository factories
  and requires their runtime seal assertion. The governed-action fence derives
  sinks from exported functions, arrows, object methods, and class methods.
  The LLM reachability fence rejects unwrapped `any` and `unknown` on exported
  callables, with exact live escapes for reviewed scrub-and-parse ingress
  functions.

**Alternatives:** add more residual-safe words while retaining caller bindings
(rejected because the caller would still define completeness); redact only
title-cased strings (rejected because lowercase names and arbitrary free text
remain untrusted); ban repository factories and callable objects (rejected
because their runtime implementations are semantically inspectable).

**Revert path:** revert this changeset and restore caller-provided
`resolvedEntities`, heuristic observability values, function-declaration-only
governed sinks, signature-only returned ports, and opaque types as safe leaves.
D-039 and D-062 through D-067 remain the underlying prompt-6 security decisions.

### D-069 · 2026-07-27 · reversible · Prompt-6 typed evidence, observability identity, and wrapper analysis hardened

All seven eighth-round findings were legitimate instances of three remaining
boundary gaps: evidence shape was inferred from key names, observability trusted
identifier-shaped strings, and declaration-module or transparent-wrapper
callables escaped semantic review.

- LLM evidence is checked against a closed masked schema. Sensitive-length
  numeric leaves are classified as account references regardless of their key,
  so a long account number under `plannedWithdrawals` is refused before sealing.
- Observability actions use a closed value set. Identifiers cross the log and
  trace boundary only through runtime-sealed, field-bound `ObservabilityId`
  values; raw action-like names and account-like identifiers are redacted.
- The secret module is scanned and limited to its reviewed exports. Privileged
  factory declaration modules are inspected for wrapper calls and exported
  sealed-result laundering.
- Tenant, governed-action, and LLM fences inspect callable members through
  transparent wrappers such as `Object.freeze`. Factory-returned repository
  methods retain their first-statement runtime assertion requirement.
- ADR-0030 raises the infrastructure line budget from 3,000 to 3,200 lines so
  the reviewed boundary code remains readable. The next wave gate still
  ratchets the ceiling down to actual plus buffer.

**Alternatives:** allow long numbers under amount-shaped keys (rejected because
keys do not prove data identity); preserve regex-trusted observability strings
(rejected because names and account numbers can match); ban transparent
wrappers (rejected because their semantic callable shape is inspectable);
compress boundary code under the old ceiling (rejected because auditability
would suffer).

**Revert path:** revert this changeset, restore raw observability primitives and
syntax-only wrapper discovery, remove ADR-0030, and restore the 3,000-line
infrastructure ceiling. D-039 and D-062 through D-068 remain the underlying prompt-6
security decisions.

### D-070 · 2026-07-27 · reversible · Ninth-round review: structural resolution, derived observability vocabulary, and boundary-honest fences

The ninth adversarial round found one live crash path and a set of checks whose
authority came from enumerated vocabularies rather than from structure.

- **`observabilityId` no longer aborts committed work.** The account-opening
  route validates `clientRequestId` with a CASE-INSENSITIVE UUID regex and that
  value becomes the `executionId`, while the observability predicate was
  case-sensitive: an uppercase-hex request id committed the household, contact,
  and application writes and then threw `PII_VIOLATION` out of the "flow
  started" log line as an unenveloped 500. The opaque-id pattern is now
  case-insensitive, and the blanket "purely alphabetic" refusal — which also
  rejected registered machine tokens such as `org` and `seed` — is replaced by a
  person-name SHAPE rule (a capital immediately followed by a lowercase letter).
  Whitespace was already impossible under the opaque pattern, so a multi-word
  name still cannot reach the helper. `"running"` joins the status enum so a
  double-submit replay stops logging `[REDACTED]` for the one field that
  explains it.
- **LLM projection resolution is structural.** `SAFE_WORDS`, `SAFE_TITLES`,
  `SAFE_ACRONYMS`, `SAFE_NUMERIC_KEYS`, `SAFE_KEYS`, and `TEXT_EVIDENCE_KEYS`
  are gone. A value is RESOLVED when every structurally sensitive span has been
  replaced by a factory-minted slot placeholder or the redaction sentinel, judged
  by `contracts/pii.ts`'s own predicates — the same ones guarding the audit, log,
  and trace boundaries. Candidate extraction is derived from those predicates, so
  anything the residual check would refuse was already required to be bound.
  Arbitrary prose now passes; raw names, account numbers, and 9-18 digit runs
  still do not. The shared digit-run predicate and title-case word shape are
  hoisted into `contracts/pii.ts` so masking and residual detection cannot drift.
- **Observability vocabulary is derived and fenced.** The six test-only span
  names left production domain code for `registerTestSpanName`, a `test.`-namespaced
  injection point with no shipped caller. The new
  `observability-vocabulary` fence derives the span and log inventory from the
  AST of real `withSpan` / `log.*` call sites and checks it both ways
  (unregistered value, stale entry, dynamic identity).
- **Fences stopped trusting text and nearest ancestors.** Governed-sink mutation
  classification reads SQL passed as call ARGUMENTS, not raw declaration text
  (a comment saying "nothing to update" no longer exempts a PII read); governed
  surface discovery covers every `src/app/**` file, so a Server Action or server
  component reaching a governed sink fails instead of being invisible, and the
  authorization must bind the handler's OWN request parameter; LLM escapes key on
  the full dotted path the detector emits and must be load-bearing; the
  domain-port escape liveness check applies the detector's own domain filter; the
  config-hygiene fence has a non-vacuity floor and a detector that takes its
  input so it can be fed a synthetic violation.
- **Smaller boundary corrections.** The ESLint sealed-type override now matches
  the fence exactly (`src/infrastructure/pii/tokenize.ts` only, not the whole
  `pii/` tree); the dead `listOrgChain` export is gone and its tests read the
  chain through `verifyAndListOrgChain`, the function `/api/audit` really uses;
  a persisted role outside the taxonomy resolves to a typed `AUTH_FAILED`
  instead of throwing out of the read-only `/app` guard.
- **ADR-0031** records why the evidence-to-LLM projection layer stays despite
  having no production caller until prompt 13, and how that differs from the
  `piiSafe` helper deleted earlier on this branch.

**Alternatives:** normalize the request id to lowercase at the route (rejected —
it hides the mismatch and the next id source repeats it); keep the word lists and
extend them (rejected — a vocabulary fitted to its own fixtures proves only that
the fixtures were enumerated); leave span names undetected at build time
(rejected — silent loss of trace identity is exactly what charter #14 exists to
prevent); delete the projection layer (rejected by the supervising authority —
see ADR-0031).

**Revert path:** revert this changeset to restore the case-sensitive
observability predicate, the enumerated projection vocabularies, the text-regex
mutation classifier, the route-only governed surface scan, and `listOrgChain`.
ADR-0031 would be withdrawn with it. D-039 and D-062 through D-069 remain the underlying
prompt-6 security decisions.

### D-071 · 2026-07-27 · reversible · Tenth-round review: leading-name binding, the account shape, and semantic fence keys

D-070 replaced two enumerated vocabularies with structural rules; the tenth round
found that both structures were drawn slightly off the predicate they claimed to
derive from, and that the D-070 crash fix had been narrowed rather than closed.

- **A multi-word name that OPENS the prose is bound whole.** Dropping the first
  word of every leading title-case run left a given name raw in the text a model
  would see (`"Adaeze {{slot_0001}} wants to open an account"`), and nothing
  downstream caught it: masking the surname destroys the two-adjacent-words shape
  `TITLE_CASE_PERSON_RE` needs, and `looksLikeAmbiguousSensitiveText` exempts a
  title-case word at index 0. The sentence-opener rationale holds for a LONE
  capitalized word, not for a run — a multi-word run is the person-name shape
  itself, so only a single-word leading run is treated as grammar. The cost is
  over-binding a leading verb + name ("Review Alice"), which is fail-closed.
- **Account references are exactly the runs the residual check refuses.**
  Extraction moved from `\b\d{3,18}\b` to `SENSITIVE_DIGIT_RUN_SOURCE`
  (9-18 digits) read from the text AFTER pattern redaction, so a year no longer
  demands an account-ref slot and a long digit run beside a redactable phone is
  no longer an unsatisfiable refusal. `redactPIIValues` is hoisted into
  `contracts/pii.ts` as the ONE authority for what redaction removes; `scrub()`
  delegates to it. The blanket "intent-shaping must declare a slot" rule is gone
  — it guarded caller-supplied masks in an earlier round, and per-type count
  matching subsumes it now that masks are derived.
- **The request id is canonical BEFORE it becomes an `executionId`.** Making the
  opaque-id pattern case-insensitive left `NAME_SHAPED_RE` refusing any
  `[A-F][a-f]` adjacency, so a mixed-case UUID still committed its writes and then
  threw out of the log line. `startAccountOpening` now lowercases a UUID-shaped
  request id and PROVES it is a loggable observability id before any write, so
  every caller — route, script, or a future Server Action — gets a typed
  `VALIDATION` refusal instead of an unenveloped 500 with durable side effects.
  The route validates against the same exported `CLIENT_REQUEST_ID_RE`, so the two
  validators cannot drift.
- **Fence keys are semantic, not textual.** The test-only span injection point is
  matched by resolved symbol alone, so an aliased import cannot smuggle a call
  past it; `literalText` reads a string-LITERAL type, so a hoisted `const MSG`
  message is checked like an inline literal instead of being skipped entirely.

**Alternatives:** reject uppercase UUIDs at the route (rejected — it breaks
clients that mint them, and the next id source repeats the mismatch); weaken
`NAME_SHAPED_RE` so hex always passes (rejected — that trades a real PII guard
for a canonicalization bug); keep the leading-word shift and add a downstream
detector (rejected — the detector would have to treat every leading title-case
word as a name, which refuses ordinary prose).

**Revert path:** revert this changeset to restore the leading-word shift, the
3-18 digit account shape, the text-keyed injection-point filter, and the
uncanonicalized `executionId`. D-070 and ADR-0031 stand independently.

## D-072 — Sealed types, governed sinks, and observability vocabularies are closed structurally

**Date:** 2026-07-27 · **Reversible** · Relates to: v3 §15.1/§15.3/§15.4, charter #1/#4/#14,
ADR-0018, ADR-0031, D-036, D-070, D-071

The prompt-6 boundaries held at runtime, but several of the fences that BACK them
up could be walked around in one line. Closed as one story rather than
line-by-line:

- **A sealed type is sealed against every way to produce one, not just a named
  cast.** `sealedType()` now walks base types (so `interface X extends
  TenantContext {}` cannot launder), and construction detection covers type
  predicates / assertion signatures, explicit generic type arguments, and a
  sealed ANNOTATION filled by a call from outside the factory (superseded by
  D-073, which decides that case from the initializer's TYPE rather than its
  callee). The ESLint mirror now seals all seven types and its two lists are asserted
  equal to the fence's registry, so it cannot drift narrower unnoticed.
- **The write exemption keys on a real DML statement reaching a resolved SQL
  executor.** The old unanchored regex matched the `FOR UPDATE` row lock already
  live in `house-crm.ts`, and any `auditedWrite` call — meaning the more
  auditable a PII read was, the less authorization it owed. Both are gone; genuine
  writers still reach an anchored `INSERT/UPDATE/DELETE` inside `perform`.
- **Governed-sink wiring is symbol-resolved end to end**: local aliases are
  followed into discovery, the authorized value is tracked by declaration symbol
  (a client-supplied `body.value.grant` no longer counts), the fail-closed return
  must be a direct statement of the guard, and the sink is matched by symbol
  rather than by a text form that never matches `owner.property` members.
- **A governed sink on a surface that cannot authorize is its own violation.**
  Server Actions and server components have no `NextRequest`, so they can never
  satisfy `requireActionGrant`. Rather than leave them unfenced or invent a
  request-less entry point in prompt 6, reaching a sink from one now fails the
  build with a message naming the rule and the remedy.
- **Test vocabulary and test AUTHORITY both enter through injection seams.**
  `"test"` left `SYSTEM_ACTOR_IDS` (a production security allowlist whose entries
  are load-bearing authority) for `registerTestSystemActor`, fenced — like
  `registerTestSpanName` — to have no shipped caller, keyed on resolved symbol so
  an alias cannot evade it.
- **The observability vocabularies are derived BOTH ways.** Span names and log
  messages already were; actions, enums, numeric fields, and id fields now are
  too, from the same call sites plus the audit intents that feed them. That
  surfaced three dead `OBSERVABILITY_ID_FIELDS` entries, a dead `status:
  "pending"`, and a genuinely missing `entityType: "Org"` (the seed's audited
  write would have logged `[REDACTED]`).
- **Account-ref candidates are extracted on the SAME basis the residual check
  reads.** Masking a name inserts slot digits that break the labeled-SSN
  proximity window, so a run redaction removed pre-mask survived post-mask:
  `"ssn Bob 123456789"` produced zero candidates and one refusing digit run — a
  refusal with nothing to declare. Extraction now runs over the subject-masked
  text, so the refusal is satisfiable (D-071's claim now holds in both directions).

**Line budgets:** contracts measured 1019 and domain 1201 after these fixes. The
ceilings were NOT raised (charter #1: platform ceilings only ratchet down);
duplicated prose and one duplicated doc block were consolidated instead, leaving
contracts at 980/1000 (20 lines of headroom) and domain at 1187/1200. Behaviour
is unchanged by every one of those edits.

**Alternatives:** require a `WriteActor` for the mutation exemption (rejected —
it misclassifies the pre-authentication identity writes `createUser`/
`createSession`, which legitimately hold only a `TenantContext`); add a
request-less authorization entry point so Server Actions can host governed sinks
(rejected — that is later architecture, and inventing it here would be designing
an authority surface with no consumer); raise the contracts ceiling by ADR
(rejected — the ratchet only goes down).

**Revert path:** revert this changeset. The narrower fences and the previous
vocabularies return; ADR-0031 and D-070/D-071 stand independently.

## D-073 — The app layer holds no SQL, and every mint is decided by type

**Date:** 2026-07-27 · **Reversible** · Relates to: v3 §15.1/§15.2/§15.3/§15.4,
charter #4/#7/#13/#14, ADR-0018, ADR-0031, D-036, D-072

D-072 closed the sealed-type and governed-sink stories against named evasions.
This round closes them against the SHAPES those detectors could not see, and
against the one place a persistence read could avoid both derivations entirely.

- **Raw SQL is an infrastructure privilege.** Governed-sink derivation and
  tenant-scope derivation both read repository SIGNATURES under
  `src/infrastructure/`, so an inline `db.query("SELECT id, email FROM users
  WHERE org_id = $1")` in a route is not a smaller repository call — it is
  outside both fences, with no signature to carry an `ActionGrant` or a sealed
  `TenantContext`. One shared detector (`detectAppLayerSqlAccess`) now fails the
  build on a resolved SQL-executor call anywhere under `src/app/`, and BOTH
  fences assert it so the two halves cannot drift apart. Two call sites moved:
  the audit export's actor-email lookup (below) and the readiness probe, now
  `readStoreReadiness` — a reviewed cross-tenant escape, since it reads no
  tenant rows.
- **The audit export needs TWO grants.** Exporting the chain is `audit.export`;
  resolving actor userIds to raw emails is a PII read that owes `pii.view`.
  `listOrgUserEmails` is a governed sink asserting its own grant, scoped by that
  grant's sealed tenant. Every role that could already export
  (ops/cco/principal/admin) also holds `pii.view`, so the ROLE taxonomy is
  unchanged; an advisor is still refused at the first grant.
  `detectUnwiredGovernedRoutes` therefore reads an authorization PROLOGUE — a
  sequence of (bind, fail-closed guard) pairs before any route work — instead of
  exactly one pair. (CORRECTED by D-074: "no authorized caller sees a behaviour
  change" was true of roles and false of SESSIONS — a second grant meant a second
  identity resolution, which 401s once the session passes its half-life.)
- **A mint is decided by the initializer's TYPE, never its callee.** The
  annotation rule keyed on "is this a call into the factory?", which missed the
  whole `any`-sourced class (`function tenantFromCache(raw): TenantContext {
  return JSON.parse(raw) }`, a class property, a bare `body.grant`) and inverted
  into a false positive on ordinary propagation, which only compiles when the
  right-hand side is ALREADY sealed. It now flags a sealed annotation, RETURN
  type, or class property filled from anything that is not already that sealed
  type. With that in place the `consultsFactory` escape had no remaining caller
  and was deleted — a dead escape is worse than none.
- **Naming a sealed type is not minting one.** Type-argument detection now keys
  on what a call YIELDS, so `new Map<string, TenantContext>()` and
  `useState<Principal | null>(null)` no longer fail the build while minting
  nothing, and `coerce<TenantContext>(raw)` still does.
- **A closed observability vocabulary is a TYPE.** `AuditedWriteOpts.action` and
  `.entityType` were `string`, so the two log lines carrying them derived nothing
  and flagged nothing. They are now `ObservabilityAction` /
  `ObservabilityEntityType` unions, and an attribute whose type is merely
  `string` is a build failure (as a dynamic span name already was). Attribute
  derivation also reads a hoisted bag, a resolvable spread, and a shorthand
  audit intent, refuses an unresolvable spread, and checks that an
  `observabilityId` mint's field matches the key it is logged under.
- **Sink discovery follows values, and refuses the ones it cannot follow.** A
  sink held in a literal bag, a conditional, or an array element is discovered
  and checked; one handed to another function as a value has no call site to
  authorize and is refused outright.
- **The unsupported-surface rule keys on what the surface IS** — a `"use server"`
  module, a reserved App Router component file name, a default-exported
  component — not on "not named route.ts", which rejected an ordinary app-layer
  handler helper whose remedy text it already satisfied. `src/app/route.ts` and
  the `export const GET = async (req) => …` form are now supported shapes.
- **Companions are measured against what they plant.** The shared sealed-type
  fixture no longer violates its own detector (it built a `TenantContext` from an
  object literal), so no companion in that file can pass on a baseline hit it did
  not plant; the two counting companions now assert per-branch messages.

**Line budgets:** contracts 980/1000 (20 lines of headroom, unchanged), domain
1189/1200, infrastructure 3146/3200. No ceiling was raised.

**Alternatives:** narrow the app-layer SQL rule to PII-shaped queries only
(rejected — "which columns are PII" is exactly the judgement a fence should not
be making at a call site with no boundary to declare); keep `consultsFactory` as
a guarded escape (rejected — with the type-based annotation rule nothing needed
it, and an escape with no caller cannot be proven load-bearing); substitute
`pii.view` for `audit.export` on the audit route (rejected — the ruling requires
both, and they authorize different things).

**Revert path:** revert this changeset. `listOrgUserEmails`/`readStoreReadiness`
fold back into their routes, the audit export returns to a single grant, and the
detectors return to their D-072 shapes.

---

## D-074 — One identity per request, and detectors that read shapes rather than spellings

**Date:** 2026-07-27 · **Reversible** · Relates to: ADR-0008, ADR-0018, ADR-0031,
v3 §15.1/§15.2/§15.3/§15.4, charter #1/#4/#12/#13/#14, D-030, D-072, D-073

D-073 landed the audit export's second grant and decided mints from types. This
round fixes the two REACHABLE regressions that came with it, closes the compile
bypass under v3 invariant 1's activation, and stops five detectors from keying on
how code is spelled instead of what it does.

- **A request resolves its principal ONCE.** Two `requireActionGrant` calls meant
  two `requirePrincipal` calls, and sliding renewal ROTATES the session id while
  writing the new cookie to the RESPONSE — `req.cookies` still holds the id the
  client presented, so the second lookup found a row renewal had already deleted
  and returned 401. Reachable on `/api/audit` for any session past its half-life
  (30 minutes of a 60-minute TTL), where `/app/audit` shows only "Could not load
  the audit trail." The in-flight promise is memoized on a `WeakMap` keyed by the
  request, so BOTH grants stay required and fail-closed, the prologue shape the
  governed-actions fence reads is unchanged, and rotation stays exactly where
  ADR-0008/D-030 put it. D-073's "no authorized caller sees a behaviour change"
  is corrected in place: it held for roles, not for sessions.
- **A logging helper never decides whether a write reports its own failure.**
  `observabilityId` throws on a non-opaque value, and `entityId` is CLIENT-SUPPLIED
  on `updateHouseholdName` (`PATCH /api/crm/households` validates only "non-empty
  string ≤100 chars"). Inside `auditedWrite`'s catch that throw escaped BEFORE the
  `[attempt failed]` entry was enqueued: `{"id":"Smith"}` returned an unenveloped
  500 instead of the typed 404 and silently lost the chain entry that exists to
  record the attempt (charter #13). `observabilityIdOrRedacted` degrades to
  `[REDACTED]` instead — the answer the log formatter would have given anyway —
  while the audit chain still records the real id for the examiner.
- **The sealed-annotation rule reads the VALUE, not the syntax.** It is a mint when
  the checker has stopped reasoning about what fills a sealed annotation (`any` /
  `unknown` / `never`), which is the only thing assignable to a `unique symbol`
  brand without a cast. That is two-sided: it catches `Promise<TenantContext>`
  returning `JSON.parse` (the normal async laundering shape) and the four positions
  the scan never visited (declare-then-assign, get accessor, parameter default,
  container annotation), while `const p: Principal | null = null` — flagged by the
  old "source is not already sealed" test — is a checked value, not a laundered
  one. Separately, a call mints when the sealed type came from a type parameter the
  signature INVENTS (named in the return, named by no parameter), so the inferred
  `const t: TenantContext = coerce(raw)` fails exactly like the explicit
  `coerce<TenantContext>(raw)`, while `unwrap<T>(r: Result<T>): T` — whose T was
  already sealed on the way in — does not. v3 invariant 1 was active on the
  explicit-only rule; it is now active on one that holds.
- **Five detectors moved from spelling to shape.** A SQL executor is recognized by
  the name it is DECLARED under, so `const { query } = db; query(sql)`,
  `const { query: run } = db`, and `db["query"](sql)` are the same app-layer
  persistence violation as `db.query(sql)`. The write exemption requires a write
  BOUNDARY — DML whose only reads are the locking pre-image reads it takes — so a
  PII read can no longer buy its exemption by writing an access record first, and a
  quoted VALUE (`WHERE detail = 'update household name'`) is data, not a DML head.
  PII reaches derivation through index signatures, alias arguments, and class-field
  arrows. The authorized value must BE the authorized payload or a projection of it
  at EVERY call site, not merely be mentioned near one at some call site. And a
  message-less `log.error({ status })` carries a checked attribute bag, while an
  attribute that is only SOMETIMES an opaque id is refused.
- **Three shapes stopped being unsatisfiable.** A repository annotated with its
  domain port is checked against its ADAPTER (the port's `MethodSignature` has no
  body and could never hold the assertion the fence demanded); a route-local helper
  is ordinary decomposition, resolved to the exported handler that calls it; and a
  sink INVOKED inside a callback argument has a call site to authorize, so it has
  not escaped. Each narrowing keeps its negative companion: the genuinely escaped
  `runReport({ load: repo.listClients })` still fails.
- **`ObservabilityAction` is typed, not sealed.** The claim that the union makes an
  out-of-vocabulary action "unrepresentable" was overstated — plain string unions
  have no factory and no brand, `raw as ObservabilityAction` still launders, and the
  persisted chain is wider still (`audit-store` suffixes a failed write's action
  with `.failed`). The comment now says what is true: the type closes the
  honest-caller case, and the vocabulary fence keeps both directions honest.

**Line budgets:** contracts 980/1000 (20 lines of headroom, unchanged), domain
1186/1200 (up from 1189's 11 lines of headroom to 14), infrastructure 3153/3200.
No ceiling was raised (charter #1). The two new domain mints were paid for by
consolidating prose and single-use branches in the same file; behaviour is
unchanged by every one of those edits.

**Alternatives:** drop one of the audit route's two grants to avoid the second
resolution (rejected — the ruling requires both, and they authorize different
things); move renewal out of `requirePrincipal` (rejected — ADR-0008/D-030 makes
that the single rotation point, and duplicating it is how the sharp edge in
CLAUDE.md was earned); make `observabilityId` itself non-throwing (rejected — where
an id is machine-generated a loud refusal is right, and it is what the account-
opening route's canonicalization is proven against); raise the domain ceiling by
ADR (rejected — the additions fit under it once duplicated prose was consolidated).

**Revert path:** revert this changeset. `requirePrincipal` resolves per call again
(and `/api/audit` 401s past the half-life), the error-path mints throw again, and
the detectors return to their D-073 shapes.

---

## D-075 — Migrations report rather than repair, and the fence suite finishes

**Date:** 2026-07-28 · **Reversible** · Relates to: ADR-0018, ADR-0030, ADR-0032,
D-016, v3 §15.1/§15.2/§15.3, charter #1/#4/#5/#7/#13

Captain ruling `prompt6-opus5-round4` decided sixteen review findings. Three of
them turned out to be the visible edge of a rebase collision: prompt 5's
decision-core contracts landed on main UNDER prompt 6's new fences, and
`llm-pii-boundary` had not completed a run since — 689 seconds, three assertions
past the 20s timeout, so the failures beneath them had never been read.

- **A migration REPORTS a store it cannot upgrade; it never repairs one.** Version
  3's tenant-qualified edges are data now (`TENANT_EDGES`), generating both the
  composite foreign keys and a read-only orphan PREFLIGHT that runs before any DDL
  and names the migration and every violating relationship at once. The
  `households.advisor_user_id` UPDATE it used to run is gone: silently NULLing a
  column a human populated is data loss dressed as an upgrade. `runMigrations` also
  rethrows with `{version, name}`, so a constraint abort at boot is no longer
  indistinguishable from a dataDir lock. Two constraints
  (`households_primary_contact_org_fk`, `tasks_assignee_org_fk`) were REMOVED: they
  reference columns shipped code writes as literal NULL, so MATCH SIMPLE skips them
  forever and no companion could ever trip them (charter #4/#5).
- **The `pii.view` exemption for a read outside a tenant boundary is now written
  down.** A repository returning raw PII with neither a boundary nor a grant derived
  no sink at all — no grant required AND invisible to the unsupported-surface rule.
  Eight callables take that shape and every one is genuinely pre-authorization,
  capability-keyed, or not a read; each is an exact-match entry with its reason, and
  the registry is derived complete both ways.
- **Four fence bypasses closed:** a data-modifying CTE could merge an audit INSERT
  into a PII read and collect the write-boundary exemption; a `createRequire` loader
  in `llm/` walked past the reachability check; the scrubber's file-wide exemption
  covered all seven sealed types instead of its own; and a module that renamed the
  logger (`const l = log`) or took a child logger dropped out of the vocabulary
  rules entirely. Route work decomposed into a same-file helper — the shape the
  governed-actions fence DOCUMENTS as supported — was reported as unwired, and a
  helper shared by GET and POST left the second verb's prologue unchecked.
- **Three rebase-induced fence failures fixed at the source, not by exemption.**
  `callablePIIExposures` read `String.prototype` members off branded primitives
  (27 findings about `anchor(name)`); the `piiFree` rule fired on Zod schemas that
  merely VALIDATE the flag; and `dependency-rule` read `declare const Brand: unique
  symbol` — the nominal-brand idiom every sealed type is built from — as a restored
  platform dependency. The 36 decision-core `evidence*` REFERENCES that remained are
  reviewed escapes with reasons, not a narrowed PII rule.
- **The suite finishes.** Every fence type walk keyed its visited set on
  `type.getText()`, which PRINTS the type. The key is unchanged — memoized on the
  interned compiler type — and companion fixtures stopped carrying `lib.dom.d.ts`.
  `llm-pii-boundary` 689s → 4s; the full suite now runs 54 files / 851 tests in 40s.

**Line budgets:** contracts **3892/3900**, domain 1189/1200, infrastructure
3198/3200, presentation 918/6000. The contracts ceiling came DOWN from 4000 to the
3,900 the ADRs actually authorize (3,500 from ADR-0029 + 400 from ADR-0032, with
ADR-0030 leaving contracts at 1,000); the headroom that paid for it came from
deleting six `Symbol(...)` seals that no code ever read — the WeakSets are what
`isTenantContext`/`isPrincipal`/… actually check, and the docblocks now say so.
No ceiling was raised (charter #1).

**Governance:** the prompt-6 line-budget ADR was renumbered **0029 → 0032** (the
number was already main's decision-core ADR) and every reference updated; the
prompt-6 proof-log entries were renumbered to continue monotonically from PF-030,
so each PF id names exactly one proof.

**Alternatives:** automatic repair of the orphan rows (rejected, and forbidden by
the ruling — the operator decides what the right owner is); narrowing `evidence` to
`\bevidence\b` in `PII_FIELD_RE` to clear 36 findings in one line (rejected — that
regex is also the runtime scrubber's authority, so narrowing it weakens a security
boundary to satisfy a fence); an identity-keyed visited set (rejected as a silent
behaviour change, though it was run first and reported the same findings, which is
how the text key was confirmed equivalent); raising the contracts ceiling to fit
(rejected — charter #1 ceilings only ratchet down).

**Revert path:** revert this changeset. Migration 3 returns to its NULLing UPDATE
and nine constraints, the `pii.view` inference goes back to requiring a tenant
parameter, the four bypasses reopen, and the fence suite stops finishing.

---

## D-076 - Exact projection trust and preflight-before-mutation upgrades

**Date:** 2026-07-28 · **Reversible** · Relates to: D-075, v3 §15.1/§15.2/§15.3,
charter #3/#4/#5/#7/#13

Leading title-case projection text now fails closed unless an exact identity span
binds it to a declared slot or a narrow static-template factory mints the exact safe
span. The identity path masks the span; the static-template path may leave only its
registered text visible. Caller booleans, caller-provided safe strings, forged spans,
and stale spans carry no authority.

The shared module-reference and structural PII walkers now supply sealed-factory,
secret, LLM, and governed-sink checks. Contextual callable returns are inspected for
sealed authority, and resolved structural SQL calls classify repository modules even
without a database-adapter import.

Every pending migration preflight runs before the first mutation in an existing
store. A virgin store applies the baseline alone, then re-enters the same upgrade
path so later preflights can query the schema. Migration failures expose only the
migration identity and the existing PII-safe error category.

**Alternatives:** a caller safe-text boolean and a harmless-word vocabulary were
rejected because neither binds authority to an exact span and provenance. Per-file
loader and PII scans were rejected because they drift from the shared semantic
walkers. Per-migration preflight was rejected because a later refusal could follow
an earlier committed schema mutation.

**Revert path:** revert this changeset to restore positional leading-token trust,
direct-loader-only scans, marker-only PII sinks, adapter-import-only repository
discovery, and per-migration preflight ordering.

---

## D-077 - Semantic security walkers and migration diagnostics fail closed

**Date:** 2026-07-28 · **Reversible** · Relates to: D-075, D-076, v3 §15.1/§15.2/§15.3,
charter #1/#4/#7/#13

Five shared roots closed the eight review findings. Module-reference analysis now
recognizes `Reflect.get` access to `createRequire`. Structural PII analysis exempts
only an exact `Tokenized` or `SecretValue`, traverses unsafe union siblings, and
treats opaque ungoverned outputs as PII. The only opaque exceptions are exact,
reasoned configuration, scrubber, database-capability, and resume-token boundaries.

Sealed construction walks project-owned containers and callable returns while
contextual object and implemented class methods are checked against their declared
contracts. One shared returned-callable walker supplies tenant and governed-sink
discovery for function, arrow, object, and class factories.

`ExecutionStore.loadById` now requires and asserts `ActionGrant<"pii.view">`.
`loadByToken` is the sole capability-keyed PII escape. Account-opening binds both
`execution.initiate` and `pii.view` before route work and threads each exact grant to
its sink.

Migration ledger bootstrap, applied-version reads, preflight probes, and mutations
all convert driver failures to PII-safe `AppError` categories. Intentional preflight
`AppError`s retain their actionable orphan report. Line ceilings remain unchanged at
contracts 3892/3900, domain 1200/1200, and infrastructure 3200/3200.

**Alternatives:** per-fence loader and PII scans were rejected because they drift.
Treating capability factories as tenant-record reads was rejected in favor of exact
reviewed opaque boundaries. Keeping `loadById` tenant-only was rejected because the
returned state is PII-bearing and needs the exact viewing capability.

**Revert path:** revert this changeset to restore direct-only reflected loading,
union-wide wrapper exemptions, opaque-output trust, syntax-limited factory discovery,
tenant-only continuation reads, and raw driver failures outside mutation transactions.

## D-078 - Case-insensitive PII shapes, proven-virgin bootstrap, and one authority prologue

**Date:** 2026-07-28 · **Reversible** · Relates to: D-075, D-076, D-077, ADR-0030,
ADR-0033, v3 §15.1/§15.2/§15.3/§15.4, charter #1/#4/#7/#13/#14

Fifteen review findings resolved to six roots.

**A detector keyed on one case is a detector with a hole.** Every sensitive-text
check composed a title-case shape (`\p{Lu}\p{Ll}`), which structurally cannot see an
ALL-CAPS name. "SMITH, JOHN" is an ordinary CRM rendering, so the candidate walk, the
masker, the residual check, and the LLM adapter's ingress gate were all blind at
once and `projectForLlm` would seal a raw name into a `Tokenized` value claiming
`piiFree: true`. The shape is now `PERSON_WORD_SOURCE` (title-case OR all-caps),
composed once and consumed by all four, and an unclassified all-caps run fails closed
through the SAME span-specific trusted-identity or safe-template contract the
title-case ruling established. No acronym allowlist, no caller-supplied safe flag, no
word vocabulary. The redaction sentinel is neutralized before shape-testing because
`[REDACTED]` is itself all-caps.

**An empty ledger is a claim, not a fact.** The bootstrap path trusted an empty
`schema_migrations` enough to apply and RECORD migration 1 before evaluating later
preflights. A dump restored without its ledger presents identically while holding
real rows, so versions were recorded against a schema nobody verified.
`assertManagedSchemaEmpty` proves the claim before the first mutation, against a
managed-object set derived from the shipped DDL.

**Two fences demanding the same statement slot make correct code unbuildable.** The
tenant fence and the governed-actions fence each required their own assertion be
literally statement #1, so a repository carrying both authorities as explicit
parameters could satisfy neither. Both now derive one shared authority-prologue rule:
required assertions run before anything else, in any order, and a dual-authority
signature additionally proves the two name the same scope. `assertSameTenant` ships
with a real caller (`createSession` had always written that comparison by hand).

**A runtime seal must not be copyable.** `AuthenticatedUser` used a non-enumerable
own symbol, readable off any real instance via `Object.getOwnPropertySymbols` and
stampable onto a forged object that would then mint a session. It now uses the
module-private WeakSet discipline the sealed security types already use, and its
assertion takes `unknown`. It deliberately does NOT use an assertion signature: that
would hand out a sealed `TenantContext` from an `unknown`, which the
tokenized-factory-only fence refuses, correctly.

**A shape is containment; an allowlist is just lost signal.** `safeReason` carried a
ten-entry SQLSTATE allowlist that omitted exactly the classes a migration failure
needs (42P01, 42703, 42P07, 42501, 3D000, 28P01), collapsing each to
"unexpected-error" in the one diagnostic that names what went wrong. The rule is now
the SQLSTATE shape itself, keyed on the two-character class, so a driver `code` of
"ALICE" is still refused. Producer and validator share one exported source fragment.

**Fences that fail open or key on the wrong thing.** App-layer SQL detection now
fails closed on an executor the checker cannot narrow; the governed non-PII escape is
keyed to the exact reviewed structural path rather than any same-named field nested
inside the declaration; the test-only authority registries and the reviewed factory
module list are existence-checked so a rename or typo breaks the build instead of
silently disabling a rule; a sealed-type cast hidden inside a typed container is a
mint; and the `llm-pii-boundary` module index is built once per project instead of
rescanning every source file per specifier.

**Registry and documentation truth.** Sixteen duplicate decision ids (D-040..D-055
appeared twice) were renumbered monotonically to D-062..D-077 with every exact
cross-reference updated. The proof-log range, the `revealSecret` accessor
description, and the D-036/D-061 citations were reconciled to the code. ADR-0030's
stated basis ("3,067 lines" against a 3,200 ceiling that shipped full) is corrected,
and ADR-0033 records the measured baseline, the new ceilings, and what this round's
own required corrections consumed.

**Alternatives rejected:** an acronym allowlist for all-caps text (it is the word
vocabulary the standing ruling forbids, and "IRA" and "SMITH" are indistinguishable
to it); keeping the SQLSTATE allowlist and adding six codes (the next migration needs
the seventh); making `assertSameTenant` fence-only scaffolding (charter #5 - it ships
with `createSession` or not at all); and raising the infrastructure ceiling past the
3,300 the amendment names to buy back the headroom this round spent.

**Revert path:** revert this changeset to restore title-case-only PII detection, the
trusting empty-ledger bootstrap, the two conflicting first-statement rules, the
copyable `AuthenticatedUser` marker, the SQLSTATE allowlist, the fail-open SQL
detector, and the duplicated decision ids.

## D-079 - Sealed positions, order-free authority, and value-resolved SQL

**Date:** 2026-07-28 · **Reversible** · Relates to: D-078, ADR-0033, ADR-0034,
v3 §15.1/§15.2/§15.3, charter #1/#4/#7/#13/#14

Fifteen findings from the eighteenth review round, two of which were regressions the
seventeenth round introduced. They resolve to five roots.

**"Mentions it somewhere" is not "delivers it here."** The sealed-cast rule exempted a
cast whose SOURCE type reached the target sealed type anywhere in its graph. An
`ActionGrant` carries both a `TenantContext` and a `WriteActor`, so every governed
route handler holds a value that mentions three sealed types, and `grant as unknown as
TenantContext` - the only compile-legal cast form past a `unique symbol` brand, i.e.
the mainline laundering shape - passed with zero violations while the ESLint mirror
still flagged it. Source and target are now compared at the same STRUCTURAL POSITION,
with the sealed key carrying its type arguments, so re-shaping an authorized value
still passes and `ActionGrant<"pii.view">` cannot become
`ActionGrant<"decision.approve">`. The same position walk closes the mint nested one
property inside a composite literal argument.

**Neutralizing a sentinel must not neutralize the signal around it.** Blanking
`[REDACTED]` to whitespace before shape-testing also erased the "there is preceding
content" fact the embedded-name check reads, so caller-supplied text of the form
`[REDACTED] Alice` sealed as `piiFree: true` with the raw name intact - while the
identical `wire to Alice` was refused. The stand-in is now a non-letter,
non-whitespace mark: content, never a word.

**The all-caps gap had a second site.** `NAME_SHAPED_RE` in the observability
predicate was still title-case only, so `observabilityId("entityId", "SMITH-JOHN")`
succeeded and the value went verbatim into the log line and out over OTLP - and
`entityId` is client-supplied. It now composes the same `PERSON_WORD_SOURCE`, gated on
the value carrying no digit, which is what keeps uppercase-hex ids working.

**Authority is a set, not a first parameter.** The prologue derivation returned on the
FIRST sealed parameter, so declaring the grant before the tenant dropped both the
tenant assertion and the same-tenant proof; wrapping the tenant in an object escaped
both fences; and widening the grant's action to a union removed every requirement at
once. One shared derivation now collects EVERY sealed authority a signature carries,
recognizes one carried inside an object parameter where none is named directly, and
refuses a grant whose action is not a single literal rather than silently dropping the
cross-check. Action arguments compare by VALUE again, so quote style cannot reject a
correct boundary.

**Fail closed on the value, not on the spelling.** The app-layer SQL detector's
fail-closed arm keyed on the WRITTEN callee name, so renaming a widened local walked
through the very evasion the arm was added to close. It now follows an unresolvable
callee back to what it was bound from, and treats a SQL statement handed to an
unresolvable callee as persistence under any name. The reviewed non-PII escape
registry became existence- and staleness-checked, the governed-sink and unbounded-read
derivations are memoized per project (five full type-checker passes to two), and the
managed-object probe's trigger clause is scoped to `current_schema()` so a neighbour
schema's same-named trigger can no longer refuse a correct virgin bootstrap.

**Alternatives rejected:** keeping "reachable anywhere" and adding a target-is-container
guard only (the recast-to-another-action hole survives, since matching was by symbol
name); requiring the grant assertion for every member of a union action (no single
assertion proves a union - the signature is refused instead); demanding an assertion on
every structurally carried tenant (`createSession` takes both a `TenantContext` and an
`AuthenticatedUser` that carries one, and that has one scope, not two); and raising the
domain ceiling speculatively alongside infrastructure (ADR-0034: each layer moves on
its own measurement).

**Revert path:** revert this changeset to restore the reachable-anywhere cast
exemption, the whitespace sentinel stand-in, title-case-only observability ids, the
order-dependent authority prologue, and the name-keyed SQL fail-closed arm.

## D-080 - Grant pairs, migration bootstrap, and LLM projection fail before mutation

**Date:** 2026-07-28 · **Reversible** · Relates to: D-076, D-078, D-079,
ADR-0034, v3 §15.1/§15.3, charter #1/#4/#7/#13

Four review findings were legitimate symptoms of four shared-boundary gaps.

Every `ActionGrant` in a callable now owes its own exact literal action assertion,
and every pair of grants must prove equal tenant and actor scope in the contiguous
authority prologue. An explicit `TenantContext` is compared with every grant as
well. `startAccountOpening` performs the execution and PII grant comparison before
request validation, replay loading, or writes. Cross-tenant replay and same-tenant
cross-actor integration cases both fail with `AUTH_FAILED`.

Migration bootstrap now discovers the ledger with a read-only, current-schema
probe. If the ledger is absent, managed-schema virginity is proven before any DDL
creates or changes the ledger. An existing empty ledger retains the post-bootstrap
virginity check. A real PGlite regression drops the ledger from a populated store
and proves the complete schema, indexes, and rows remain unchanged after refusal.

Sensitive projection values are replaced only at complete Unicode letter, number,
or underscore-delimited occurrences. Masking and the post-mask residual check use
the same occurrence rule, so a binding for `Ann` masks `Ann` but leaves `annual`
intact. Evidence must satisfy the plain-data contract before masking and again
after masking; `Date`, `Map`, and class instances can no longer be flattened into
apparently trusted plain objects.

The line-budget fence measures contracts 3,944/4,000, domain 1,231/1,250,
infrastructure 3,344/3,400, and presentation 918/6,000 after these corrections.
No ceiling changes, so the ADR amendment process is preserved without a new
amendment.

**Alternatives rejected:** compare only the first grant (a third grant reopens the
same hole); create the ledger and rely on refusal afterward (the refusal mutates the
schema it claims unchanged); keep substring replacement and special-case short
names (the next short value repeats the corruption); and trust post-mask validation
alone (object flattening destroys the evidence needed to reject the input).

**Revert path:** revert this changeset to restore first-grant-only prologue
derivation, mutation-before-virginity proof, unbounded substring masking, and
post-mask-only evidence validation.

## D-081 - Recursive authority discovery, lowercase identity provenance, and atomic migration plans

**Date:** 2026-07-28 · **Reversible** · Relates to: D-076, D-078, D-080,
ADR-0034, v3 §15.1/§15.3, charter #1/#4/#7/#13

Authority discovery now recursively walks every non-callable member path and keeps
all direct and wrapped sealed authorities in declaration order. The tenant-scope
fence uses that same derivation instead of a second name-limited prefilter. Every
grant owes its exact action assertion, and every pair of discovered authority scopes
owes `assertSameTenant`, which compares organization and actor identity before work.

Lowercase leading actor-shaped text is now a projection candidate and a residual
failure. It can be masked only when exact identity-span metadata binds the complete
word to a declared subject slot. The same shape in untyped evidence is refused,
while ordinary lowercase request prose remains accepted without a harmless-word
vocabulary or caller safe flag.

The migration runner now executes ledger bootstrap, applied-version discovery, and
each pending preflight followed by its DDL and ledger row inside one outer
transaction. A later preflight can query objects created by an earlier pending
migration, and any later refusal rolls back every earlier pending mutation,
including creation of the migration ledger on a virgin store. Missing-ledger
virginity is still proven before ledger DDL.

The line-budget fence measures contracts 3,944/4,000, domain 1,250/1,250,
infrastructure 3,343/3,400, and presentation 918/6,000. No ceiling changed.

**Alternatives rejected:** preserve one-level wrapper names and add `piiGrant`
to the list (the next wrapper name or nesting level reopens the gap); classify
lowercase names with a harmless-word vocabulary (caller prose would define its own
safety); and commit each migration separately after a global preflight phase
(dependency order and all-or-nothing rollback cannot both hold).

**Revert path:** revert this changeset to restore name-limited authority discovery,
lowercase identity pass-through, and phase-separated migration execution.

## D-082 - Closed authority inventories, reviewed projection text, and canonical record identities

**Date:** 2026-07-28 · **Reversible** · Relates to: D-079, D-080, D-081,
ADR-0031, ADR-0034, v3 §15.1/§15.3/§15.4, charter #1/#4/#7/#13

Five review findings were legitimate symptoms of shared boundary gaps.

Authority discovery now enumerates closed union and fixed-tuple arms only when
every arm yields one identical, complete authority-path inventory. Conditional
absence, arrays, open records, and index signatures are refused because their
runtime authority set cannot be proven statically. Direct and nested authorities
remain in one inventory and owe every exact action assertion and pairwise tenant
and actor comparison before work.

Unrestricted request text can no longer receive a zero-PII seal. A narrow reviewed
static-template factory owns the complete literal structure and exact sensitive
placeholder spans. Copies, stale or caller-constructed provenance, unused or
overlapping spans, and unbound lowercase names are refused. One separator-aware
account classifier drives candidate extraction, complete masking, and residual
validation for unbroken, space-separated, and hyphenated forms.

Workflow dependencies now compare the complete sealed tenant and actor identity
supplied by the engine with the starter before deriving write attribution.
Same-organization different-human, human-versus-system, and delegated-actor
mismatches fail with `AUTH_FAILED` before repository work.

Machine record IDs have family-typed canonical parsers backed by one
case-insensitive UUID shape. The household PATCH boundary parses and lowercases
its client ID before lookup, preserving legacy mixed-case UUID compatibility while
rejecting lowercase slugs. Observability application, entity, execution, and
outbox-row ID fields accept only that same machine shape; invalid failure-path IDs
degrade to `[REDACTED]` without losing the failure audit.

The line-budget fence measures contracts 3,998/4,000, domain 1,250/1,250,
infrastructure 3,379/3,400, and presentation 918/6,000. No ceiling changed, so no
line-budget ADR amendment was required.

**Alternatives rejected:** infer unrestricted lowercase prose from suffixes (no
heuristic proves PII absence); enumerate another wrapper name (dynamic carriers
remain unprovable); compare only organization IDs at dependency calls (write
attribution can name another actor); and keep generic slug identifiers in
observability (client names remain loggable).

**Revert path:** revert this changeset to restore conditional authority carriers,
heuristic free-text provenance, unformatted-only account detection, organization-only
dependency checks, and generic slug record identities.

## D-083 - Loader provenance, stable authority captures, callable returns, and sealed unions fail closed

**Date:** 2026-07-28 · **Reversible** · Relates to: D-079, D-080, D-082,
ADR-0034, v3 §15.1/§15.2/§15.3/§15.4, charter #1/#4/#7/#13

Four review findings were legitimate symptoms of shared semantic-walker gaps.

Destructured and assignment-bound `Reflect.get` values now retain their receiver
and property provenance. A reflected `createRequire` loader is therefore reported
by the shared module-reference walker before it can bypass the layer, LLM PII,
sealed-factory, or secret-containment fences. An unresolved reflected property
fails closed when it is invoked over the Node module namespace.

Every wrapped sealed authority is captured once into a `const` binding at the
start of the shared authority prologue. Assertions and pairwise tenant-and-actor
proofs must use that binding, and a later re-read of the carrier is refused. The
three shipped wrapped-authority boundaries now follow the same rule.

Returned-callable discovery recursively resolves object literals, transparent
wrappers, fixed conditionals, local variables, private class instances, inherited
public methods, callable fields, and callable accessors. When a statically typed callable return has
no resolvable implementation, the returned method is represented as unresolved
and fails its execution-boundary checks. SQL database capability factories remain
outside repository-method discovery by their exact `SqlDb`/`SqlTx`/`SqlQueryable`
return contracts, not by a filename allowlist.

A sealed reshape across a union is valid only when every possible arm exposes the
same sealed key at the same structural position. Intersections are evaluated as
simultaneous constraints rather than alternative runtime arms. Direct and nested
`TenantContext | string` laundering now fail while same-key union and intersection
reshapes remain valid.

The authoritative line-budget metric after these corrections is:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 3,998 | 4,000 | 2 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,382 | 3,400 | 18 |
| presentation | 918 | 6,000 | 5,082 |

No ceiling changed. The fixes added no contracts or domain production lines, and
no useful code or documentation was deleted or compressed to manufacture room.
Infrastructure grew only by the stable authority bindings required at live
boundaries. Any subsequent contracts or domain growth requires a new measured ADR
amendment before it can pass the fence.

**Alternatives rejected:** enumerate another loader spelling (destructuring and
assignment aliases would drift again); reject all wrapped authority carriers
(closed carriers are statically enforceable once captured); inspect exported
classes only (private implementations returned by public factories remain live);
and accept a union when any arm is sealed (an unsealed runtime arm can still be
asserted into authority).

**Revert path:** revert this changeset to restore destructured reflection gaps,
carrier re-evaluation, object-literal-only returned-callable discovery, and
first-matching-arm sealed reshape acceptance.

## D-084 - Structural paths, returned accessors, and authority producers stay visible

**Date:** 2026-07-28 · **Reversible** · Relates to: D-079, D-080, D-083,
ADR-0034, v3 §15.1/§15.3, charter #1/#4/#7/#13

Four review findings were legitimate symptoms of three shared traversal gaps.

Sealed-position discovery now uses path-local cycle state. Repeated sibling
properties with the same sealed type remain distinct complete paths, so a checked
first sibling cannot hide an unchecked second sibling in either a cast or a
contextual composite literal.

Returned-callable discovery handles object-literal accessors exactly like class
accessors. A callable returned from a getter is resolved to its implementation, and
an unresolved callable return remains a fail-closed execution boundary for both the
tenant and governed-sink analyzers.

Authority inventory rejects call, construct, method, callable-member, and
constructable-member returns that can produce sealed authority. Such providers have
runtime-dependent inventories and cannot satisfy a static prologue. Stable wrapped
authorities remain supported, but later property reads, binding-pattern reads, and
destructuring assignments are resolved back to their carrier provenance and refused.

The authoritative line-budget metric remains unchanged because this round changes
only fitness analyzers and their companions:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 3,998 | 4,000 | 2 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,382 | 3,400 | 18 |
| presentation | 918 | 6,000 | 5,082 |

No ceiling changed, and no production code or documentation was compressed to
manufacture room.

**Alternatives rejected:** retain a global type/depth visited set and special-case
the reported sibling name (another repeated type would disappear); treat an
object-literal getter as data (its returned function remains executable); enumerate
provider member names (the next method name reopens the gap); and detect later reads
only by matching authority types (that loses carrier ownership and can reject an
unrelated stable authority).

**Revert path:** revert this changeset to restore repeated-sibling suppression,
object-accessor omission, type-only carrier reread detection, and dynamic authority
provider acceptance.

## D-085 - Complete semantic security paths and pre-work retry ownership

**Date:** 2026-07-29 · **Reversible** · Relates to: D-079, D-080, D-083,
D-084, ADR-0034, v3 §15.1/§15.2/§15.3/§15.4, charter #1/#4/#7/#13

Seven review findings were legitimate symptoms of shared semantic-analysis and
workflow-ownership gaps.

The shared module-reference walker now resolves direct, destructured, bound,
`call`-wrapped, and `apply`-wrapped `Reflect.get` access. A statically unresolved
`apply` argument list fails closed, so reflective `createRequire` construction
cannot disappear from the layer, LLM PII, sealed-factory, or secret-containment
scans.

Sealed-position discovery now reports whether its complete structural inventory
was proven. Recursive cycles and paths beyond the reviewed depth are refusals
rather than silent truncations, and every call and construct overload has its own
indexed return position. The same source-versus-target comparison now protects
annotations, assignments, returns, parameter defaults, contextual literals, and
call arguments when `any`, `unknown`, or `never` appears at a sealed position.

Every direct or captured sealed authority binding is immutable after its prologue
assertion. Assignment, destructuring assignment, update, and loop-target writes
are resolved by symbol, without confusing nested shadow bindings. Callable
parameters that can return or receive `TenantContext`, `ActionGrant`, `ActorRef`,
`Principal`, `AuthenticatedUser`, or `WriteActor` are runtime-dynamic authority
carriers and cannot claim a fixed prologue inventory.

Governed-sink and reviewed pre-auth PII classification now reuse the shared
recursive authority inventory. Nested tenant or grant parameters therefore derive
the same boundary as direct parameters, and unfenceable dynamic carriers cannot
retain a pre-auth escape.

`retryFlow` validates the runtime tenant seal and compares execution ownership
before calling `drive`. A cross-tenant failed execution returns `AUTH_FAILED`
without running a step or writing through a dependency. The duplicate failed-resume
explanation now points to `retryFlow` as the single saved-cursor contract owner.

The authoritative line-budget metric after these corrections is:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 3,998 | 4,000 | 2 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,382 | 3,400 | 18 |
| presentation | 918 | 6,000 | 5,082 |

No ceiling changed. Domain remains at its ratified ceiling. One duplicated
failed-resume explanation was consolidated under the adjacent `retryFlow`
contract, preserving the operational guidance while making ownership explicit.

**Alternatives rejected:** enumerate only the reported reflection spellings
(another wrapper reopens loader construction); keep the first overload or truncate
deep sealed paths (unexamined runtime values can mint authority); reject only
whole-value `any` and `unknown` (nested unchecked members remain mints); trust a
mutable parameter after its assertion (rebinding creates a time-of-check/time-of-use
gap); and rely on the execution store's eventual ownership refusal (a step can
write before the save).

**Revert path:** revert this changeset to restore wrapped reflection gaps,
incomplete sealed inventories, nested unchecked mints, mutable authority bindings,
callback authority carriers, direct-only governed classification, and post-step
retry ownership checks.

## D-086 - Failure boundaries disclose no foreign state and semantic guards read once

**Date:** 2026-07-29 · **Reversible** · Relates to: D-079, D-083, D-085,
ADR-0034, v3 §15.1/§15.2/§15.4, charter #1/#4/#7/#13/#14

Four review findings were legitimate symptoms of shared failure-boundary and
semantic-analysis gaps.

`retryFlow` now returns an empty payload when execution ownership disagrees with
the sealed tenant. The ownership refusal still occurs before `drive`, and the real
PGlite regression proves sentinel foreign PII cannot cross the result while step
and execution-store write counters remain zero.

The shared module-reference walker treats `Reflect.get`,
`Object.getOwnPropertyDescriptor`, and `Object.getOwnPropertyDescriptors` as
property-read authorities, including the matching Reflect descriptor API. Direct,
destructured, assigned, bound, call-wrapped, apply-wrapped, and statically unresolved
keys are resolved through one accessor path. A descriptor cannot obtain
`node:module.createRequire` without producing the same fail-closed reference
consumed by the layer, LLM PII, sealed-factory, and secret-containment fences. A
statically different property remains clean.

Sealed annotation enforcement now inventories every structural sealed position
with its exact owning factory. A factory exemption applies only to positions that
factory owns, so `Tokenized` ownership inside `tokenize.ts` cannot hide a sibling
`TenantContext` forged from unchecked input. Incomplete inventories still fail
closed for every foreign sealed type they may contain.

Error-code classification now reads an untrusted `code` property once behind a
guarded access. The captured value alone is checked against the shared closed
`ErrorCode` set and the SQLSTATE shape. Stateful getters cannot swap a safe code
for PII between checks, and a throwing getter degrades to `unexpected-error`
without replacing the original failure.

The authoritative line-budget metric after these corrections is:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,000 | 4,000 | 0 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,383 | 3,400 | 17 |
| presentation | 918 | 6,000 | 5,082 |

No ceiling changed. Contracts gained one shared closed-code predicate and reused
it from both error validation paths. Domain changed one returned value without
growing. Infrastructure retained readable guarded access with 17 lines of bounded
headroom. No useful code or documentation was removed or compressed to manufacture
room.

**Alternatives rejected:** return the foreign state on an authorization error
(ownership refusal would still disclose PII); special-case only the written
descriptor expression (aliases and wrappers would remain invisible); exempt a
whole factory module when it owns any sealed type (a local seal would continue to
hide foreign mints); and validate a getter separately for app and driver errors
(each validation would invoke attacker-controlled code again).

**Revert path:** revert this changeset to restore foreign retry payloads,
descriptor-based loader gaps, first-seal factory exemptions, and repeated
untrusted error-code reads.

## D-087 - Semantic copies and failure values preserve security provenance

**Date:** 2026-07-29 · **Reversible** · Relates to: D-083, D-085, D-086,
ADR-0035, v3 §15.1/§15.2/§15.4, charter #1/#4/#7/#13/#14

All six review findings were legitimate symptoms of shared semantic-provenance
and failure-boundary gaps.

SQL executor calls now normalize direct calls plus `call`, `apply`, `bind`, and
`Reflect.apply`. The normalized form retains the executor, receiver, effective
arguments, and whether an argument list was statically resolved. App-layer SQL
refusal, SQL-backed repository discovery, tenant enforcement, and governed-action
classification all consume that one result.

Authority reads now preserve carrier provenance through object spread, object
rest, `Object.assign`, `Object.entries`, `Object.values`, and
`structuredClone`. Copying an ancestor carrier after a stable authority capture
therefore counts as another evaluation, while independent sibling captures remain
valid.

The module-reference walker preserves `node:module` namespace provenance through
object spread, `Object.assign`, and `Reflect.apply` accessor invocation. The
dependency, LLM PII, sealed-factory, and secret-containment fences share the
result. Escaped repository factories also fail closed when an opaque declared
return prevents their returned callable inventory from being proven.

Every observability identifier now uses the shared separator-aware account
classifier before sealing. Uninterrupted, space-separated, and hyphenated account
references therefore receive the same refusal at LLM and observability boundaries.

`normalizeAppError` replaces accessor-backed accepted errors with a frozen
snapshot built from guarded single reads of `code`, `message`, and optional
primitive context. Response, audit, workflow, store, identity, wiring, and script
paths consume only the snapshot. Throwing accessors degrade to the existing
closed INTERNAL response.

The authoritative line-budget metric after these corrections is:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,017 | 4,050 | 33 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,390 | 3,400 | 10 |
| presentation | 918 | 6,000 | 5,082 |

ADR-0035 raises only contracts from 4,000 to 4,050. Domain stays at its measured
ceiling without removing useful code or documentation. Infrastructure stays under
its existing ceiling.

**Alternatives rejected:** enumerate only the reported wrapper spellings
(equivalent invocation forms remain open); treat carrier copies as fresh trusted
values (stateful getters can change authority); allow opaque escaped factory
returns (repository methods disappear from analysis); keep a second account regex
(boundaries drift); and return a recognized hostile object unchanged (later reads
can leak or throw).

**Revert path:** revert this changeset to restore wrapped SQL, carrier-copy,
namespace-copy, opaque-factory, formatted-account, and accessor-backed error gaps.

## D-088 - Migration, authority, and failure provenance remains structural

**Date:** 2026-07-29 · **Reversible** · Relates to: D-083, D-085, D-087,
ADR-0036, v3 §15.1/§15.2/§15.3/§15.4, charter #1/#4/#7/#13/#14

All seven review findings were legitimate symptoms of shared history-validation,
semantic-provenance, and failure-boundary gaps.

Migration startup now proves the applied version and name rows are an exact
contiguous prefix of `MIGRATIONS` before any pending preflight, DDL, or ledger
write. Gapped, extra, renamed, and reordered restored ledgers fail without
changing managed relations, indexes, triggers, routines, constraints, rows, or
ledger contents.

Governed sink discovery retains one requirement for every distinct
`ActionGrant` and governed-output action. Route matching and deduplication preserve
the action, so `startAccountOpening` requires both `execution.initiate` and
`pii.view`, and each authorized value must reach its own grant position.

The shared module walker uses every potentially reaching source for aliases across
conditional and logical control flow. Namespace provenance survives spread,
`Object.assign`, and `Object.fromEntries(Object.entries(...))` copies. The layer,
LLM PII, sealed-factory, and secret-containment fences therefore refuse each
indirect `node:module.createRequire` path.

SQL executor normalization follows direct, destructured, and later-assigned
aliases for both executors and ambient `Reflect.apply`. App-layer SQL refusal,
repository discovery, tenant enforcement, and governed-action classification all
consume the normalized call.

Repeated-authority analysis preserves every potentially reaching carrier source
through conditional, logical, copy, destructuring, and later-assignment aliases.
A stateful wrapped authority cannot be read again under a binding that inherited
the original prologue's trust.

Unknown-error metadata is captured once behind guarded reads. Audited writes,
safe reasons, and duplicate-submit handling share one frozen classification, so
proxy traps and throwing or stateful accessors cannot escape or replace the typed
failure. Raw captured fields never leave that boundary; callers receive only a
normalized AppError, validated SQLSTATE, boolean PII-violation classification,
and safe reason.

The authoritative line-budget metric after these corrections is:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,017 | 4,050 | 33 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,437 | 3,450 | 13 |
| presentation | 918 | 6,000 | 5,082 |

ADR-0036 raises only infrastructure from 3,400 to 3,450. The new exact-prefix
validation and shared read-once failure boundary account for the measured growth.
No useful code or documentation was removed or compressed to manufacture room.

**Alternatives rejected:** trust ledger versions without names or ordering
(restored history can silently skip tenant constraints); collapse a multi-action
sink to one action (the second authority disappears from route enforcement);
choose only the latest textual alias assignment (conditional reaching sources are
lost); enumerate reported loader and SQL spellings (equivalent aliases remain
open); and classify hostile errors separately at each catch site (implementations
drift and attacker-controlled accessors are reread).

**Revert path:** revert this changeset to restore non-prefix migration acceptance,
single-action sink derivation, ambiguous alias provenance, and repeated hostile
error metadata reads.

## D-089 - Executable security work retains semantic ownership

**Date:** 2026-07-29 · **Reversible** · Relates to: D-083, D-085, D-088,
v3 §15.1/§15.2/§15.3/§15.4, charter #1/#4/#7/#13/#14

All five review findings were legitimate symptoms of incomplete semantic
ownership and provenance analysis.

Every infrastructure SQL executor call must now belong to a checked exported
callable, a returned repository implementation, an exported class method, or a
local helper whose every call is recursively owned by one of those boundaries.
Exact reviewed global escapes remain callable-scoped. Module initializers, IIFEs,
static blocks, exported data or promise initializers, and helpers that escape as
values fail as unowned SQL.

Ambient builtin resolution follows aliases and every potentially reaching
assignment. SQL normalization therefore recognizes `Reflect.apply` independent
of receiver spelling, and all app-layer SQL, repository, tenant, and
governed-action consumers receive the same normalized result.

The module-reference walker carries `node:module` namespace provenance through
named and nested object members plus later property assignments. The dependency,
LLM PII, sealed-factory, and secret-containment fences continue to consume that
single result.

Repeated-authority analysis normalizes `Reflect.get`, property-descriptor reads,
and their `call`, `apply`, `bind`, and `Reflect.apply` forms. Literal key
provenance retains exact member paths; unresolved keys expand conservatively to
the carrier, so a stateful authority getter cannot be read after its stable
prologue capture.

Governed callee discovery traverses every value-producing conditional and
logical arm. Node identities include kind, start, and end positions so a compound
expression cannot collide with its leftmost child. A known governed sink paired
with an unresolved callable arm fails closed.

The authoritative line-budget metric after these corrections is:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,017 | 4,050 | 33 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,437 | 3,450 | 13 |
| presentation | 918 | 6,000 | 5,082 |

Only fitness analyzers, adversarial companions, and their decision evidence
changed. The platform layer counts and ADR ceilings therefore remain exact and
unchanged. No useful code or documentation was removed or compressed to
manufacture room.

**Alternatives rejected:** check only exported signatures without proving SQL
call ownership (module execution remains invisible); recognize only the literal
`Reflect` receiver (aliases bypass every SQL consumer); enumerate one object
holder spelling (nested and assigned members remain open); add separate regexes
for each reflective authority form (invocation wrappers drift); and treat a
compound callee as one node keyed only by its start offset (its left arm
disappears).

**Revert path:** revert this changeset to restore unowned SQL execution, ambient
builtin and namespace-member provenance gaps, repeated reflective authority
reads, and incomplete governed-callee traversal.

## D-090 - Resume and semantic provenance boundaries fail before work

**Date:** 2026-07-29 · **Reversible** · Relates to: D-083, D-085, D-089,
ADR-0037, v3 §15.1/§15.2/§15.3/§15.4, charter #1/#3/#4/#7/#12

All six review findings were legitimate. The resume finding was a local
validation-order defect at an intentionally unscoped capability load. The other
five findings shared incomplete ownership or provenance traversal in security
fitness analyzers.

`resumeFlow` now validates the runtime `TenantContext` seal before
`loadByToken`. A forged context with a matching organization can no longer load
or expose PII-bearing state, start a workflow step, or perform a write. The
integration companion runs against PGlite and asserts zero loads, saves, step
runs, and durable household writes while sentinel foreign data stays absent from
the typed failure.

Module-reference provenance now follows fixed array and tuple members, exact
element access, and array destructuring. Unresolved indexes expand
conservatively. Ambient builtin accessor aliases retain every potentially
reaching source after the latest guaranteed assignment, so a conditional safe
replacement cannot erase a reachable `Reflect.get`.

Sealed construction analyzes every structural position independently. A
factory-owned `Tokenized<T>` position no longer exempts a sibling
`TenantContext` or other foreign seal in casts, contextual literals,
annotations, assignments, returns, parameter defaults, or call arguments.
Incomplete inventories emit every foreign sealed owner instead of selecting one.

Governed call resolution follows later local assignments and values returned by
statically resolved helpers. Both wired and missing-authorization companions
prove that the exact sink action remains attached to the route. SQL normalization
resolves `Reflect.apply` through fixed-array destructuring and exact array member
aliases, and the normalized call is shared by app-layer refusal, repository,
tenant, and governed-action analysis.

The runtime seal check added one domain line to a layer that had no headroom.
ADR-0037 raises only domain to the smallest rounded envelope. No useful code or
documentation was removed or compressed:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,017 | 4,050 | 33 |
| domain | 1,251 | 1,300 | 49 |
| infrastructure | 3,437 | 3,450 | 13 |
| presentation | 918 | 6,000 | 5,082 |

**Alternatives rejected:** validate the runtime seal after the capability load
(foreign state can already escape); enumerate only the reported array spellings
(equivalent aliases remain open); select the latest textual alias assignment
(conditional writes are not guaranteed); exempt a whole composite by its first
sealed position (foreign sibling seals disappear); and inspect only declaration
initializers for governed callees (later assignments and helper returns remain
unowned).

**Revert path:** revert this changeset to restore pre-validation continuation
loads, array and conditional provenance gaps, whole-composite factory
exemptions, and incomplete governed sink ownership.

## D-091 - Security boundaries retain trusted provenance through wrappers

**Date:** 2026-07-29 · **Reversible** · Relates to: D-083, D-085, D-089,
D-090, v3 §15.1/§15.2/§15.3/§15.4, charter #1/#3/#4/#7/#12/#14

All seven review findings were legitimate. The error finding exposed an
authentication flaw at the contract boundary. The remaining findings shared
incomplete semantic ownership or provenance traversal in security fitness
analyzers.

`AppError` instances now carry module-private WeakSet provenance and are frozen
with copied, frozen context. Only errors created through `appError` retain their
message. Unknown recognized-code lookalikes normalize to a static safe message
without reading attacker-controlled message or context accessors. Observability
classification reads unknown driver code once and consumes only the normalized
snapshot.

Module-reference provenance treats `Object.freeze`, `Object.seal`, and
`Object.preventExtensions` as transparent namespace wrappers. Fixed-array
builtin aliases use the shared conservative resolver, so array-destructured
`Reflect.get` reaches the same loader analysis as direct and object-destructured
forms without weakening guaranteed overwrite handling.

Repeated-authority analysis carries exact carrier provenance through fixed
arrays and transparent wrappers. Unresolved transparent invocation arguments
expand to the complete captured authority inventory. A stateful getter cannot
be read again after the stable authority capture under a new trusted spelling.

Governed call discovery resolves getter-returned callables and normalizes
`bind`, `call`, `apply`, and `Reflect.apply` to the underlying sink. The same
normalization supplies effective argument positions to helper and grant wiring,
and a `Reflect.apply` target is treated as an invocation rather than an escaped
value.

Invented generic returns are checked at every sealed position in explicit
objects, tuples, arrays, unions, project-owned wrappers, and overloads.
Factory ownership is applied per sealed owner, so an allowed `Tokenized<T>`
position cannot hide a foreign `TenantContext`. Foreign generic validators that
only name a sealed type remain ordinary validation containers rather than
construction sites.

SQL ownership now maps each exported object callable to its exact method,
accessor, or property implementation. A guarded sibling cannot claim SQL in an
effectful non-callable getter. SQL in parameter default initializers is rejected
as pre-body execution because no function-body authority prologue can authorize
work that already ran.

The authoritative line-budget metric remains within the existing measured ADR
ceilings:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,017 | 4,050 | 33 |
| domain | 1,259 | 1,300 | 41 |
| infrastructure | 3,442 | 3,450 | 8 |
| presentation | 918 | 6,000 | 5,082 |

No ceiling changed. No useful code or documentation was removed or compressed
to manufacture room.

**Alternatives rejected:** trust recognized error codes as message provenance
(attacker text reaches responses); enumerate only direct loader syntax
(transparent and fixed-container aliases remain open); compare authority source
text (equivalent carrier spellings evade capture ownership); flag wrapper calls
without normalizing arguments (authorization checks the wrong position); exempt
a whole generic result by its first sealed owner (foreign sibling seals
disappear); assign every object implementation to every callable signature
(guarded siblings claim unguarded effects); and let a body prologue authorize
parameter defaults retroactively (the SQL already ran).

**Revert path:** revert this changeset to restore untrusted AppError messages,
transparent loader and authority gaps, incomplete governed invocation
normalization, nested generic seal exemptions, sibling SQL ownership, and
pre-body SQL execution.

## D-092 - Security provenance survives bound and pre-body execution

**Date:** 2026-07-29 · **Reversible** · Relates to: D-085, D-089, D-091,
ADR-0035, ADR-0036, ADR-0037, v3 §15.1/§15.2/§15.3/§15.4,
charter #1/#3/#4/#7/#12/#14

All five review findings were legitimate. The observability finding was a local
misuse of frozen state as authentication. The other four exposed incomplete
semantic provenance across callable binding, inferred generic results, fixed
carrier aliases, and execution reached from parameter defaults.

Error classification now asks the existing reviewed normalization boundary for
module-authenticated `AppError` provenance in a restrictive trusted-only mode.
Unknown objects are handled only through guarded single reads. A frozen
SQLSTATE-shaped object retains driver classification, while a proxy whose
extensibility trap throws cannot replace the original failure.

Governed sink discovery retains exact sink actions through bound callable
values, later aliases, helper returns, getters, and fixed containers. Bound
argument prefixes compose across nested `bind`, `call`, and direct invocation,
so authorization is checked at the effective sink parameter rather than the
wrapper call's local position.

Invented generic analysis now runs the complete sealed-position inventory for
inferred results as well as explicit type arguments. Nested objects, tuples,
arrays, and unions cannot mint a `TenantContext` merely because the generic
argument was inferred from a contextual target.

Repeated-authority analysis resolves fixed array and object members through
declaration initializers and every potentially reaching assignment. An
`as const` container cannot hide a second read from an accessor-backed carrier
after the stable prologue capture.

Pre-body SQL ownership follows statically resolved helper calls transitively
from parameter default initializers. SQL reached through one or more helpers is
still rejected before a body authority prologue because that prologue has not
executed.

Full end-to-end validation exposed a separate machine-identity collision. A
generated user UUID whose leading numeric groups resembled a formatted account
reference was rejected as an observability actor. The identifier boundary now
recognizes the complete canonical machine UUID before applying partial
account-reference refusal. Formatted accounts remain rejected because they do
not satisfy the complete machine shape.

The authoritative line-budget metric remains within the existing measured ADR
ceilings:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,021 | 4,050 | 29 |
| domain | 1,260 | 1,300 | 40 |
| infrastructure | 3,440 | 3,450 | 10 |
| presentation | 918 | 6,000 | 5,082 |

No ceiling changed. The correction reused shared semantic analyzers and the
existing reviewed opaque normalization boundary. No useful code or
documentation was removed or compressed to manufacture room.

**Alternatives rejected:** treat `Object.isFrozen` as error provenance (frozen
driver metadata is misclassified and proxy traps can escape); track only an
immediately invoked `bind` (aliases lose both the sink and its effective
arguments); inspect only explicit generic arguments (contextual inference mints
nested seals); compare fixed-container source text (initializer and assignment
aliases evade capture ownership); and inspect only SQL syntax physically inside
a default initializer (called helpers execute in the same pre-body phase).
Treating every account-like UUID substring as PII was also rejected because it
makes generated machine identity nondeterministically unobservable.

**Revert path:** revert this changeset to restore frozen-state trust,
bound-callable authorization gaps, inferred nested seal construction,
fixed-container authority rereads, and transitive pre-body SQL execution.

## D-093 - Observability record identifiers require explicit provenance

**Date:** 2026-07-29 · **Reversible** · Relates to: D-089, D-092, ADR-0013,
ADR-0038, v3 §15.1/§15.2/§15.4, charter #1/#3/#4/#7/#14

All three review findings were legitimate. The reason vocabulary accepted
arbitrary uppercase suffixes as if they were reviewed error codes. Record
identifier safety treated UUID shape as trust provenance. The evidence candidate
walker used a global visited set and rejected shared acyclic evidence as a cycle.

Observability reasons now accept an `app-error:` value only when its suffix is
an exact `ErrorCode`. Record identifiers carry a runtime-sealed generated or
keyed-digest provenance value. Only direct cryptographic UUID generation may
create the generated form. Client-supplied canonical UUIDs pass through a
domain-separated HMAC keyed from the validated application secret and scoped by
organization, field, and value. Values that cannot be classified or hashed are
redacted. Failure logging still runs, while the tamper-evident audit chain keeps
the governed record identifier needed by examiners.

Evidence traversal now tracks the current ancestor chain rather than every
previously visited object. Shared DAG nodes are valid, while a node reached
through its own ancestor path remains a cycle.

The default full-suite command now runs one test file at a time. Concurrent
ts-morph semantic projects exhausted local CPU and pushed five otherwise-green
fitness checks past their per-test timeout. The bounded runner completed all
1,208 tests without weakening that timeout or changing individual assertions.

The authoritative line-budget metric requires a measured ADR amendment:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,021 | 4,050 | 29 |
| domain | 1,298 | 1,350 | 52 |
| infrastructure | 3,484 | 3,550 | 66 |
| presentation | 918 | 6,000 | 5,082 |

ADR-0038 raises only the affected domain and infrastructure envelopes. No useful
code or documentation was removed or compressed to manufacture room.

**Alternatives rejected:** trust complete UUID shape as provenance; redact all
client identifiers and lose stable operational correlation; use an unkeyed
digest that becomes a recovery oracle; suppress failure auditing when digest
generation fails; keep a global traversal set that conflates shared evidence
with recursion; or retain nearly exhausted ceilings that pressure future
corrections into documentation deletion.

**Revert path:** revert this changeset to restore open-ended app-error reasons,
shape-authorized request identifiers, and false cycle rejection for shared
evidence DAGs.

## D-094 - Keyed record correlation proves normalized input ownership

**Date:** 2026-07-29 · **Reversible** · Relates to: D-093, ADR-0013,
ADR-0038, v3 §15.4, charter #1/#4/#7/#14

The observability provenance fence now traces the receiver of the emitted
hex digest back to the imported `node:crypto` HMAC. That same receiver must
consume a canonical JSON tuple containing the digest version, tenant
organization, observability field, and lowercase record value. A nested or
unrelated HMAC call no longer proves the emitted digest.

The runtime companion compares two distinct canonical record identifiers in
the same tenant and field. It keeps the existing stability, tenant-separation,
field-separation, non-recovery, and redaction assertions, so removing any
scoping component has a direct behavioral failure.

Only fitness, integration, decision, and proof evidence changed. Platform line
measurements and their ADR ceilings remain unchanged.

**Alternatives rejected:** search the digest initializer for any HMAC call
(the record value can be omitted while the fence stays green); inspect only for
a `value.toLowerCase()` descendant (an unrelated expression can satisfy it);
and rely only on tenant and field separation (every record in one tenant and
field can still collapse to one correlation value).

**Revert path:** revert this changeset to restore descendant-only HMAC
detection and omit the same-tenant, same-field distinct-value companion.

## D-095 - Emitted record digests retain secret key provenance

**Date:** 2026-07-29 · **Reversible** · Relates to: D-093, D-094,
ADR-0013, ADR-0038, v3 §15.4, charter #1/#4/#7/#14

The keyed-record provenance fence now traces the key argument of the exact
SHA-256 HMAC receiver whose hex digest is emitted. That key must resolve to a
single-use immutable purpose key derived by a second SHA-256 HMAC over the
validated session secret and the exact observability record-id domain separator.
The emitted receiver must still consume the canonical tuple containing version,
tenant, field, and lowercase record value.

A public emitted key with an otherwise valid but unused secret-derived HMAC now
fails the observability fence, as does reassignment after valid derivation. The
secret-containment fence remains responsible for limiting raw secret access,
while this fence proves that the access governs the emitted digest rather than
unrelated work in the same function.

Only the fitness analyzer, its adversarial companion, decision evidence, and
proof evidence changed. Runtime behavior and platform line measurements remain
unchanged.

**Alternatives rejected:** accept any SHA-256 HMAC key when the function also
reveals a secret (an unused secret HMAC leaves the emitted digest recoverable);
make the secret-containment fence infer emitted dataflow (it owns access
containment, not observability provenance); and rely only on runtime separation
tests (a public constant can preserve tenant and field separation while creating
a recovery oracle).

**Revert path:** revert this changeset to restore input-only emitted-digest
tracing and remove the public-key companion.

## D-096 - Emitted record digest bindings are immutable and single-use

**Date:** 2026-07-29 · **Reversible** · Relates to: D-093, D-094, D-095,
ADR-0013, ADR-0038, v3 §15.4, charter #1/#4/#7/#14

The emitted keyed-record digest now passes through the same immutable,
single-use binding proof as its secret-derived purpose key. The shared analysis
requires one variable definition, a `const` declaration, and exactly one
resolved reference at the inspected use before it trusts the initializer. A
valid HMAC initializer can therefore no longer authenticate a later reassigned
or ambiguously reused value.

One adversarial companion initializes a mutable digest with the complete
secret-derived HMAC, reassigns it to an unkeyed SHA-256 digest, and emits that
replacement. It failed before the correction because the analyzer inspected
only the initializer and passes only when the reassigned value is refused. A
second companion proves that an otherwise immutable digest with another
consumer also fails.

Only the fitness analyzer, its adversarial companions, decision evidence, and
proof evidence changed. Runtime behavior and platform line measurements remain
unchanged.

**Alternatives rejected:** trace every reaching assignment through arbitrary
control flow when the reviewed boundary needs no mutation; require only `const`
without proving the inspected use is the binding's sole consumer; or special
case the reported reassignment while leaving equivalent mutable bindings open.

**Revert path:** restore initializer-only digest validation and remove the two
digest-binding companions.

## D-097 - CI security gates use deterministic execution and nonliteral credentials

**Date:** 2026-07-29 · **Reversible** · Relates to: D-012, D-093,
v3 §15.4, charter #4/#7/#15

The v3 invariant runner now uses the same single-worker, file-serial Vitest
execution policy as the default test command. Its seven mapped semantic fitness
files build large ts-morph projects, so running them concurrently made the
`tokenized-factory-only` file exceed its per-test timeout on a shared CI runner
even though the serialized blocking test job passed the same file. Assertions
and timeouts remain unchanged.

The load smoke creates its throwaway advisor credential at runtime instead of
committing a password literal. Two fitness-test source-file handles no longer
use credential-shaped variable names, preventing the SAST heuristic from
misclassifying repository paths and AST nodes as embedded secrets.

**Alternatives rejected:** increase the test timeout while retaining resource
contention; weaken or skip the mapped security fence; suppress the real
hardcoded load credential finding; or disable the blocking njsscan rules.

**Revert path:** restore parallel v3 fence execution, the literal load
credential, and the prior AST handle names.

## D-098 - The captain's differentiating thesis ships as a standing repo document

**Date:** 2026-08-05 · **Reversible** · Relates to: D-034, ADR-0023 (open item C7),
charter #1/#5

The product thesis the captain stated on 2026-08-05 - traditional software makes you
configure the software and then the software runs your business; Verin inverts that,
you run your business and Verin learns how it operates and increasingly configures
itself around you - is now a committed document, `docs/product-guide.md`, pointed to
from `README.md`, `AGENTS.md`, `PRODUCT-DIRECTION.md`, and `docs/v3/README.md`.

It carries an explicit authority chain so the repo keeps ONE north-star chain rather
than two rival ones: subordinate to `CHARTER.md`, the ratified v3 direction, and the
two normative demo documents (`docs/demo-contract.md`, `docs/demo-design-language.md`),
and stating the thesis that `PRODUCT-DIRECTION.md` serves rather than competing with
it. Every one of those - `PRODUCT-DIRECTION.md` included - wins on conflict, so a session
told to test demo choices against the thesis has stated precedence instead of an apparent
override. The `README.md`, `AGENTS.md`, and `PRODUCT-DIRECTION.md` pointers name that same
set, so the precedence reads identically at every entry point that states it - including
`PRODUCT-DIRECTION.md` itself, the document the guide is most likely to collide with,
whose pointer would otherwise read as ranking the guide above it. The `docs/v3/README.md`
pointer stays deliberately shorter (the guide binds nothing and is subordinate to the
ratified documents there), since that index originates nothing normative (D-099).
It does not satisfy ADR-0023's open C7 item (a `PRODUCT-DIRECTION.md` v2 under the v3
framing), which stays open. The thesis carries a build-honesty label: it is the
product aim, and no continuous-learning or self-configuration subsystem exists today.

The PROPOSE/APPROVE shaping of configuration surfaces is recorded there as a
directional design principle, explicitly NOT a normative rule, precisely so it is not
a prose-only invariant. It is fenced in the PR that designs the self-configuration
capability, beside the already-registered invariants 15-17 on policy mutability,
executable configuration, and LLM-driven activation (gate E).
Governed, attributed activation is recorded on the same directional terms and cited to
the SHA-256-pinned `docs/v3/verin-architecture-v3.md` (§3 non-negotiables 1, 4 and 11;
§17 invariants 14, 15, 17, 18, 19 and 21), not to the unpinned index (D-099): it is
ratified v3 direction, but the invariants that would hold it (14, 15, 17 behind gate E;
18, 19, 21 behind gate F) are all registered `not-yet-active`, so the
doc says no mechanism enforces it today rather than calling it settled. Ratified is not
enforced; a claim with no live mechanism behind it is labeled directional (charter #5).

**Alternatives rejected:** leave the thesis in session history only (it would be
re-derived or lost); state it as a second north star competing with
`PRODUCT-DIRECTION.md`; state the configuration-surface requirement as a normative
"must" with no fence behind it (DO-NOT-PORT #8, charter #1); or hold the doc until the
self-configuration capability is designed, leaving the directive unrecorded.

**Revert path:** delete `docs/product-guide.md` and remove the four pointers with their
precedence clauses (`README.md`, `AGENTS.md`, `PRODUCT-DIRECTION.md` header,
`docs/v3/README.md`).
No code, fixture, fence, or pinned document depends on it. D-099 stands independently of
this revert.

## D-099 - The v3 pin covers the registered documents; the index originates nothing normative

**Date:** 2026-08-05 · **Reversible** · Relates to: D-098, ADR-0023, ADR-0018,
charter #1/#5, DO-NOT-PORT #8

`README.md`, `AGENTS.md`, and `docs/v3/README.md` each stated the SHA-256 pin as a
universal rule over `docs/v3/`. It never was one: the arch-version fence
(`src/__tests__/fitness/arch-version.test.ts`) iterates `registry.documents` from
`v3-invariants.json` and nothing else - it never reads the directory - so the pin covers
the REGISTERED set (today `verin-architecture-v3.md`, `verin-prompt-sequence-v3.md`,
`verin-demo-contract-v1.md`, `verin-core-contracts.ts`, `marriage-map.md`), and a file
under `docs/v3/` that is absent from the registry is simply invisible to it.
`docs/v3/README.md` is the unregistered file today, and that was written down nowhere, so
a session adding content to the index would believe it byte-protected when it is not.

The three documents therefore claim only what the fence verifies: the registry-listed set
is pinned, the fence covers that registry and not the directory, and a new ratified
document must be registered in the PR that adds it. Naming a fixed count ("the five
ratified documents") or an exclusivity property ("the one file here that is NOT pinned")
was itself unverified prose: a sixth ratified document added without a pin would silently
falsify all three statements while the build stayed green. Fixed counts are gone; the
statements now track the registry.

That exception carries a rule: `docs/v3/README.md` is navigation, not ratified content,
so it ORIGINATES nothing normative - every rule it states restates a registered document,
an ADR, the charter, or a `DECISIONS.md` entry, and a new normative statement originates
in one of those instead. The originates-nothing formulation is the accurate one: the index
visibly carries normative statements today (the registration and pin rules, the
charter-supremacy conflict rule, "What a build session must do", the product-thesis
subordination), so a flat "nothing normative lives here" would make the document
non-compliant on entry and leave a reviewer no consistent way to attest it. The permitted
origins name `DECISIONS.md` because two of those restatements resolve there rather than to
a ratified document: the register-a-new-document-in-the-adding-PR rule originates in this
entry (ADR-0023 decision 2 pins the five documents and does not state it), and the
product-thesis subordination originates in D-098. A three-origin list would have left the
index failing its own rule on entry - the same unattestable checkbox the
originates-nothing wording exists to close. This is deliberately recorded
as prose with a stated owner rather than as an invariant, because no mechanism can detect
normativity in a file the fence does not cover; a fenced-sounding claim with no fence
behind it is the DO-NOT-PORT #8 failure. The rule was applied on entry: the D-098 pointer
added to the index is a pure pointer, and the product guide's own authority-chain and
governed-activation citations resolve to the pinned `docs/v3/verin-architecture-v3.md`
with the index as a secondary hop.

Its enforcement hook is a pair of conditional items in
`.github/pull_request_template.md` (the shape the charter-amendment item already uses),
each on its own trigger, because the two obligations are independent. The
navigation-only attestation fires when `docs/v3/README.md` changes; the
register-with-its-pin obligation fires when any file is ADDED under `docs/v3/`. Bundling
them under the index trigger would have prompted only in the case where the author already
remembered the index - the unregistered-document failure this entry names would still land
silently - and would have made a pure nav-link PR attest something about a document that
does not exist.

The overbroad pin phrasing was corrected wherever it is stated as a live rule:
`README.md`, `AGENTS.md`, `docs/v3/README.md`, the fence-inventory row in `FOUNDATION.md`
(which the falsification session reads as the operational description of what
`arch-version` does), and - as a captain-authorized scope exception to this docs-only
change - the leading docblock of
`src/__tests__/fitness/arch-version.test.ts`. That last edit is comment text only: no
assertion, test name, or behavior changed. Dated historical records keep their original
wording, since they report what was written at the time and this entry supersedes them:
the append-only `DECISIONS.md` entries above, and the PF-023 entry in
`docs/fences/proof-log.md`, whose invariant statement and captured failure output are the
verbatim record of a proof run.

**Optional future hardening (not taken here - this PR is docs-only):** the registration
half IS mechanizable even though normativity is not. The arch-version fence could read
`docs/v3/`, assert every entry except `README.md` appears in `registry.documents`, and
ship the companion proving an unregistered file fails. That would make "the index is the
only unregistered file" a self-maintaining fact rather than prose, and it would catch a
ratified document landing byte-unprotected. It belongs in a PR that can prove the new
fence adversarially (charter #1), not in this documentation change.

**Alternatives rejected:** pin `docs/v3/README.md` too (a navigation index would then
demand a pin bump for every link edit, and the pin would assert ratified status it does
not have); leave the overbroad phrasing and rely on the fence to be discovered by
reading; or state the index rule as a normative invariant with no enforcing mechanism.

**Revert path:** restore the "every doc under `docs/v3/` is pinned" phrasing in
`README.md`, `AGENTS.md`, `docs/v3/README.md`, `FOUNDATION.md`, and the arch-version
fence docblock; remove the two v3-document items from
`.github/pull_request_template.md`; and delete this entry. No fixture, fence assertion, or
pinned document changes; `v3-invariants.json` and the arch-version fence BEHAVIOR are
untouched, since this corrects the prose describing them, not what they do.

## D-100 - Receded values carry their own color, so the freshness fade cannot cross the AA floor

**Date:** 2026-08-05 · **Reversible** · Relates to: D-034, ADR-0012, ADR-0022,
charter #9, demo design language §12.1

`FreshValue` claimed that flooring the freshness fade at `opacity: 0.7` kept receded
text at 4.5:1. It did not: the faded span inherits the CALLER's color, and the claim
was only ever true for `text-slate-900`. Every demo `asOf` is a fixed fixture date
(`data.ts` `OBSERVED_RECENT` = 2026-07-24) aged against the REAL clock, so each
surface walks down the opacity tiers over calendar time. On 2026-08-05 the
workspace's `text-slate-600` custodian lines reached tier 0.8 and axe measured
4.34:1 on `bg-surface` - a blocking e2e failure produced by the calendar, not by any
code change. Past 21 days the floor tier lands `text-slate-600` at 3.47:1 and
`text-slate-700` at 4.20:1, so the same gate would have failed permanently from
2026-08-14 on.

Receded content now owns the established receded color - design §12.1's slate-800,
already used by `record.tsx`'s voided approval rows for exactly this reason - which
clears 4.5:1 at the 0.7 floor on white, `bg-surface`, and `amber-50` alike. Fresh
values (opacity 1) still inherit, so nothing changes until a value actually recedes.
The AA outcome is now independent of when the suite runs, which is what removes the
calendar flakiness. Proven both ways before landing: with the fix, axe passes on all
twelve demo surfaces with every `FreshValue` pinned to 0.7; with the color removed
and the pin kept, the same probe fails at 3.47-4.20:1.

**Alternatives rejected:** raise the opacity floor to 0.9 (the only tier where
inherited slate-600 passes - it deletes the freshness grammar and still says nothing
about darker-background callers); recolor the twelve call sites (the guarantee
belongs to the component that makes it, and the next caller reintroduces the bug);
render demo freshness against the `DEMO_NOW` world clock the fixtures declare
(correct on its own terms and worth doing, but it needs a `now` threaded through
`FreshValue`, `Metric`, `EvidenceRow`, and `DispositionNotice`, and it would leave
the false contrast guarantee standing for real-clock surfaces such as the console).

**Revert path:** drop the conditional `text-slate-800` from `fresh-value.tsx`. No
contract, fixture, fence, or scenario data changes.

## D-101 - Dependency-audit remediation: undici, fast-uri, and a brace-expansion selector bump

**Date:** 2026-08-05 · **Reversible** · Relates to: D-033, charter #15

Three new high advisories landed against dev-only transitives of
`@cyclonedx/cdxgen` (the `pnpm sbom` toolchain), failing
`pnpm audit --audit-level=high`. Remediated with the range-scoped, self-expiring
`pnpm.overrides` selectors D-033 established: `undici@<7.29.0 → 7.29.0`
(GHSA-4cwx-7wf7-3272, via cdxgen and its cheerio dependency),
`fast-uri@<3.1.5 → 3.1.5` (GHSA-7p8r-x3mc-p8w7, via ajv), and the existing
`brace-expansion` selector moved from `<5.0.8 → 5.0.8` to `<5.0.9 → 5.0.9`
(GHSA-rgw5-rvv9-x895 widened the vulnerable range to include the version the old
selector pinned). Each stays on its current major, so the `minimatch@3.1.5` patch
D-033 added for brace-expansion 5.x's named export still applies unchanged. The
audit is now fully clean, not merely clean at high: undici 7.29.0 also clears the
four moderate undici advisories.

**Alternatives rejected:** bump `@cyclonedx/cdxgen` and hope its transitives follow
(the advisories are in packages it pins, so this is not in our control and would
churn on every advisory); take the latest majors instead (undici 8, fast-uri 4)
under consumers that declare compatibility with 7.x and 3.x; or lower the audit gate
below high.

**Revert path:** each selector deletes independently once its consumer bumps past
the advisory range, at which point the range matches nothing.

## D-102 - Prompt-8 primitive catalog lands in contracts/primitives with executable falsification guards

**Date:** 2026-08-05 · **Reversible** · Relates to: ADR-0023, ADR-0029,
ADR-0039, ADR-0040, marriage-map C6, waveb-design-ratification, charter #1/#2/#4

The v3 prompt-8 deliverable `src/primitives/catalog.ts` is re-baselined to
`src/contracts/primitives/catalog.ts` per marriage-map C6 (v3 module paths
become subsystems inside the four fenced layers - the ruling that landed
prompt 5 at `src/contracts/decision-core/`). The catalog is pure Zod schemas
and total pure functions, which is the contracts layer's definition; placing it
there also keeps it inside the chartered knip vocabulary exemption while
prompt 10 has no runtime consumer yet, and lets the prompt-9 loader import it
without a layer escape.

Implementation choices the ratified design left open, fixed here and recorded
in docs/primitive-rationale.md: the projection window is half-open
[anchor, anchor + months) with end-of-month clamping; the tz projection of
bundle.asOf to the anchor date happens once in the evaluation harness so the
contracts layer never touches tz data; reconciliation below two assertions is
vacuously consistent (sufficiency belongs to the validation stage) and
contradictions cite snapshot references never values; exactly-one refuses
exclusion parameters as self-contradictory; the losing survivors of a
preference-order selection carry one of two fixed codes -
ranked-behind-selection when the winner's preference rank is strictly better,
canonical-order-tiebreak when both tie at the absent rank and only the canonical
(firmId, id) order decided it (p8-review-askuser-7, so the trace never credits a
household preference that never spoke); published-key maps declare per-key
presence (always/conditional) and outputs are fenced to stay inside them.

Falsification criteria are executable: each primitive's ratified kill case
(conditional claims, backward projection, ratio bounds, quantity allocation,
aggregate restrictions, trust hierarchies) is asserted unrepresentable in the
unit suite, so quiet schema growth fails the build and forces the declared
version-bump path.

**Alternatives rejected:** a literal `src/primitives/` fifth top-level
directory (unclassified by the dependency fence, unbudgeted, and a reopening of
the ratified four-layer architecture); placing the catalog in `src/domain/`
(would need a D-013-style knip escape and blocks the prompt-9 contracts loader
from importing it); documenting falsification criteria as prose only.

**Revert path:** ADR-0039's revert path (delete the module, registry, doc,
fence, and unit suite; restore the ADR-0035 ceiling).

## D-103 - The faded color belongs to FreshValue, so the call-site spans came back out

**Date:** 2026-08-05 · **Reversible** · Relates to: ADR-0012, D-036, D-100,
docs/demo-design-language.md, charter #9

**Superseded by D-100**, which landed on `main` independently while this branch
was in flight and fixes the same date-driven axe failure one level down:
`FreshValue` now owns `text-slate-800` whenever it fades, so the guarantee holds
for every call site rather than the four named below. D-100 rejected call-site
recoloring as its alternative for exactly that reason.

The demo-journey axe gate failed on main in this environment: the workspace
account card renders custodian text as slate-600 INSIDE a FreshValue fade, and
the walking skeleton's fixture asOf dates have aged past the 7-day tier since
landing, so the flattened color dropped to 4.34:1 - a date-driven time bomb
that was green in CI when the surface merged. The documented design-language
rule already covers it: secondary text inside a faded block must be slate-800
or darker.

Original fix on this branch: the four call sites whose FreshValue children
inherited slate-600/700 (workspace household line, workspace custodian line,
workspace pending activity, safety revalidated-at) wrapped the faded content in
a slate-800 span.

Final state: those four spans are REMOVED, because the component now owns the
faded color and applies it only while the value actually recedes. The spans
applied slate-800 unconditionally, so a value under a day old rendered darker
than its own label - the opposite of the receding-content contract documented in
`fresh-value.tsx`. Against D-100 the removal restores that contract and costs no
contrast: slate-800 at the 0.7 opacity floor still measures about 5.3:1 on the
card surface, and the component supplies it.

Known residual: FreshValue's contract (children must be slate-800+ where the
component cannot supply the color itself) is prose, not yet a fence; a
usage-level check belongs to the demo lane's surface fences if the pattern
recurs.

**Alternatives rejected:** keeping the four spans as harmless redundancy (they
are not redundant at full opacity - they recolor fresh values the component
deliberately leaves inheriting); raising the opacity floor (weakens the
freshness-as-opacity design language); darkening the whole paragraphs (recolors
full-opacity labels that already pass).

**Revert path:** none needed - the surfaces are byte-identical to their
pre-branch state; D-100 carries the fix.

## D-104 - Prompt-8's four cross-wave obligations are carried by name to their owning prompts

**Date:** 2026-08-06 · **Reversible** · Relates to: ADR-0039, D-102,
p8-review-askuser-5/-6/-7, charter #2

Four obligations the prompt-8 catalog states are real and binding, but none is
fenceable in this PR because none of their subjects exists yet: the config
loader arrives in prompt 10, the evidence assembler in prompt 14, and the
validation-stage evidence-sufficiency contract in prompt 15. The charter's
"fence every invariant in the same PR that states it" cannot be honored against
a subject that has no code, so the obligations are recorded here by owning
prompt instead of left as doc prose that a later edit could quietly weaken.
Each becomes a fence in the PR that builds its subject; none is a
`not-yet-active` v3-invariants row, because that registry tracks the ratified
v3 invariant set and these are implementation obligations under ADR-0039.

1. **Prompt 10 - restriction evidence must be declared required.**
   `restriction-screen` is fail-open on absent evidence by design:
   `restrictions.matched.<kind> = false` means "screened against everything
   supplied", never "the evidence was verified present", so a bundle assembled
   without restriction lists screens clean by construction. The config load MUST
   therefore cross-check, fail-closed, that every configuration binding
   `restriction-screen` declares a restriction-source evidence kind as REQUIRED
   evidence for each bound restriction kind, rejecting the configuration with an
   error naming the primitive and the undeclared kinds. Until that check exists,
   nothing stops a governed action clearing over regulatory holds nobody
   assembled (docs/primitive-rationale.md, `restriction-screen`).
2. **Prompt 10 - binding multiplicity is a fail-closed load check.** The four
   unscoped-key primitives (`net-availability`, `horizon-projection`,
   `sufficiency-check`, `restriction-screen`) are bound AT MOST ONCE per domain
   configuration, and the two parameter-scoped ones (`candidate-selection` by
   `subjectSlot`, `evidence-reconciliation` by `factKind`) may repeat only with
   DISTINCT key scopes. Both halves are config-load errors naming the primitive
   and both bindings; last-write-wins is not an option, because a second binding
   silently overwrites published facts under `availability.*`, `projection.*`,
   `sufficiency.*`, or `restrictions.*` and the AST then evaluates a
   wrong-but-plausible fact rather than failing.
3. **Prompt 14 - the evidence assembler owns claim de-duplication.**
   `net-availability`'s `claims` carries no per-(claimKind, snapshotRef)
   uniqueness refinement, because one snapshot legitimately yields several claim
   rows. De-duplicating assembler-side repeats is therefore the assembler's
   obligation, and whether the evidence-assembly contract should force
   per-(claimKind, snapshotRef) aggregation is the open question that prompt
   answers. The failure is conservative in the meantime - a repeat double-counts
   the claim, understating `availability.net`, so it over-blocks and never
   over-permits.
4. **Prompt 15 - reconciliation bindings owe declared evidence sufficiency.**
   `evidence-reconciliation` is fail-open on absent evidence in the same shape as
   obligation 1: it declares no `evidenceKindParameters`, and
   `reconciliation.<factKind>.consistent` is vacuously true below two assertions
   by ratified design (captain OQ-3 and `p8-review-askuser` ruling 1 - evidence
   sufficiency belongs to the validation stage, not to the primitive), so a
   bundle assembled with zero assertions publishes `consistent = true`. The
   validation-stage evidence-sufficiency contract MUST therefore cover
   reconciliation bindings, so an AST rule gating on
   `reconciliation.<factKind>.consistent` cannot clear over evidence nobody
   assembled; `sourcesToReconcile` (min 2) already names the sources the
   requirement is derived from (docs/primitive-rationale.md,
   `evidence-reconciliation`).

**Alternatives rejected:** `not-yet-active` v3-invariants rows (that registry is
the ratified 30-invariant v3 set, not a scratchpad for per-ADR implementation
obligations, and its activation semantics would have to be stretched to carry
them); a fence today against the prompt-10/14 subjects (there is nothing to
assert, and a fence that passes vacuously is worse than none - charter #2);
leaving the obligations as rationale-doc prose only (the primitive-catalog fence
checks only that a per-primitive section and matrix row exist, so the paragraphs
could be weakened or deleted and the build would stay green).

**Revert path:** delete this entry and the PLAN.md forward-work pointer; the
obligations then live only in docs/primitive-rationale.md, which is where they
were before.

## D-105 - Prompt-7 decision ledger is a synchronous sibling, not an audit-log extension

**Date:** 2026-07-28 · **Reversible** · Relates to: ADR-0007, ADR-0018,
ADR-0019, ADR-0043, v3 prompt 7, charter #1/#2/#7/#13

The decision and replay storage foundation lands as an independent
`decision_ledger` chain beside the unchanged operational `audit_log`. Immutable
evidence snapshots, exact input-bundle bytes, ordered evidence membership, and
decision records commit with their typed recording events in one transaction.
Composite tenant foreign keys, append-only database triggers, the repository
anti-fork fence, L1-L4 chain verification, and one pure online/rebuild projection
fold make the storage claim executable. The 16-event vocabulary includes explicit
approval-stage expiry and escalation facts but no authority evaluation, execution
behavior, or second orchestration engine.

The `/app/ledger` register makes the source reachable and read-only; the seeded
chain is visibly labeled `Synthetic fixture`. Existing demo fake decision and
status histories remain because this prompt lands no real producers. They become
deletion/switchover candidates only with the later decision, approval, and
execution prompts. ADR-0043 records the topology, retention extension, forward-only
migration, and ADR-0018 ceiling amendments.

## D-106 - Ledger provenance, reservation ownership, and register verification scope

**Date:** 2026-07-28 · **Reversible** · Relates to: D-105, ADR-0043, charter #4/#5

Review of D-105 surfaced four storage-level gaps, all fixed in the same forward-only
migration rather than a follow-up one.

**Provenance is stored, not inferred.** Every `decision_ledger` row carries
`prov_source`/`prov_asof`/`prov_confidence` supplied by the producer, and both write
paths refuse an unknown source. The register derives its badge from the stored source
through `isSyntheticSource`, so renaming the seed actor - or adding any other synthetic
producer - can no longer render fixture history as real (charter #4). The badge text now
comes from the single `DEV_BADGE_TEXT` taxonomy, which moved to `contracts/provenance.ts`
because real surfaces label unlanded paths from it too, not only the demo skeleton.

**Reservation ownership is indexed, not searched.** A release names no decision, so the
owner was previously found by scanning every projection in physical row order - a choice
the online fold and a later rebuild could disagree on. `decision_reservation_index` maps
`(org_id, reservation_id) -> decision_id` with a status, making the lookup a single keyed
read and a rebuild linear. A `ReservationCreated` that names a reservation another decision
holds live is refused rather than resolved arbitrarily.

**Immutable sources are reusable.** Evidence snapshots and input bundles are
content-addressed, so a second decision over the same inputs (the natural shape of an
exception re-decision) reuses the stored bytes. Reuse requires byte equality; a
same-id/different-bytes collision, or identical content already stored under another
bundle id, is refused with a legible error instead of an opaque constraint violation.

**Verification scope is honest.** `verifyAndListDecisionLedger` accepts a window, and the
register verifies its most recent 200 entries against the stored hash of their predecessor
instead of re-running L1-L4 over the whole chain on every page load under the store's single
connection. The unbounded form remains the examiner-grade check the `audit-chain-verify`
gate runs, and the UI states which scope it is showing.

`ExceptionDecisionRequested.triggeringEntryRef` is now a promoted, foreign-keyed column
checked by L3, so a causal link to a nonexistent entry cannot be stored. The register also
renders replayed decision state, making the projection fold reachable from the UI in the
PR that lands it (charter #5). `appendDecisionEvents` stays dormant until Wave D/F
producers land; it is exercised by integration tests, not by a fake producer.

**Why:** derived state that depends on physical row order is not deterministic, and a label
derived from a magic actor string is not provenance.
**Revert path:** the added columns and derived table are additive; the window argument is
optional and defaults to the full chain.

## D-107 - Ledger failure diagnosis, post-decision evidence, and derived-state labeling

**Date:** 2026-07-28 · **Reversible** · Relates to: D-105, D-106, ADR-0043, charter #4/#5

Review of D-103 surfaced four gaps in the ledger's failure and labeling behavior. All are
fixed in place; none needs a new migration.

**A failed append is diagnosable.** `recordDecision` used to map every non-`AppError`
thrown inside its transaction to one generic `STORE_CONSTRAINT` and logged nothing, so an
outage, a programming bug, and a genuine unique/FK violation were indistinguishable 409s
with no trail - the exact failure `auditedWrite` already learned ("a swallowed TypeError
here once surfaced as a generic 409"). Both write chokepoints use the hardened error
metadata classifier, so only a real SQLSTATE class-23 violation is the non-retryable
conflict and anything else is `INTERNAL`. Logs retain only closed error codes,
fixed-shape SQLSTATE categories, and registered reasons, never driver prose.

**Post-decision evidence has a write path.** `StatusObserved.evidenceSnapshotRef` promotes
a foreign-keyed `evidence_snapshot_id`, but the only writer of `evidence_snapshots` was
`recordDecision`, and `appendDecisionEvents` refused `EvidenceSnapshotRecorded` outright -
so evidence gathered AFTER a decision, which is precisely what a verification-time status
observation cites, could never be stored and the field was structurally unusable.
`appendDecisionEvents` now takes the snapshots recorded by its own batch, and a cited
snapshot that is not stored is refused by name instead of surfacing as a raw FK violation.
Both write paths share one correspondence rule: evidence and the event recording it are
appended together, same tenant, one event per snapshot.

**Derived state is labeled by its least trustworthy input.** The register joined a
projection's provenance from its single `DecisionRecorded` row, so a decision recorded by a
real producer that later folded in synthetic approval, execution, or status events rendered
with no badge. `listDecisionProjections` now derives each projection's provenance from every
contributing row through `deriveArtifactProvenance` (ADR-0022), and one synthetic event
makes the whole displayed fold a demonstration that `canFeedComplianceDecision` refuses.
A `ReservationReleased` names no decision in a promoted column, so it is attributed through
the reservation index for the fold but not yet for the label - the narrow remainder, closed
when Wave D/F producers land and reservations become promoted facts.

**The projection window is bounded like the entry window.** ~~`listDecisionProjections`
takes a limit; the register reads the 50 most recently active decisions, reports how many
exist, and says so on screen, instead of a full-table read and an unbounded grid per page
load.~~ **Superseded by D-108/D-116:** the register reads no projection at all. It replays
the verified event window (`replayRegisterWindow`), bounds the decisions it renders, and
reports its totals and withheld counts from that replay, so the projection store is the
replay/repair path only and carries no bounded read to keep honest.

`rebuildDecisionProjections` is reachable as `pnpm ledger:rebuild`, the operator repair
surface for corrupted derived state: it refuses to replay a chain that does not verify, and
a run that rebuilds nothing exits non-zero. The anchor and projection checkpoint are now
upserted per entry rather than once per batch, so if a future producer swallows a mid-batch
refusal inside its own transaction, the rows that committed still have an anchor covering
them - a partial append stays verifiable and repairable instead of breaking L4 forever with
no repair path (`decision_ledger` rejects DELETE).

**Why:** an opaque error code and an unlabeled synthetic fold are both silent failures, and
immutable DDL is the wrong place to discover a field can never be written.
**Revert path:** the shared error helpers, the optional snapshot argument, and the optional
limit are all additive; the per-entry anchor upsert changes write frequency, not schema.

### D-108 · 2026-07-28 · reversible · Ledger replay trust and projection ownership are structural

**Reservation-ownership portion superseded by D-107.**

Projection preconditions are evaluated before immutable insertion, and reservation identifiers
remain permanently owned by their first decision because release events carry no owner reference.
Blocked and prohibited decisions project approval mode `none`.

The ledger chain now binds producer provenance through a versioned preimage. Evidence-recording
events bind a digest of the complete canonical snapshot metadata. Projection rebuild dispatches
events through the recorded-version registry, recomputes decision and bundle hashes, verifies
canonical evidence bytes and ordered bundle membership, and refuses PII in every immutable replay
source. Derived projection provenance is persisted with the cache, including owner-resolved release
events, so request-path reads are bounded by selected decisions rather than event history.

The post-review implementation measures contracts at 5287 lines (composed with ADR-0040's
prompt-8 primitive catalog) and infrastructure at 4187 lines.
ADR-0041 amends ADR-0018 ceilings to 5350 and 4300 respectively, retaining explicit headroom without
changing the 500-line file cap.

**Why:** append-only history cannot rely on mutable caches, unbound provenance, reusable ownerless
identifiers, or replay inputs that are only schema-shaped rather than hash-verified.
**Revert path:** none while Prompt 7 claims replayable immutable sources and deterministic projections.

### D-109 · 2026-07-28 · reversible · Dynamic store paths stay outside the build trace

The runtime-only relative PGlite data-directory resolution carries Turbopack's trace-boundary
annotation. This preserves relative paths in development and CI while preventing the production
build from tracing the whole repository through `process.cwd()`.

**Re-verified 2026-08-05 (D-116).** Review read the annotation as inert on a non-`import()`
call site. It is not: `next build` emits zero NFT warnings with it and "Encountered unexpected
file in NFT list" without it, on this exact `resolve(process.cwd(), …)` form - which is the
form Turbopack's own warning text prescribes. The call site now says so, so the next reader
does not delete it.

**Why:** the build otherwise succeeds with an NFT warning and packages unrelated project files.
**Revert path:** remove the annotation if the store path becomes statically rooted or Turbopack
stops tracing this runtime-only resolution.

### D-110 · 2026-07-28 · captain-decision · Ledger appends, replay sources, and reservation reuse fail closed

Later ledger appends require the nominal transaction capability issued by the SQL
driver and run under a savepoint, so a caller cannot catch an error and commit a
source or event prefix. Chain verification locks the tenant before reading its
snapshot, and rebuild verifies L1-L4 plus every retained replay source before
clearing derived state. The scheduled chain gate and restore drill run the same
non-mutating source verification. Evidence, bundle, and decision rows dispatch
through versioned recorded-source codecs with identity upcasts for the current
version.

Immutable retained text is a code/reference projection. The boundary rejects
unclassified attribution, summaries, explanations, structured reasons, and source
statuses without rewriting the submitted bytes.

Reservation identifiers are reusable after release. Each generation is the tuple
of reservation reference, owning decision reference, and immutable creation entry.
Every release cites the exact tuple. Cross-owner and unknown-generation releases
fail, while a duplicate old-generation release is harmless and cannot release a
later generation. Status observations that precede step mapping are reconciled by
execution handle when the real step arrives.

The complete implementation measures contracts at 5296 lines (composed with the prompt-8
primitive catalog) and infrastructure at 4736 lines. ADR-0041 amends ADR-0018's infrastructure ceiling to 4800 while keeping
the 500-line file cap.

**Why:** append-only truth cannot tolerate structural transaction ambiguity,
mutable-snapshot verification, host-current replay parsing, retained free text, or
ownerless reservation reuse.
**Revert path:** none while Prompt 7 promises atomic append, deterministic rebuild,
fail-closed retention, and reusable reservation identifiers.

### D-111 · 2026-07-28 · reversible · Register state replays the exact verified window

`DecisionRecorded` advances to ledger schema 1.1.0 and binds both the decision hash
and input-bundle hash. Causal and exception-trigger references must name preceding
entries. Retained decision text uses closed code registries or opaque text references,
and the shared PII traversal is iterative.

The register now verifies, reads, and replays one bounded event window under the same
tenant lock. It reconstructs displayed decision state from those immutable events and
verified replay sources instead of trusting mutable projection rows. The anti-fork
fence assigns every immutable table to one exact insert owner.

The completed implementation measures contracts at 5339 lines (composed with the prompt-8
primitive catalog) and infrastructure at
5003 lines. ADR-0041 amends ADR-0018's infrastructure ceiling to 5100 while preserving
the 500-line file cap.

**Why:** a cryptographic claim must bind the exact bundle and the exact state displayed,
and retained text cannot become safe merely by duplicating an untrusted value.
**Revert path:** none while Prompt 7 promises cryptographically bound replay inputs,
causal event order, fail-closed retention, and an honestly verified register.

### D-112 · 2026-08-04 · reversible · Ledger review boundaries require sealed authority and verified disclosure

Decision-ledger repositories now require sealed tenant authority before SQL and
compare every source and event tenant with that authority. Retained ledger values use
a ledger-specific iterative boundary: structural identifiers and hashes must use
opaque machine syntax, while unclassified text retains the ambiguous-sensitive-text
refusal. Evidence references are no longer mistaken for free text.

The register is governed by both `audit.export` and `pii.view`, proves both grants
name the same tenant, and returns no rows or derived state when L1-L4 verification
fails. Displayed projection counts carry provenance through `Metric`. Append failures
use registered, PII-safe error metadata, and projection rebuild reports its entry count
from the single atomic verification-and-replay transaction.

The completed implementation measures contracts at 5,951 lines (composed with the prompt-8
primitive catalog), domain at 1,584,
and infrastructure at 6,507. ADR-0042 raises only the infrastructure ceiling to
6,550 with bounded headroom and leaves the 500-line file cap unchanged.

**Why:** transaction capability alone does not prove tenant ownership, immutable
identifiers cannot accept human-shaped text, and failed integrity verification cannot
authorize disclosure of the bytes that failed verification.
**Relates to:** ADR-0041, ADR-0042.
**Revert path:** restore the raw-org boundaries and single-grant register only if the
sealed-authority, PII-retention, governed-disclosure, and metric-provenance invariants
are withdrawn together.

### D-113 · 2026-08-05 · reversible · Ledger retention and anti-fork boundaries fail closed

Decision-ledger producer provenance now rejects `computed` and derived values because
the immutable row and chain envelope retain only source, time, and confidence. A
demonstration trace can no longer be discarded before hashing and replay. Persisting
derived producer provenance remains a future versioned-schema choice rather than a
silent reinterpretation of existing bytes.

Every retained ledger reason and failure code must belong to the reviewed code
registry. Structural identifiers accept only canonical UUIDs, hashes, firm ids,
namespaced references, versioned references, or reviewed code identifiers, so a
lowercase human-shaped slug cannot enter immutable history as a reference.

The append-only fence now resolves SQL executor calls, static concatenation, template
interpolation, and bound constants before assigning immutable-table insert ownership.
An `INSERT` with a dynamic table target fails closed. The register presents failed
verification as an explicit entries-withheld incident and reserves its empty state for
a verified ledger with zero stored events.

The measured implementation remains inside the existing ceilings at contracts
4,542/4,600, domain 1,584/1,600, infrastructure 6,544/6,550, and presentation
917/6,000.

**Why:** immutable history cannot safely strip derivation trust, accept open code or
identifier vocabularies, rely on source-fragment matching for write ownership, or
represent withheld evidence as an empty record.
**Alternatives:** adding provenance columns and a new chain envelope was rejected for
this correction because no current producer requires derived provenance and prior
bytes must remain stable. A broader lowercase-name heuristic was rejected because it
would reject legitimate machine codes without proving identity.
**Revert path:** restore the permissive provenance parser, retained-value traversal,
literal-fragment fence, and shared empty UI state together only if their trust and
disclosure claims are withdrawn.

### D-114 · 2026-08-05 · reversible · Ledger retention, insert ownership, and bounded replay fail closed

Unresolved SQL passed to an executor is now an immutable-table ownership violation unless
it belongs to the exact database-driver or migration-runner boundary. Imported constants,
helper returns, literal unions, concatenations, and templates are resolved before that
decision. The reviewed migration escape is paired with a complete migration-plan check
that refuses immutable inserts and non-read-only preflights.

Retained replay traversal rejects sensitive-length numeric primitives and admits readable
namespaced or versioned identifiers only through exact reviewed values and numeric-prefix
registries. Human-shaped lowercase and uppercase references therefore fail before
immutable bytes are stored.

Bounded register replay selects an evidence recording inside the verified window and
before the citing decision while separately proving that some recording fact exists.
A repeated snapshot can no longer make a complete in-window decision disappear because an
older occurrence was outside the window. ADR-0019 now states that the bounded register is
an operator view and defers a complete decision-ledger examiner export until the first
examiner or regulated-customer requirement.

The corrected implementation measures infrastructure at 6,608 lines. ADR-0043 raises the
ceiling to 6,650 with 42 lines of bounded headroom; contracts, domain, presentation, and
the 500-line file cap remain unchanged.

**Why:** immutable history cannot rely on unresolved SQL classification, open reference
grammars, ignored numeric primitives, or evidence selection outside the window whose state
is displayed.
**Revert path:** restore these boundaries together only if the append-only ownership,
PII-retention, bounded-replay, and examiner-surface claims are withdrawn.

### D-115 · 2026-08-05 · reversible · Ledger verification and replay-source trust share immutable recording edges

L2 now reapplies the append path's retained-PII and immutable-source binding
authorities and checks causal order set-wise before reporting PASS. Correctly chained
bytes that the repository would refuse therefore cannot be disclosed by the register or
consumed by rebuild.

Replay-source trust belongs to the first hash-bound recording edge for immutable
evidence and bundle bytes. Every reuse retains its own producer provenance, and online,
bounded, and rebuild folds derive from both. A fixture bundle reused by a `verin-crm`
producer remains a demonstration and cannot feed a compliance decision.

Register replay batch-loads evidence, decisions, bundles, memberships, and source
origins before folding and reuses the verified row snapshot. A 14-decision regression
falls from 65 statements to a constant category-bounded query count. ADR-0041's
migration guidance now names versions 4 and 5. ADR-0044 records the trust ownership and
raises the infrastructure ceiling to 7,050 around the measured 6,927 lines, with the
500-line cap unchanged.

**Why:** canonical schema bytes alone do not prove repository acceptance, and mutable
use claims cannot upgrade immutable synthetic inputs.
**Revert path:** none while L1-L4 authorizes disclosure and rebuild, source reuse is
supported, and bounded register replay runs under a tenant lock.

### D-116 · 2026-08-05 · reversible · Ledger ordering, transaction, and disclosure authority is structural

Decision-event and reservation-generation order now derives from immutable ledger facts
through one set-based authority shared by append, rebuild, and L2. The mutable reservation
index can no longer authorize a competing active generation after cache deletion.

Transaction authenticity lives in a process-global weak registry shared by separately
evaluated Next.js bundles. Every exported raw-ledger disclosure requires sealed
`audit.export` and `pii.view` grants with identical tenant and actor scope, and ledger rows
carry the audit-export governed-output marker.

Bounded replay uses provenance only when the global first evidence or bundle recording
edge is inside the verified snapshot. Decisions whose true trust origin lies outside the
window are withheld rather than relabeled by unchecked historical bytes. ADR-0045 raises
the infrastructure ceiling to 7,250 around the measured 7,174 lines while retaining the
500-line file cap.

**Why:** mutable caches, module-local seals, route-only authorization, and provenance
outside the verified snapshot cannot authenticate immutable history or disclosure.
**Revert path:** none while L1-L4 authorizes disclosure, reusable source trust belongs to
the first recording edge, and transaction capabilities cross Next.js bundle boundaries.

### D-117 · 2026-08-05 · reversible · Register verification authenticates complete ledger history

The request-path register now runs L1-L4 over the complete tenant chain before it
selects the bounded event rows and replay window. Historical decision and reservation
prerequisites consumed by L2 are therefore part of the authenticated snapshot rather
than unchecked inputs to a tail verdict.

Replay-source corruption becomes a safe L2 failure that withholds all entries. A
provenance-bound count identifies decisions omitted because their source origins fall
outside the displayed event window. Exact machine identifiers no longer receive a
second partial account-number scan after their grammar and general PII checks pass.

Migration version 6 adds partial indexes for source origins and reservation history.
Savepoint-protected batches advance their anchor and checkpoint once at the batch head.
The corrected infrastructure layer measures 7,231/7,250, so the existing ADR-0045
ceiling remains unchanged.

**Why:** a predecessor hash cannot authenticate arbitrary promoted facts outside a
verified tail, and integrity failures or bounded omissions must never appear as missing
history.
**Relates to:** ADR-0041, ADR-0045, ADR-0046.
**Revert path:** none while historical facts authorize L2 ordering and the register
returns a verified integrity verdict.

### D-118 · 2026-08-05 · reversible · Ledger compatibility and register availability are explicit

The immutable-write fence now recognizes PostgreSQL `INSERT INTO ONLY`, `COPY FROM`,
and `MERGE INTO` targets in addition to ordinary inserts, while unresolved write SQL
continues to fail closed. Append and L2 share immutable decision parsing that binds
approval stages, escalation indexes, and execution steps to the authority and plan
recorded by that decision.

Ledger 1.1.0 and decision-core 1.7.0 recorded schemas are frozen as digest-pinned JSON
Schema artifacts. Literal additive registry entries own their recorded parser, v1
canonical serializer, hash and chain preimage handlers, and current upcast. A
two-version companion proves entries remain independently dispatchable.

The request register captures tenant, anchor, and complete chain in one consistent
statement, then runs full-chain verification without holding the tenant append lock.
Gate and rebuild retain the lock. Bounded replay counts every decision-scoped event it
cannot materialize because a recording or source-origin prerequisite is outside the
displayed window.

ADR-0047 raises the contracts ceiling to 6,050 around the measured 6,010 lines
(composed with ADR-0040's prompt-8 primitive catalog) and the infrastructure ceiling
to 7,700 around 7,652. The domain and presentation ceilings
are unchanged.

**Why:** immutable history needs permanent decoders and structural semantic bindings,
and a complete-chain operator read must not block tenant writes for retention-linear
verification work.
**Relates to:** ADR-0041, ADR-0046, ADR-0047.
**Revert path:** none while retained ledger versions require replay and full-chain
request verification remains the disclosure authority.

### D-119 · 2026-08-05 · reversible · Ledger vocabulary, versions, and reachability are shipped facts

**Test vocabulary leaves the production boundary.** The immutable-source PII boundary
recognised ~60 identifiers whose only justification was a fixture, so renaming a test
constant meant editing production authority and the allowlist grew with the suite.
Fixture vocabulary now enters through `registerTestLedgerIdentifier` /
`registerTestLedgerIdentifierPrefix` in the reserved `test` namespace - the shape
`registerTestSpanName` and `registerTestSystemActor` already use - and the shipped
allowlists carry reviewed production, seed, demo, and golden identifiers only. The
`ledger-pii-vocabulary` fence derives both halves from the module: the seams stay
exported, no shipped module (src outside the test tree, or scripts) can reference
either one (keyed on resolved symbol, so an alias is caught), and no entry in any
`REGISTERED_*` set lives in the reserved namespace.

**Bundle versions are validated by shape, not by today's build.** `engineVersion` and
`primitiveSetVersion` were pinned to the literal set `{"0", "0.0.0"}`, so the first
real engine version bump would have refused every `recordDecision` as `PII_VIOLATION` -
an operator sent hunting for personal data that was never there. They are checked
against a bounded machine-token grammar instead, the residual account-reference refusal
still runs over the values, and an unsupported version reports itself as a `VALIDATION`
refusal that the append and replay paths pass through unflattened.

**One projection authority per event.** Every append folded the projection twice with
identical arguments - once to validate before the insert, once to persist after it - so
the sole write path paid double the round trips for the same verdict. The pre-insert
pass is gone; the transaction and the append savepoint already guarantee that a refused
projection commits nothing. Because the substrate is now the first authority to refuse a
cross-generation release, `appendDecisionEvents` maps adapter-boundary failures through
the same classifier `recordDecision` uses, so a caller aborting its transaction still
sees a typed `STORE_CONSTRAINT` rather than driver prose.

**Derived state carries no column no reader can validate.** Migration 7 drops
`decision_reservation_index.created_sequence` forward-only (migration 5 keeps its shipped
DDL). The generation identity - reservation ref, owning decision, immutable creation
entry - and the `decision_reservation_one_active` partial unique index are untouched.

**Unreachable reads are removed; the one real deferral is named.** `listDecisionLedger`
(an unverified grant-authorized listing) is superseded by `verifyAndListDecisionLedger`,
and `verifyDecisionLedger` by `verifyDecisionLedgerIntegrity`; `countDecisionProjections`
and the bounded `listDecisionProjections` limit path were orphaned when the register
started replaying its verified event window, which reports its own totals. All are
deleted. `appendDecisionEvents` stays: it is the shared later-append boundary this prompt
exists to land, and its first shipped producer arrives with multistage approval in
**v3 prompt 18** - the earliest prompt in the sequence that emits a post-decision fact
(`ApprovalRecorded`, `ApprovalInvalidated`, and the stage expiry/escalation events), since
`appendDecisionEvents` refuses `DecisionRecorded` and everything before it either has no
event variant or travels in the bundle through `recordDecision`. The reservation,
execution, and verification producers follow in prompts 23-26 - which is what D-104's
"Wave D/F" already said. The `ledger-reachability` fence derives shipped callers for every
ledger export and requires each unreachable one to be that named deferral or a fenced test
seam - and fails just as loudly when a named deferral gains a caller, so the list cannot
become a standing amnesty.

**A refused replay says which repair it needs.** `pnpm ledger:rebuild` reported every
per-org failure as "ledger or retained replay sources do not verify", so an outage, a bug,
and a genuine integrity break were one message. It now prints the closed error code, the
fixed-shape reason, and the level beside the org id, and never driver text.

**D-104 correction.** The projection window paragraph in D-104 described a register that
read the 50 most recently active decisions through `listDecisionProjections`. That register
was replaced by `replayRegisterWindow` (D-108): the request path reads no projection at
all, it replays the verified event window and reports totals and withheld counts from it.
**D-106 upheld.** Review reported the Turbopack trace annotation as a no-op outside a
dynamic `import()`. Measured both ways instead of reasoned about: `next build` is clean
with the annotation and warns "Encountered unexpected file in NFT list" without it. The
annotation stays, and the call site now records the measurement.

**Why:** a production allowlist that carries fixtures, a version gate pinned to one build,
a duplicated fold, an unvalidatable column, and an unreachable read are each a claim the
code cannot keep.
**Relates to:** ADR-0041, D-104, D-105, D-106, D-107, D-108.
**Revert path:** the seams, the version grammar, and the fences are additive; migration 7
is forward-only and the deleted reads have verified successors.

### D-120 · 2026-08-06 · reversible · The drill tenant, the plain-context rescan, and the removed bounded start

**The backup-restore drill seeds an opaque tenant id.** The nightly drill (charter #11)
seeded the decision ledger under org id `"org"`. Once the immutable-source boundary
became fail-closed, `firmId` - carried by every ledger event and replay source - had to
be a UUID, a hash, or a reviewed shipped identifier, so `seedDecisionLedger` threw
`PII_VIOLATION` and the drill aborted before it ever reached the backup step. Reproduced
end-to-end with the scheduled job's own environment before the fix. The drill now uses a
fixed UUID tenant, which satisfies the boundary structurally and keeps a drill-only
string out of the production allowlist. The runbook records the fresh run.

**The identifier-context memo no longer suppresses the plain-context scan.** The
immutable-source traversal memoised visited containers on a single flag, so an object
first reached through an identifier field was skipped when it was later reached through a
plain one. The two contexts are not ordered: identifier strings are checked against the
opaque-identifier grammar, plain strings against `looksLikeAmbiguousSensitiveText`, and a
registered machine identifier passes the first while failing the second. The memo keys on
(container, context), so each container is scanned once per context. Proved adversarially:
the new unit test passes on the fix and fails on the old memo.

**The bounded chain start is removed rather than revived.** `LedgerSnapshot.start` and
`verifyStoredByteChain`'s `start` parameter were the last plumbing of the tail-verification
design ADR-0046 replaced, constructed as `undefined` at both shipped call sites and covered
by nothing. Reviving them would re-open exactly what ADR-0046 closed - a stored predecessor
hash proves continuity, not that the predecessor or its promoted columns are authentic -
and ADR-0046 names measured request latency, not review, as the trigger for an
authenticated checkpoint design. The parameter is gone; verification stays GENESIS-rooted.

**D-106 upheld again.** Review reported the Turbopack trace annotation as an inert
argument comment for the third time. Re-measured on this branch: `next build` is clean
with it and warns "Encountered unexpected file in NFT list" without it. The annotation
stays.

**Why:** a drill that cannot run is not evidence, a memo that depends on traversal order is
not a boundary, and dead plumbing for a rejected design is an invitation to rebuild it.
**Relates to:** ADR-0041, ADR-0046, D-106, D-116.
**Revert path:** the drill tenant is one constant, the memo change is additive, and the
bounded start returns only with the authenticated checkpoint design ADR-0046 defers.

### D-121 · 2026-08-06 · reversible · Derived cursors, verification verdicts, and reachability say what they know

**The projection checkpoint is dropped, not given a reader** (key `ledger-fresh5-checkpoint`).
`decision_projection_checkpoint` was written by every append and by every rebuild and
read by nothing: no verification level, surface, or script ever selected from it, so a
stale `last_sequence` was undetectable while the sole write path paid to maintain it -
exactly the shape migration 7 removed for `created_sequence`. Migration 8 drops the
table forward-only (migration 4 keeps its shipped DDL) and the three writers go with it.
The ordering facts it duplicated already live in the immutable ledger and its
independently maintained anchor. The bounded checkpoint-reuse verification the cursor
was plumbing for is NOT revived here: ADR-0046/ADR-0047 ratified GENESIS-rooted
full-chain verification and named MEASURED request latency, not review, as the trigger
for an authenticated-checkpoint design. That design stays deferred to that trigger, and
request-path verification stays linear in retained entries by the ratified trade.

**An integrity verdict carries its own reason.** `verifyDecisionLedgerIntegrity` caught
every replay-source failure bare and reported one static string, so the precise
`STORE_CONSTRAINT` reasons the replay loader is careful to produce ("evidence snapshot is
missing during replay", "decision replay source binding differs during replay", an
unsupported recorded version) were discarded - and a driver outage or the cross-tenant
`AUTH_FAILED` throw was reported as a BROKEN chain, sending an operator after a tamper
incident that never happened. The catch is narrowed to `STORE_CONSTRAINT` the way
`readVerifiedDecisionRegister` already narrows its own, everything else re-throws, and
the carried reason is printed by `pnpm audit:chain` and the backup-restore drill - the
two operator surfaces where the field previously had no consumer at all.

**Reachability is transitive from shipped entry points.** The `ledger-reachability` fence
counted ANY shipped reference as a caller, and every ledger file is itself shipped, so an
intra-subsystem call satisfied it: `preflightEvidenceSnapshots` passed unnamed while its
only call site was inside `appendDecisionEvents`, the one export the fence itself records
as deferred. Roots are now references from shipped files OUTSIDE the ledger directory
(routes, surfaces, scripts) and reachability propagates only through the bodies of
reached declarations, private helpers included. The scan also covers exported `const`
arrows and classes, which a `getFunctions()`-only walk could not see.
`preflightEvidenceSnapshots` is therefore a NAMED deferral whose first shipped caller
arrives with `appendDecisionEvents` in **v3 prompt 18** - it is reached through that
boundary's body, so it becomes reachable in the same prompt whatever the first producer's
events happen to carry - and each deferral now cites the decision entry that records it
rather than resolving against the rest of the file.

**The register applies its window once.** `/api/ledger` re-sliced rows to `MAX_ENTRIES`
after `readVerifiedDecisionRegister` had already applied the same bound as its event
window, so one limit lived in two places and could drift.

**D-106 upheld a third time.** The Turbopack trace annotation was reported inert again.
It stays - measured, not reasoned about - and the call site now carries a one-line
pointer beside the annotation itself so the next reader sees the constraint without
scrolling to the block comment above it.

**Why:** a cursor no reader validates, a verdict that hides which failure it saw, and a
reachability rule a subsystem can satisfy from inside are each a check that reports more
confidence than it has.
**Relates to:** ADR-0041, ADR-0046, ADR-0047, D-106, D-116, D-117.
**Revert path:** migration 8 is forward-only and additive; the narrowed catch, the
transitive fence, and the inline pointer are each independently revertible.

### D-122 · 2026-08-06 · reversible · Ledger payload fields are bound to the immutable plan

**The plan owns its keys, not just its step ids** (key `ledger-fresh-fix-review-f37-f38`).
Append and L2 bound approval stages, escalation steps, and execution-step EXISTENCE to
the immutable decision, but never the payload fields the plan itself declares: an
`ExecutionStarted` naming a real step could carry any idempotency key, a
`ReservationCreated` could name a reservation or conflict-key set the plan never
declared, and a `VerificationClosed` could close against a rule no step owns - each
accepted into history and then reported by replay as an authorized fact. The shared
binding now resolves the OWNING plan action for those three events (a step and the
compensating action it carries, which owns its own key, reservations, conflict keys, and
rule) and refuses a mismatch with its own reason, at the append boundary and again when
L2 re-proves stored history. A mismatch is REJECTED, never recorded as a labeled anomaly.
What the immutable decision authorizes now lives in its own module
(`ledger-decision-binding.ts`), leaving `ledger-bindings.ts` the storage-acceptance half:
the combined file crossed the ADR-0018 per-file ceiling, and the seam is the real one.

**A decision row states the decision's encoding.** `decision_records.schema_version` and
`serializer_version` - the exact columns `parseRecordedReplaySource("decision", …)`
dispatches on - were written from the cited BUNDLE's fields. They agree today only
because the bundle schema pins the same literal; the first decision-core bump that let a
record cite an older bundle would have named the wrong decoder for every stored decision.
They are written from the decision-core constants, as evidence snapshots already were.

**One ordering authority per path.** `rebuildDecisionProjections` proved ledger ordering
set-wide in its L2 pass and then re-proved it per entry through `prepareProjection` - up
to three extra round trips per event while holding the exclusive tenant lock, so an
incident repair on a retained tenant blocked appends for work already done. The per-event
proof moves to `appendPrepared`, where admission belongs: it runs before the row is
inserted on the online path, and the rebuild keeps the batch pass as its only authority.

**A failed recovery does not destroy the verdict.** `appendDecisionEvents` awaited
`ROLLBACK TO SAVEPOINT` and `RELEASE SAVEPOINT` before classifying its error, so a
connection lost mid-recovery replaced the typed `STORE_CONSTRAINT` with raw driver prose
in the one place D-116 added the classification for. The error is classified first,
recovery is attempted defensively, and the classified value reaches the caller either way.

**Why:** a replay is only as trustworthy as the facts it refuses to accept, and a stored
row that names the wrong decoder or a verdict that loses its reason are both failures
that surface as a mystery months later.
**Relates to:** ADR-0041, ADR-0046, ADR-0047, D-115, D-116, D-118.
**Revert path:** the plan binding, the decision-row codec key, the moved ordering proof,
and the defensive recovery are each independently revertible; no migration changed.

### D-123 · 2026-08-06 · reversible · A ceiling absorbs the correction; documentation never pays for it

**The compressed migration prose is restored, and the ceiling that squeezed it is amended**
(key `ledger-fresh6-budget-headroom`, ADR-0048). An earlier prompt-7 correction bought its
lines by compressing the explanatory comments out of `src/infrastructure/store/migrations.ts` -
the `schema_migrations` CREATE-IF-NOT-EXISTS bootstrap note, the version-1 baseline rationale,
and the `Migration`/`PreflightProbe` field documentation - a file `CLAUDE.md` and `AGENTS.md`
both send readers to for sharp-edge knowledge. That is the exact failure the line-budget
fence's own header names: a ceiling with no headroom converts review findings into
documentation deletions. The file measured 507 lines before that compression, so the PER-FILE
ceiling was squeezing it too - both ADR-0018 ratchets were being paid in prose. The comments
are restored, ADR-0048 raises infrastructure from 7,700 to 7,750 against a measured 7,706,
and `migrations.ts` takes the first pinned `max-file-size` entry at 520 against a measured 510
with ADR-0048 as the architecture-review note that map requires - both through the amendment
paths ADR-0018 owns rather than a silent fence edit.

**The compensating-action widening is proven, not just written.** D-119's plan binding admits
each step AND the compensating action it carries, but no fixture carried one, so the widened
branch never executed: the proof showed the step-owned half REFUSING, never the compensation
half ACCEPTING. `compensatedRecordingInput` records a plan whose step declares a compensation
with its own idempotency key, and the ledger integration suite asserts an `ExecutionStarted`
citing that key is accepted while an unrelated key is still refused with its own reason.

**`pnpm test:fitness` runs the way the gate does.** The convenience script CLAUDE.md points
agents at inherited vitest's default file parallelism, so several workers each rebuilt the
whole type-checked ts-morph Project at once and four to six semantic fences timed out at 20s -
on a clean tree, with a varying set each run. `pnpm test` never saw it because it already
pins `--maxWorkers=1 --fileParallelism=false`; the subset script now pins the same, and all
908 fitness tests pass. A documented command that fails on an untouched checkout trains agents
to read red as noise.

**Why:** paying a correction with prose the agent-memory files promise is a loss that surfaces
months later as a reader following a pointer to nothing, a binding branch that only ever
proves its refusal is detection without verification, and a flaky documented command erodes
the signal every other fence depends on.
**Relates to:** ADR-0018, ADR-0047, ADR-0048, D-116, D-119.
**Revert path:** ADR-0048 and the two ceiling figures revert together with the restored
comments; the fixture, its test, and the script flags are independently revertible.

### D-124 · 2026-08-06 · reversible · The per-file ratchet gets the headroom the layer ratchet got

**ADR-0048's own principle now applies at both ratchets** (ADR-0049). ADR-0048 ended the
exhausted-headroom failure at the LAYER ceiling - infrastructure 7,750 against a measured
7,706 - and then re-created it one ratchet down: the first pinned `max-file-size` entry gave
`src/infrastructure/store/migrations.ts` 520 against a measured 510. ADR-0048 itself records
that the file measured 507 before the compression, so the per-file ceiling was the binding
constraint that bought the prose deletion. The pin rises to 560, fifty lines of bounded room
sized like the layer amendment: the twelve restored lines plus a few near-term corrections,
and still sixty over the 500 default so the pin keeps measuring something. It remains the only
pinned entry, so no other file needed the same correction, and the map still ONLY SHRINKS as a
code change.

**The bottom-of-file `appError` import in `recorded-version-registry.ts` moved to the top.**
It resolved (ESM hoists, and `@contracts/errors` opens no cycle back into infrastructure), but
it read as a missing import to anyone scanning the module head while every sibling ledger
module leads with its imports.

**Why:** a ceiling ten lines above measurement is not discipline, it is a scheduled choice
between an ADR amendment and deleting the documentation `CLAUDE.md` and `AGENTS.md` point
readers at - fixing that at one ratchet while leaving it at the other closes nothing.
**Relates to:** ADR-0018, ADR-0048, ADR-0049, D-120.
**Revert path:** ADR-0049 and the pin figure revert together; the import move is independently
revertible.

### D-125 · 2026-08-06 · reversible · The whole append is classified, and a recorded figure is a measurement

**`appendDecisionEvents` classifies its prologue too.** The tenant lock, the evidence
preflight, and the `SAVEPOINT` statement ran BEFORE the `try` that maps adapter-boundary
failures, so a deadlock, a lock timeout, a serialization failure, or a lost connection on the
tenant row - the designed contention point for concurrent appends - reached the caller as raw
driver prose with no `"decision ledger append failed"` log line at all, in the one function
D-116 added the classification for and whose sibling `recordDecision` wraps its entire
transaction body. All three now run inside that `try`. Recovery is guarded by whether the
savepoint was actually opened, so a prologue failure never poisons the caller's transaction
with a rollback to a savepoint that never existed, and `storeFailure` still returns a known
`AppError` unchanged - the typed `NOT_FOUND` from the tenant lock reaches the caller as
`NOT_FOUND`, now with the log line it always owed.

**A figure recorded in the ratchet is a measurement, not a memory.** ADR-0049's commit hoisted
one import into `recorded-version-registry.ts` and left `line-budget.test.ts` and the D-121
proof-log entry both reading infrastructure 7,701 against a measured 7,702, the proof log
asserting "unchanged" about the commit that changed it. Both records are corrected, and this
round's classification restructure returns the layer to 7,701 measured. The ADR-0041
`Amended by` line stopped at ADR-0046 while ADR-0042 and ADR-0047 both declare they amend it,
so a reader following the ledger chain never reached the frozen-codec and non-locking
verification decisions that govern the shipped code; both are appended.

**Deferred, keyed `ledger-followup-decision-id-extractor`.** The three-line decision-id
extractor (`decisionRef.id`, else `priorDecisionRef.id`) is written six times -
`ledger-store.ts`, `ledger-bindings.ts`, `ledger-projection-store.ts`, `ledger-register.ts`,
`ledger-schema-registry.ts`, and `domain/ledger/projections.ts` - two returning `null` and
four `undefined`. It is a structural property of the `LedgerEntry` union, so its home is
`contracts/decision-core/ledger.ts`, which every one of those modules may import, including
the domain projector that cannot import infrastructure. The same key carries the ADR
back-reference convention: ADR-0042, 0041, 0042, 0045, and 0046 carry no `Amended by` line
though each is amended later, so the convention is either completed across the chain or
dropped for `docs/adr/README.md` as the single index. The same key also carries
`correlationId`, removed from the register view model by D-123: it is the natural spine of a
future examiner surface that groups an entry with the request that caused it, and belongs in
the contract again on the PR that renders it. All are polish, not correctness, and
wrap-up mode is in force; the trigger is the next prompt that touches the ledger modules.

**Why:** an unclassified failure at the ledger's only write chokepoint is undiagnosable
exactly when an operator needs it most, and a ratchet whose recorded figure drifts from its
measurement trains the next agent to trust the record instead of re-measuring.
**Relates to:** ADR-0018, ADR-0041, ADR-0047, ADR-0049, D-116, D-118, D-121.
**Revert path:** the prologue restructure, the corrected figures, and the ADR back-reference
are independently revertible; the deferral is a note.

### D-126 · 2026-08-06 · reversible · Emptiness is honest only where it is the ratified design

**The decision-ledger vacuity guards told a healthy deployment it was broken.** Prompt 7 ships
the post-decision append surface unwired (D-116), so a real deployment holds ZERO
`decision_ledger` rows by design until a later prompt lands a producer: `verifyDecisionLedgerIntegrity`
returns `ok` with `entriesChecked === 0`, and `audit-chain-verify` then exited 1 with
"typed-chain verification is vacuous". `ledger-rebuild` did the same on `0 decision projections
rebuilt`. Both are what `docs/runbooks/backup-and-restore.md` steps 3 and 4 point an operator at
to verify a production restore, where under RTO pressure that exit code reads as a corrupted
chain. The pre-existing audit-entry guard has no such problem, because production writes real
audited entries.

**The verdict now distinguishes three states, not two.** `scripts/decision-ledger-vacuity.ts`
is the single authority both scripts call. Rows that exist but were never covered stay a hard
failure in EVERY environment - that is the failure the guard exists for. An empty ledger fails
in `development`, where CI and the local gates run against a store seeded in the same job and
emptiness means the seed never ran. An empty ledger in `staging`/`production` is reported
explicitly - "the post-decision append surface is deferred (D-116)" - and passes. Emptiness is
forgiven only where the charter's own design produced it, never as a blanket exit 0.

**Corrected by D-124: the `production` arm is forward-looking, not exercised behavior.** Only
`staging` reaches the deferred-empty verdict today. `getConfig()` requires
`store.driver=postgres` under `APP_ENV=production` and `createDb` refuses that driver with
`STORE_UNAVAILABLE` (D-006/ADR-0004), so both scripts fail at store creation in production long
before the verdict is consulted. The paragraph above justified the arm with a production restore
operator; that operator cannot run these commands until the managed-Postgres adapter lands. The
arm and its runbook steps are the procedure that adapter must satisfy, and the dev/CI behavior is
unchanged.

**A field that reaches no surface leaves the contract (charter #5).** `LedgerEntryView.correlationId`
and the top-level `verification.entriesChecked`/`entriesStored` crossed `/api/ledger` and were
typed into the view model, but `/app/ledger` renders neither: the per-level `entriesChecked` is
what the integrity panel shows and `total` is what the entry count reads. knip cannot see
interface fields, so nothing else would have caught them. All three are removed from the view
model and the route payload rather than grown into the page; `correlationId` is recorded as a
candidate for a future examiner surface under `ledger-followup-decision-id-extractor`.

**ADR-0045 does not amend ADR-0041.** Its own header declares it amends ADR-0018 and ADR-0044,
and `docs/adr/README.md` agrees; it was a stale carry-over on the `Amended by` line D-122
corrected, so it is dropped. A back-reference that names a decision which does not govern the
file is the same defect as one that omits a decision which does.

**Why:** a gate that cannot tell a ratified empty state from unseeded data either reads a
healthy restore as a break at the worst possible moment or lets a broken CI gate pass green,
and both failures come from the same missing distinction.
**Relates to:** ADR-0041, ADR-0046, ADR-0047, D-116, D-118, D-122; charter #4, #5.
**Revert path:** the shared verdict, the view-model removals, and the ADR back-reference are
independently revertible; restoring the old guards is a one-line change in each script.

### D-127 · 2026-08-06 · reversible · Formatting is not a currency for ceilings either

**The ledger's write chokepoint is pinned** (ADR-0050). ADR-0049 closed the exhausted-headroom
failure at the first per-file pin and recorded that no other file needed the correction. The
binding constraint had simply moved to the DEFAULT ceiling:
`src/infrastructure/ledger/ledger-store.ts` measured exactly 500 at ADR-0049, and D-122's
prologue-classification fix bought its own lines back by folding a six-line
`insertEvidenceSnapshots(...)` call onto one, landing at 499 where the unfolded form would have
measured 504 and failed the fence. That fold was a ceiling being paid
in code shape rather than in prose - the same anti-pattern in a cheaper disguise, on the decision
ledger's SOLE write chokepoint and the module this branch corrects most often. The call is
restored to its multi-line form and the file takes the second pinned entry at 550 against a
measured 504: forty-six lines of bounded room, sized like the `migrations.ts` pin. Splitting was
rejected on the file's own merits - `ledger-bindings.ts`, `ledger-sources.ts`,
`ledger-projection-store.ts`, and `ledger-verification.ts` are already the seams, and what remains
is one append transaction whose savepoint guards the caller's. Every other shipped file this
branch touched was re-measured; the closest is `ledger-replay-loader.ts` at 493/500, outside the
threshold this correction applies and named in ADR-0050 as the next candidate. Layer ceilings do
not move: the restored formatting measures infrastructure 7,706/7,750, and
`line-budget.test.ts` records that measurement.

**D-123's `production` arm is forward-looking, and the runbook now says so.** D-123 justified the
deferred-empty verdict with a production restore operator reading exit(1) as a corrupted chain,
but that operator cannot occur yet: production requires the postgres driver and `createDb` refuses
it with `STORE_UNAVAILABLE` (D-006/ADR-0004), so `pnpm audit:chain` and `pnpm ledger:rebuild` fail
at store creation there, and only `staging` reaches the verdict today. D-123 carries the
correction, `scripts/decision-ledger-vacuity.ts` states which arm is exercised and which awaits
the adapter, and `docs/runbooks/backup-and-restore.md` marks its steps 3-4 as the procedure that
adapter must satisfy rather than commands to run against a production instance. The guard, the
verdict, and the dev/CI behavior are unchanged; building the postgres adapter stays out of scope.

**Hook timeouts match the test timeout the same PGlite slowness bought.** `vitest.config.ts`
raised `testTimeout` to 20s for PGlite and left `hookTimeout` at the 10s default, though the
integration `beforeEach` hooks create an instance, run every migration, and seed - more work than
the bodies. Verifying this round's fixes surfaced it twice: a full run failed
`tenant-isolation.test.ts`, the next failed `store-schema.test.ts`'s setup hook, and both files
passed in isolation. A suite that fails a different file each run trains everyone to ignore red
(charter #8, the same reason the clock is pinned non-UTC), so the hook budget now matches.

**Why:** a ratchet that can only be satisfied by reformatting teaches the next agent that ceilings
are paid in readability, and a decision entry justified by a scenario the deferral makes
impossible is read by a later agent as behavior someone exercised.
**Relates to:** ADR-0004, ADR-0018, ADR-0048, ADR-0049, ADR-0050, D-006, D-116, D-120, D-121,
D-122, D-123.
**Revert path:** ADR-0050 and the pin revert together with the call's formatting; the D-123
correction, the script comment, and the runbook note are documentation and independently
revertible; the hook budget is one line in `vitest.config.ts`.

### D-128 · 2026-08-06 · reversible · A pinned codec is only proven by the values it must accept

**Every frozen arm is proven against the live contract, not against its own bytes.** The write
path validates with `LedgerEntrySchema`; the read path - L2 and every replay - dispatches through
the pinned `recordedLedgerV1_1` JSON Schema. The dispatch test exercised one of the sixteen
variants and one bundle, and the digest test is self-referential: it proves the frozen bytes have
not changed, never that they correspond to what the live schema accepts. An arm narrower than its
contract anywhere - a dropped optional, a lost union member - appends fine and then fails L2 on
read, which reports the ENTIRE tenant chain BROKEN with `/app/ledger` withholding every entry and
no forward repair. The test now loops all sixteen event variants and all three replay-source
classes through `parseRecordedLedgerEvent` / `parseRecordedReplaySource` and asserts byte equality
against the live canonicalization, so a narrowing is caught at the contract, not in production.

**A script's last catch is the one an operator reads.** `scripts/ledger-rebuild.ts` printed
`e instanceof Error ? e.message : String(e)`, but `appError()` returns a frozen plain object, so
the refusal that reaches this handler first - `createDb`'s `STORE_UNAVAILABLE` naming
`VERIN_STORE_DRIVER=pglite` (D-006), the path D-124 just documented as the shipped production
behavior - printed `[object Object]`. It routes through `scripts/error-message.ts` like every
sibling script; the per-org handler's `classifyErrorMetadata` refusal is unchanged.

**`brokenAtSequence` leaves the register contract** (charter #5, the same branch D-123 took for
`correlationId` and the redundant `entriesChecked`/`entriesStored`). `LedgerVerificationLevel`
extends `ChainVerdict`, so passing `verification.levels` through wholesale serialized a field no
view model declares and no surface renders - and it disclosed the exact sequence at which
integrity broke in the very response that deliberately withholds every entry on failed
verification. The route maps the four `LedgerLevelView` fields explicitly, the way `decisions` and
`entries` already do; `satisfies` cannot catch this, because excess-property checking does not
reach a non-fresh nested value.

**Why:** a codec test that only ever parses the first sample proves dispatch, not acceptance, and
a diagnostic that prints `[object Object]` is the one line the operator most needs.
**Relates to:** ADR-0039, ADR-0044, ADR-0045, D-006, D-116, D-118, D-123, D-124; charter #4, #5.
**Revert path:** each is independent - the test loop, one import plus one line in
`ledger-rebuild.ts`, and one explicit map in the ledger route.

### D-129 · 2026-08-06 · reversible · The repair is scoped, the label is read, and the count is labeled

**The operator repair takes a tenant and previews by default.** `pnpm ledger:rebuild` read no
argv: it selected every org and re-folded derived decision state fleet-wide, immediately. The
restore runbook points an operator here under RTO pressure, where the intent is "repair THIS
tenant" and where a run that writes before it is inspected is the wrong default. The invocation
contract now lives in `scripts/ledger-rebuild-args.ts` (testable without importing a module whose
top level runs the repair): exactly one org id, no fleet-wide form, an unrecognized flag refused
rather than ignored, and no argument at all meaning no action. Writing takes `--apply`. Without it,
`rebuildDecisionProjections` runs the IDENTICAL one-transaction replay - verify the chain and its
replay sources, discard derived rows, fold every stored event, prove the rebuilt rows cover what
was replayed - and then rolls it back, so the preview an operator inspects is the rebuild itself,
discarded, and cannot drift from what applying would write. Immutable rows are never touched, and
the per-org `classifyErrorMetadata` refusal (D-125) is preserved verbatim.

**A badge reports the class the producer stored, not the class the code was written against.**
`/api/ledger` returned `DEV_BADGE_TEXT["synthetic-fixture"]` for EVERY provenance that failed
`canFeedComplianceDecision`, so a row appended by an `estimate` producer - or a fold whose least
trustworthy input was one - would have rendered as a fake class it does not belong to. The
adjacent comment claimed provenance was read from the row and never inferred; the label alone was
a constant. `syntheticBadgeLabel` (beside `DEV_BADGE_TEXT`, so no surface forks the vocabulary)
derives it: an estimate labels as `estimate`, a default as `default`, a fixture as the canonical
`synthetic fixture`, and a derivation from the flattened synthetic leaves that made it a
demonstration. The refusal itself is unchanged - only the label became truthful.

**No bare synthetic-derived number renders (charter #3).** `total` and `decisionsTotal` were plain
numbers in a view model whose three sibling counts already carried provenance, and `/app/ledger`
rendered both as user-facing text over a ledger that is entirely synthetic seed data. Both are now
`DisplayMetric`s. `total` folds the provenance of EVERY stored row, not the displayed window - a
synthetic row outside the window would otherwise leave a whole-chain figure wearing the window's
label - and a count whose origin cannot be established is withheld rather than labeled. The
`metric-provenance` fence does not reach either field, because the fence derives its registry from
the data dictionary's `display: "metric"` flag and these are view-model fields with no dictionary
entry; closing that gap for view-model counts is recorded under
`ledger-followup-recorded-schema-authoring` below, not implemented here.

**Closed: `ledger-followup-decision-id-extractor`.** The three-line decision-id extractor written
six times is now `referencedDecisionId` in `contracts/decision-core/ledger.ts`, the module that
defines the `LedgerEntry` union it reads, consumed by all six sites with no behavior change. The
promoted `decision_id` column, L3's drift check, projection keying, and the register fold share one
definition, so a variant that named its decision differently can no longer make them silently
disagree. The two `null`-returning copies became `?? null` at the two column sites. The ADR
back-reference convention and `correlationId`'s future examiner surface stay deferred under the
same key.

**Deferred, keyed `ledger-followup-recorded-schema-authoring`.** The four frozen recorded JSON
Schemas in `src/infrastructure/ledger/recorded-schemas.ts` are ~90KB packed into four single-line
string literals (9,305 / 28,081 / 2,250 / 49,859 characters). Three consequences: the file reports
as 9 lines to `line-budget` and `max-file-size`, so the largest artifact in the ledger subsystem is
invisible to the very ceilings ADR-0048/0049/0050 were amended to keep honest; the content is
undiffable, since any change shows as one rewritten line; and there is no generator or documented
procedure, so authoring v1.2 / v1.8 means hand-editing a 50KB literal. The digest pin plus the
all-variant byte-equality proof (D-128) covers drift, so this is maintainability, not correctness,
and reformatting frozen bytes late in the window risks digest-pin churn for no verification gain.
The trigger is the next recorded schema version: it lands `.json` fixtures or a checked-in
generator over the live Zod schemas, pinned by the same digests. The same key carries the
`metric-provenance` fence gap above - the fence sees dictionary fields, not view-model counts, so
`total` and `decisionsTotal` were caught by review rather than by a gate.

**A stale deferral key points at an entry that never recorded it.** `ledger-reachability`'s
`DEFERRED_EXPORTS` named D-116 for `appendDecisionEvents` and D-118 for
`preflightEvidenceSnapshots`; neither entry has ever contained those names, so the fence's
"each deferral names its prompt in its own DECISIONS.md entry" assertion had been failing since it
landed. The deferrals are recorded in D-119 and D-121, which name both the export and **v3 prompt
18**; the map now points there. A fence that asserts against the wrong record is not a weaker fence,
it is a red build nobody can act on.

**The named prompt was wrong, and a deferral that names the wrong prompt names nothing.** Both
records cited "v3 prompt 8", which is the primitive-vocabulary prompt (ADR-0039, D-102) - already
landed at this branch's base, and shipping no ledger producer at all. The corrected citation is
**v3 prompt 18** (authority, multistage approval, and override), the first prompt in
`docs/v3/verin-prompt-sequence-v3.md` whose deliverables are post-decision ledger facts. The
correction is factual only: the fence, the deferral set, and the exports are unchanged, and the
"a named deferral that gained a caller must be retired" check now points at a prompt that can
actually retire it.

**The ceilings absorbed it, per ADR-0051.** Three of these corrections add capability, and the one
that only subtracts moved lines OUT of infrastructure and domain INTO contracts. Both affected
layers ran out of headroom, leaving the two remedies ADR-0048 and ADR-0050 exist to remove: delete
prose, or fold readable code. ADR-0051 amends ADR-0018 instead - contracts 6,050 to 6,110 against a
measured 6,064, infrastructure 7,750 to 7,840 against a measured 7,788 - and every figure recorded
in `line-budget.test.ts` was re-measured, not carried forward. No per-file pin was added; the
largest touched files are `ledger-store.ts` at 502/550 and `ledger-verification.ts` at 426/500.

**Why:** an unscoped repair, a hardcoded fake class, and an unlabeled count all make the same
mistake in three places - the surface says something the stored facts do not, and the operator or
examiner has no way to tell from the screen.
**Relates to:** ADR-0018, ADR-0022, ADR-0041, ADR-0048, ADR-0050, ADR-0051, D-116, D-119, D-121,
D-123, D-125, D-128; charter #3, #4, #5.
**Revert path:** each is independent - the invocation module plus the `apply` option, the badge
derivation, the two provenance folds, the extractor move, and the fence's deferral keys.

### D-130 · 2026-08-06 · reversible · The preview is proven by the store, not by its carrier

**The dry-run half of the scoped repair now has an automated companion.** D-129 landed
`rebuildDecisionProjections(db, tenant, { apply: false })` and proved it end-to-end by hand;
nothing in the suite called it. The mechanism is fragile by construction - a module-local Symbol
carrier thrown out of `db.transaction` and rethrown unwrapped by the driver - so a refactor that
returned the rebuild instead of throwing it, or a managed-Postgres adapter (D-006/ADR-0004) that
normalized the thrown value, would silently turn the DEFAULT operator invocation into a committing
repair with every test still green. `ledger-projections.test.ts` now wipes derived state, previews,
and asserts on the STORE: projection and reservation-index rows still empty, `decision_ledger`
rows byte-unchanged, `applied === false`, and the preview's fold equal to the online one; a second
run with `--apply` repopulates them. Because the assertions read stored rows rather than the
carrier, they fail on the committing refactor whatever it does to the Symbol.

**The rebuild post-condition is proven by both of its arms.** `replayCoverageReason` had no
coverage at all. Two fault-injecting cases now intercept the projection INSERT inside the replay
transaction - one dropping the write, one stamping a `lastSequence` the replay never covered - and
each is rejected with its own reason and rolled back. Deleting the post-condition fails both.

**`foldStoredProvenance` now owns every stored fold.** ADR-0051 introduced it so the as-of rule
could not drift between one surface's fold and another's, but the two sites that produce the
provenance rendered on the decision CARDS - `replayRegisterWindow` and `prepareProjection` - still
spelled out the same max-`asOf` reduction beside `deriveArtifactProvenance`. Both now call the
helper; output is byte-identical, which the rebuild-equality tests already assert. Infrastructure
re-measured at 7,780/7,840 and the figure in `line-budget.test.ts` was updated, per ADR-0051.

**The two labeled counts read as English again.** Wrapping them in `<Metric>` had restructured both
sentences into a colon-then-value form ("Showing 50 of the decisions replayable in this displayed
event window: 73 · Computed · as of …"). The metric is inline again - "Showing 50 of 73 decisions
replayable …" - keeping the provenance label and demonstration watermark that charter #3 requires.

**Why:** a safety property whose only proof is a manual run is a property the next refactor
silently removes, and a fold that two modules compute separately is a drift surface an ADR named
but did not close.
**Relates to:** ADR-0004, ADR-0022, ADR-0051, D-006, D-129; charter #3, #4.
**Revert path:** each is independent - the two test cases, the two helper call sites, and the JSX
copy.

### D-131 · 2026-08-07 · reversible · The test budget tracks the slowest check, not the fastest machine

**The whole-repo semantic fences outgrew the 20s per-test budget, so the budget moved.** CI timed
out `dependency-rule`, `no-secret-fallback`, and `tokenized-factory-only` - the three fences that
resolve TYPES across every shipped file - while all 1,439 other tests passed. Measured on this
machine they take 9.2s, 9.5s, and 9.0s, and measured at the base commit `e4290f22` they take
9.4s, 9.0s, and 8.9s: prompt 7's ~5,000 shipped lines moved them by well under a second, so the
20s ceiling was already sitting inside a GitHub runner's ~2x margin and this branch only pushed
the three closest over it. Four more whole-repo fences (`tenant-context-required` at 6.6s and
4.6s, `ledger-append-only` at 4.3s, `governed-actions` at 3.8s and 3.6s) sit just under the same
line and would have gone next. `testTimeout` is now 60s, and `hookTimeout` tracks it per D-127 -
the integration `beforeEach` hooks still do strictly more work than the bodies they set up.

**The alternative was to shrink the fences, which is the wrong trade.** The cost in all three is
per-identifier type resolution, and every cheap way to cut it - filtering candidate identifiers by
spelling before asking the checker - is exactly the aliasing bypass those fences exist to catch
(`ns["principalFromIdentity"]`, a renamed import). A weak fence is worse than none, so the
stopwatch moved instead of the fence.

**Why:** a suite that fails a different file each run trains everyone to ignore red (charter #8,
the same reason the clock is pinned non-UTC), and a timeout is a verdict about the clock, never
about correctness - 60s still catches a hang, which is the only thing the budget is for.
**Relates to:** D-127; charter #4, #8.
**Revert path:** two numbers in `vitest.config.ts`.

### D-132 · 2026-07-28 · reversible · Replay corpus lands as build-time tooling with a measured `tooling` budget

The corpus generator lives in `scripts/corpus/`, beside `golden-cases.lib.ts`, `v3-invariants.ts` and
`load-smoke.ts`. **Prompt 11 adds zero lines to `contracts`, `domain`, `infrastructure` or
`presentation`** - no corpus type enters `src/` until a runtime surface consumes it (charter #5).

That move would be evasion rather than discipline if `scripts/**` stayed unmeasured, which it was: both
budget fences walked `SRC_ROOT` only. The same PR adds a `tooling` bucket to `line-budget.test.ts`
(measured **3636** at introduction, ceiling **4000**) and extends `max-file-size.test.ts` to walk
`scripts/**` under the same 500-line per-file ceiling. Tooling is reported as its own bucket, never
averaged into a platform layer; the existing zero-total staleness guard covers it.

Numbering: upstream assigned the topic branch's ADR, decision and proof ranges before integration, twice
- the corpus ADR moved 0034 -> 0039 -> 0052 (D-167, D-177). The canonical mappings are
**D-070..D-077 -> D-132..D-139**, **D-078..D-092 -> D-140..D-154**, **PF-090..PF-093 -> PF-205..PF-208**,
and **PF-094..PF-108 -> PF-209..PF-223**. Earlier corpus references use these mappings.

**Why:** the line ceilings are only meaningful if code cannot escape them by moving directory.
**Revert path:** move the generator under `src/domain` plus an ADR-0018 amendment, and drop the bucket.
**Ratchet-down point:** after the corpus generator's first post-prompt-19 simplification pass.

### D-133 · 2026-07-28 · reversible · Corpus derivation is path-keyed, not a stream PRNG

Every generated value is `SHA-256(seed ‖ path ‖ field)` keyed by its own address. A stateful stream
makes the corpus order-fragile: inserting one household at position 3 reshuffles every subsequent value
and churns every downstream digest. The `corpus-determinism` fence proves the property directly by
inserting a household mid-spec and requiring exactly one changed file, and PF-205's second injection
shows a fully deterministic ordinal-keyed generator still failing it.

**Why:** a corpus whose bytes churn on an unrelated edit cannot anchor replay.
**Revert path:** a different `derive()` plus one full regeneration and a captain re-signoff.

### D-134 · 2026-07-28 · reversible · Corpus entities stay corpus-plane; the corpus is never seeded into the store

Eight of prompt 11's twelve entity kinds have no canonical entity, dictionary row or table. They are NOT
added to `DATA_DICTIONARY`: charter #2 forbids speculative modeling, and a fixture generator is not a
declared day-one flow. They graduate when a real evidence source port needs them (prompt 14), under the
existing `provenance-required` fence. The corpus is a fixture-plane asset and is never written to the
house-CRM store, which keeps `org-id-required`, the audit chain and the PII boundary out of scope.

Each corpus record carries `RecordProvenance` structurally, imported from `src/contracts/provenance.ts`
rather than redeclared, so the corpus and the product share one provenance vocabulary.

**Why:** charter #2 and #5; a fixture plane needs no schema commitment.
**Revert path:** promote the types into `domain/schema` with dictionary rows and a migration.

### D-135 · 2026-07-28 · reversible · `conflictKey(scope, family) = "conflict:<scope>-<family>"`, read OUT of signed truth

The derivation is defined to reproduce the signed literals (`conflict:smiths-liquidity`,
`res:GC-01:liquidity`, `idem:GC-01:smiths-75000-2026-08-15`) EXACTLY, so no signed fixture changes and
no re-signoff is triggered. Seven families ship; `external-submission` is deliberately excluded because
idempotency and conflict control are different mechanisms - giving a retry a conflict key would make it
contend with itself.

**Correction to the design report:** the report predicted a facts-only idempotency key would collide
GC-10 with GC-11. Measured against the live signed set, GC-11 carries `idempotencyKey: null` (it is
blocked), so that pair cannot collide. The real collision is larger and better evidence: **seven** of the
eight signed idempotency literals (GC-01, GC-02, GC-03, GC-12, GC-13, GC-14, GC-15) share the facts
`smiths-75000-2026-08-15`, so a facts-only derivation collapses seven distinct decisions onto one key.
The fence proves the collision on that live set instead of on the predicted pair.

**Why:** deriving from signed literals rather than imposing on them keeps signed truth untouched.
**Revert path:** a different derivation plus a captain re-attestation of the affected literals.

### D-136 · 2026-07-28 · reversible · The manifest carries a signoff POINTER, not a signature

The design sketched a `signoff` block inside the generated manifest. Shipped instead: the manifest
carries `signoffRef` (file + `boundTo: "corpusDigest"`), and the signature itself lives only in the
hand-owned `spec/SIGNOFF.md`. This makes "agents never sign" structural rather than procedural - **no
generated file can contain a signature**, and the fence proves no corpus code path originates a
`signedBy`/`signedAt`/`signedDigest` literal and that the generator can emit only into `synthetic/`.

**Why:** a generated file holding a signature would make regeneration a signing act.
**Revert path:** mirror the parsed signoff into the manifest and re-fence the mirror.

### D-137 · 2026-07-28 · reversible · Restrictions carry `recordedAt` distinct from `effectiveFrom`

Awkward structure AS-13 (an expired-but-recorded restriction and a future-dated one) exposed that
evidence over a restriction observes its RECORDING, not its effectivity. Modelling those as one field
produced evidence observing the future, which the timestamp rules correctly refused. Household
instructions are modelled as restrictions scoped to a party rather than as a thirteenth record type.

**Why:** "recorded" and "in force" are different facts, which is the assumption AS-13 exists to falsify.
**Revert path:** collapse the fields and drop AS-13.

### D-138 · 2026-07-28 · reversible · The corpus deferral is recorded in the scenario matrix as its own section

Captain ruling `corpus-real-derived-provenance` requires the deferral to be recorded "through the same
ADR and scenario-matrix mechanism used for Salesforce". `config/demo/scenarios.yaml` gains a
`corpus_deferral` section (a purely additive append, with its id appended to the demo-scenarios fence's
`PINNED_IDS` as that fence's ratchet demands).

It is a SEPARATE section rather than an entry in the existing `deferral` block because the element-level
`deferral:` marking is defined against `deferral.status` - marking `replay-corpus` there would claim it
is deferred pending a *Salesforce sandbox*, which is false. The new section is not decorative: the
`corpus-provenance-split` fence cross-checks its id, status, `deferred_elements`, ADR path and un-defer
trigger against `fixtures/corpus/manifest.json`.

**Why:** two independent deferrals with different triggers must not share one status field.
**Revert path:** generalize the fence's deferral cross-reference to iterate deferral-shaped sections and
merge the two.

### D-139 · 2026-07-28 · reversible · Labeled clean controls and a false-positive rate are part of the corpus contract

Per captain ruling `corpus-signoff-and-measurement`: every coverage figure ships beside a false-positive
rate computed from labeled clean controls, and a coverage figure without one is `interpretable: false`.
A corpus with no clean controls FAILS validation. Five of the twenty-seven shipped cases are controls.
The standing companion proves a detector that flags everything scores 1.0 coverage **and** 1.0 false
positives, so blocking everything cannot read as success.

**Why:** a detection rate without a false-positive rate is not a metric.
**Revert path:** none without reopening the captain ruling.

### D-140 · 2026-07-28 · reversible · Corpus records carry an observation instant distinct from their business dates

Review finding `clean-controls-carry-stale-evidence`: `observedAtOf` derived an evidence item's
`observedAt` from a business date (authority → `effectiveFrom`, restriction → `recordedAt`, bank
instruction → `changedAt`, …). Only `balance` had a real observation instant. That conflation makes a
long-standing fact NECESSARILY stale, so four of the five labeled clean controls emitted
`freshness: "stale"` - planting `evidence-staleness-unnoticed` in the very cases that form the
false-positive denominator, on a corpus whose reason for existing is to make coverage interpretable.

Every record kind now carries its own `observedAt` in the hand-owned spec, the way `balanceObservedAt`
always did. The business dates stay, as separate fields carried into the emitted subgraph, and each
evidence item emits three instants with three jobs: `recordChangedAt` (when the fact changed → the
recent-change window), `observedAt` (when the source observed it → freshness), `retrievedAt` (when this
evaluation retrieved it → the per-kind band, measured from `trigger.asOf`). A long-standing authority,
an in-force instruction, a single-owner account and a verified destination are all OLD IN BUSINESS AGE
and FRESHLY OBSERVED; all five controls are now semantically clean, with their business facts unchanged.
Staleness is a deliberate per-record property, never an artifact of the model.

Two rules keep it honest, both fenced with live companions in `corpus-provenance-split`:
`cleanControlProblems` refuses a control carrying any defect signature (stale, lapsed, out-of-force,
unverified, last-four-colliding, dangling, infeasible, or structure-asserting), driven by relabeling
real defect cases as controls; and `taxonomyExerciseProblems` mirrors the spec loader's
unexercised-assumption rule for defect classes.

**Why:** a clean control that contains the defect being measured makes the false-positive rate it exists
to produce meaningless.
**Revert path:** collapse `observedAt` back into the business dates, and delete both rules with the case
and assumption below.

### D-141 · 2026-07-28 · reversible · AS-21 and one focused case exercise `evidence-staleness-unnoticed`

`evidence-staleness-unnoticed` was the one class in the closed taxonomy that no case carried - visible
only because D-140 added the reverse completeness check. Rather than relabel a control to satisfy a
count, the corpus gains ONE focused case: `CS-stale-model-assignment-evidence` (AS-21), an IRA model
assignment last observed twelve weeks ago against a seven-day freshness window, treated as the account's
current allocation. It is deliberately benign in content (`pendingRebalance: false`) so the case is about
the staleness and nothing else. Counts move to twenty-one awkward structures and twenty-seven cases
(22 defect + 5 controls); `corpusDigest` changes, which is correct - the corpus is `pending-captain`, so
no signature is invalidated, and agents never sign.

**Why:** an unexercised class inflates the taxonomy relative to what the corpus actually exercises.
**Revert path:** delete AS-21 and the case, and the completeness check fails until the class is removed.

### D-142 · 2026-07-28 · reversible · Cross-record references resolve by structured parse, never by substring or input order

Two determinism leaks found in review, fixed at the same root: an identifier is resolved by parsing it,
not by scanning for it. Legal holds resolve through `legalHoldSubject` (exact `account:<key>` /
`position:<key>:<id>` segments) instead of `subjectRef.includes(":" + householdKey)`, which matched any
key extending an existing one and leaked a foreign household's hold into `smiths`; the determinism
fence's inserted household is now keyed `smiths-west` with its own hold, so the prefix collision is
actually proven rather than assumed. Conflict scope reads the case's evidence AFTER sorting, so a
semantically neutral reorder in `cases.json` can no longer move a conflict key, a case's bytes or
`corpusDigest`. `loadSpec` additionally resolves every restriction and legal-hold subject by path, and
an unmodeled position-scoped RESTRICTION is refused rather than silently dropped from every subgraph.

**Why:** "adding a household changes only that household's bytes" is the property the whole corpus rests
on; substring matching and input-order sensitivity both break it invisibly.
**Revert path:** none worth taking - both replaced strictly weaker checks.

### D-143 · 2026-07-28 · captain-decision · Corpus graph, intake, signoff, and measurement boundaries fail closed

The prompt-11a corpus now validates every evidence and request reference against the complete emitted
case graph with exactly-one semantics. Evidence-producing collections are required; every keyed spec
collection rejects duplicates; planned withdrawals, authority grants, and model assignments carry
distinct prefixed ids; recent changes are emitted; restriction subjects are preserved; and explicitly
referenced cross-household destinations remain in the case graph.

The real-derived deferral rejects any delivered file while active. Once explicitly lifted, valid
real-derived cases are inventoried in the generated manifest, included in `corpusDigest`, and supplied to
the real-derived report path. Intake ids admit only opaque token components and closed suffix vocabularies;
attestations name an opaque extractor and enforce occurrence, extraction, scrubbing, and review chronology.

The `verin-corpus/1.1.0` signed preimage includes both partition inventories and the versioned semantic
digest of the defect taxonomy. Signed records accept only `signedBy: "captain"` and a canonical UTC
`signedAt`. A partially evaluated detector run withholds both figures with
`detector-outcomes-incomplete`, and provenance-specific outcome types plus runtime checks reject
cross-partition inputs. The no-blending fence scans both `src/` and `scripts/` and follows local and
imported aliases through arithmetic, calls, reducers, arrays, and concatenation.

ADR-0052's tooling ceiling rises from 4000 to 4300 against a measured 4254 lines. The explicit
46-line buffer preserves the existing design documentation and keeps every new script under the
separate 500-line file ceiling.

**Why:** labels, their meaning, and every referenced evidence entity are the signed measurement
substrate. A favorable evaluated subset, a hidden real-derived case, or an id-shaped PII leak would make
the resulting claim indefensible.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-144 · 2026-07-28 · captain-decision · Corpus measurement, topology, intake, and freshness authorities are structural

The report derives counts and labels from the manifest inventory, recomputes the signed inventory digest,
validates signoff internally, and rejects duplicate, unknown, cross-partition, or relabeled outcomes.
Missing outcomes remain missing and withhold both figures. Structured numeric results stay private to the
report owner; shipped callers receive only the string-rendering boundary, so syntax-level laundering
cannot acquire both partition figures.

Pending-action kind is a closed registry with typed direction and liquidity class. Only live unresolved
outgoing distributions or debits reduce effective liquidity. Incoming value does not increase availability
until settlement. Accounts and bank instructions retain `householdRef`; every non-primary household
appears exactly once as an opaque referenced-household node with closed relationship reasons.

Generated and real-derived trees are recursively inventoried. Active deferral rejects every delivered
entry. After un-deferral, real-derived case ids are collection-unique, filenames are canonical, corpus
versions are current, and only fully valid files reach inventory. Actual generated artifact values are
recursively refused if they contain a signature key.

Real-derived evidence records `evaluation.asOf` and the closed
`verin-real-derived-freshness/1.0.0` policy. Freshness is derived per evidence kind,
`observedAt <= retrievedAt <= evaluation.asOf`, and `unknown` requires the typed missing-observation arm.
The `verin-corpus/1.2.0` signed preimage binds the policy version and semantic digest beside the taxonomy
digest and both partition inventories.

ADR-0052's tooling ceiling rises from 4300 to 4900 against 4818 measured lines, leaving 82 lines of
headroom for this completed boundary set. The post-prompt-19 ratchet-down point remains unchanged.

**Why:** a signed digest must bind the exact denominator and the policies that interpret it; replay
topology and freshness cannot depend on caller convention or source-syntax heuristics.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-145 · 2026-07-28 · captain-decision · Replay intake and measurement carry closed semantic identity

Real-derived delivery accepts only canonical JSON bytes with unique object keys. Strict hand-owned case
and replay schemas admit exactly the typed destination, ownership, liquidity, direction, authority,
threshold, policy, tax-review, instruction-conflict, temporal, evidence, reservation, and execution
inputs required by the supported defect classes. Cross-field identity, lifecycle, chronology, freshness,
pending-action treatment, and exact reference inventories are recomputed. Rejected prose and
unrecognized key text never enter diagnostics.

Cross-household topology uses minimal opaque projected account and bank-instruction nodes plus ownership
edges. The destination expansion does not import foreign balances, tax attributes, owner roster records,
or unrelated household records. Local time selects the chronologically latest qualifying transition and
rejects duplicate instants. The determinism fence resolves direct, imported, aliased, and destructured
nondeterministic APIs.

Detector outcomes attribute closed defect-class ids. Exact signed-class attribution earns defect
coverage, any attributed class on a clean control is a false positive, null is incomplete, and duplicate,
unknown, or contradictory attribution is invalid. Structured measurement remains module-private. The
`verin-corpus/1.3.0` signed preimage binds label kind and label id beside each case's partition, id, and
byte digest.

The tooling bucket remains at its D-144 measurement of 4818 lines under the 4900 ceiling, preserving 82
lines of headroom without deleting existing design documentation.

**Why:** a signed measurement cannot depend on a lossy JSON parse, a case-level boolean, caller-supplied
labels, foreign household data, input ordering, or diagnostics that disclose the value being rejected.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-146 · 2026-07-28 · captain-decision · Replay truth, signoff, and schema semantics fail closed

The real-derived intake derives a closed defect signature for every taxonomy class. A defect label must
name a present signature, while a clean control must satisfy every class's absence signature. After the
deferral is lifted, the partition must include at least one valid defect and one valid clean control before
it can enter inventory, signoff, or measurement. Invalid delivery paths are represented only by bounded
ordinals in diagnostics.

The `verin-corpus/1.4.0` signed preimage binds both versioned real-derived JSON Schemas by identifier,
exact-byte digest, and canonical semantic projection beside taxonomy, freshness policy, labels, and case
bytes. Hand-owned signoff YAML rejects parser errors, duplicate or unexpected keys, aliases, unsupported
shapes, missing keys, multiple blocks, and ambiguity before interpreting captain authority. Determinism
enforcement includes callable `Date` and the supported crypto randomness surface through direct,
destructured, imported, and aliased origins.

The tooling bucket is exactly 4900 measured lines under the existing 4900 ceiling. No ceiling increase or
unmeasured headroom is introduced; the post-prompt-19 ratchet-down point remains unchanged.

**Why:** signed corpus truth cannot depend on a caller's label, a stale schema version string, permissive
YAML recovery, a one-sided denominator, a sensitive filename, or a nondeterministic API spelling.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-147 · 2026-07-29 · captain-decision · Replay semantics, evidence, and funding are signed authorities

The `verin-corpus/1.5.0` preimage binds the versioned
`verin-real-derived-semantics/1.0.0` registry and exact digests of every executable authority that
interprets replay topology, pending actions, freshness, evidence support, funding, and defect signatures.
Both real-derived schemas advance to `1.1.0`. Every hand-owned corpus JSON document rejects duplicate
keys before parsing or hashing.

Replay references are entity-kind-scoped. Each material plane requires exactly one evidence record
matching its kind, subject, and source. Request, household, account, instruction, owner, actor, grant, and
policy relationships fail closed when disconnected. Funding is an explicit duplicate-free account set:
each selection resolves once, belongs to the request household, shares an owner with the request source
account, has a supported tax class, and contributes to aggregate sufficiency for the request, reserve, and
reducing pending actions. Tax blindness is evaluated against exactly the selected set.

The tooling ceiling rises from 4900 to 5900 against 5747 measured lines, leaving 153 lines of explicit
headroom for the separated schema, semantic, topology, and parsing owners. The post-prompt-19 ratchet-down
point remains unchanged. The real-derived partition stays deferred and empty, and captain signoff stays
pending.

**Why:** signed cases cannot change meaning under an unchanged digest, and disconnected evidence or
implicit funding cannot substantiate either a defect label or a clean control.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-148 · 2026-07-29 · captain-decision · Replay defects require typed outcome mismatches

The `verin-corpus/1.6.0` preimage binds `verin-real-derived-replay/1.2.0` and
`verin-real-derived-semantics/1.1.0`. The semantic registry separates awkward context from system
treatment. Every supported class has one closed context rule, expected treatment, and defective
treatment. A defect requires the relevant context and a typed expected-versus-observed mismatch; a clean
control records the expected treatment for every class. Context without a mismatch cannot substantiate
a defect.

Instruction-conflict witnesses bind the exact request and tenant household. Each referenced instruction
belongs to that household, and impacted subjects intersect the request source account or destination
instruction. Identity resolution, every schema-declared unique array, set-like synthetic assumptions,
and nondeterministic call origins are validated at their ownership boundaries.

The tooling ceiling rises from 5900 to 6200 against 5996 measured lines, leaving 204 lines of explicit
headroom for the separated semantic, topology, schema, and determinism authorities. The post-prompt-19
ratchet-down point remains unchanged. The real-derived partition stays deferred and empty, and captain
signoff stays pending.

**Why:** awkward data is legitimate evidence context, not a product failure, and disconnected conflict
references or laundered nondeterminism cannot define signed replay truth.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-149 · 2026-07-29 · captain-decision · Outcome semantics govern both corpus partitions

The `verin-corpus/1.7.0` preimage binds `verin-real-derived-replay/1.3.0` and
`verin-real-derived-semantics/1.2.0`. Synthetic and real-derived cases use the same closed
expected-versus-observed treatment authority. A synthetic defect requires exactly one context-bound
mismatch for its label, while correctly treated awkward context remains a clean control. Every taxonomy
signature is checked over emitted control bytes.

Pending actions carry entity-kind-scoped account and household references. They bind to the governed
request, one selected funding account, and exact action evidence, while liquidity treatment comes from
the shared closed pending-action authority. Selected retirement funding is cross-checked against tax
review state. Missing reserve schedules use an unavailable treatment distinct from correctly segmented
reserves. Signed threshold policy carries a strict or inclusive comparator that selects the applicable
treatment pair. Synthetic request source accounts must belong to the request household.

The semantic data, executable synthetic authority, replay schema, and emitted treatment bytes are bound
into `corpusDigest`. The tooling ceiling rises from 6200 to 6500 against 6426 measured lines, leaving 74
lines of explicit headroom for the separated semantic, generation, topology, and validation owners. The
post-prompt-19 ratchet-down point remains unchanged. The real-derived partition stays deferred and empty,
and captain signoff stays pending.

**Why:** context alone cannot define signed defect truth, and disconnected pending actions or unsigned
policy comparison cannot alter replay funding or threshold treatment.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-150 · 2026-07-29 · captain-decision · Corpus labels, attribution, and synthetic funding are exact

The `verin-corpus/1.8.0` preimage binds `verin-real-derived-semantics/1.3.0`. A real-derived defect label
must equal the exact singleton semantic mismatch. A detector result for a defect case is valid only as an
empty miss or the exact signed-label singleton, so unrelated extra classes cannot earn coverage without
penalty.

Every synthetic case carries an explicit duplicate-free `selectedFundingRefs` set in its hand-owned
request and emitted bytes. Each selected account resolves exactly once to the request household. Pending
actions and pending model assignments used by synthetic semantics must bind to an account in that exact
set. Missing reserve state derives from emitted schedule absence, and an `AS-12` assertion with a schedule
is contradictory.

The signed executable authority inventory now includes the synthetic input schema, spec topology,
emitted-graph topology, and detector report boundary alongside the existing semantic validators. The
tooling ceiling rises from 6500 to 6700 against 6552 measured lines, leaving 148 lines of explicit
headroom. The post-prompt-19 ratchet-down point is unchanged. The real-derived partition stays empty and
deferred, and captain signoff stays pending.

**Why:** one signed label cannot hide multiple replay defects, one detector result cannot smuggle extra
classes into coverage, and pending liquidity semantics cannot infer funding from unrelated accounts.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-151 · 2026-07-29 · captain-decision · Replay tenant, observation, funding, and ownership semantics are structural

The `verin-corpus/1.9.0` preimage binds `verin-real-derived-case/1.2.0`,
`verin-real-derived-replay/1.4.0`, and `verin-real-derived-semantics/1.4.0`. Each real-derived case has
one opaque `firmRef`, and its replay request plus every reservation must carry that same exact value.
Reservation identity is the tuple `firmRef` plus `conflictKey`; tenant scope is never inferred from
household or display data.

One centralized observation-state authority covers every semantic evidence plane. Missing evidence can
support only an explicit absence or unavailable payload of the same typed plane. Concrete request,
identity, balance, timestamp, status, reference, and other material values require observed evidence.
Adding a later evidence plane without classifying its observation semantics fails closed.

Synthetic tax context and generator defaults derive from all and only the explicit selected funding set
through one shared authority. Every cited pending action binds to the request household and selected set
before its reducing treatment is selected. Bank-instruction and pending-action account edges must match
their declared households. AS-04 retains the outside-household LLC signer: the signer is emitted as one
separate resolvable party and cannot also appear in the LLC household membership edge.

The tooling ceiling rises from 6700 to 7000 against 6878 measured lines, leaving 122 lines of explicit
headroom across separated schema, topology, evidence, and funding owners. The 500-line per-file ceiling,
empty deferred real-derived partition, path-keyed isolation, generated-file ownership, and pending
captain signoff remain unchanged.

**Why:** signed replay truth cannot accept unsupported concrete values, tenant-ambiguous reservations,
funding semantics from unselected accounts, or contradictory ownership edges.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-152 · 2026-07-29 · captain-decision · Identity, tenant, and funding truth is reproducible and exact

The `verin-corpus/1.10.0` preimage binds `verin-real-derived-case/1.3.0`,
`verin-real-derived-replay/1.5.0`, and `verin-real-derived-semantics/1.5.0`. Synthetic identity context
now comes from typed unresolved UTF-8 bytes, canonical values, exact candidate references, candidate raw
bytes, and household bindings in the emitted case. Ambiguity requires at least two resolving candidates,
and canonical collision requires distinct raw bytes that normalize to one value. Assumption ids alone
cannot substantiate either label.

Generic real-derived subject references exclude firm ids. Case, request, and reservations remain the only
firm-scoped fields and must share one exact `firmRef`, so an impacted subject or subject inventory cannot
introduce a second tenant. Every money field rejects values outside the safe integer boundary, and
aggregate funding sufficiency uses `bigint` throughout.

The tooling ceiling rises from 7000 to 7300 against 7129 measured lines, leaving 171 lines of explicit
headroom across separate identity, topology, and funding owners. Only the two identity synthetic cases
change; path-keyed determinism, the empty deferred real-derived partition, generated-file ownership,
pending captain signoff, and the 500-line file ceiling remain unchanged.

**Why:** signed defect context must be replayable from emitted inputs, tenant scope cannot enter a generic
subject collection, and one-cent funding differences must survive aggregation.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-153 · 2026-07-29 · captain-decision · Instruction truth and signed authorities are closed

The `verin-corpus/1.11.0` preimage binds `verin-real-derived-case/1.4.0`,
`verin-real-derived-replay/1.6.0`, and `verin-real-derived-semantics/1.6.0`. Synthetic and real-derived
instruction conflicts derive from one typed authority. Each term names its governed action, exact source,
typed target, and required or forbidden polarity. Witnesses share the request firm and household.
Assumption labels, termless records, and unconnected terms cannot substantiate conflict context, while a
correctly governed request remains a clean control. Every nonempty real-derived instruction set requires
exact observed evidence for each instruction identity.

The executable semantic inventory equals the complete repository-local runtime dependency closure of its
declared roots, including data imports. Signoff YAML rejects warnings and all tagged nodes before
conversion. Taxonomy citations must resolve to regular files whose canonical paths remain inside the
repository. Both tooling budgets use one executable-source extension predicate covering TypeScript and
JavaScript variants.

The tooling ceiling rises from 7300 to 7700 against 7541 measured lines, leaving 159 lines of explicit
headroom across separate evidence, semantic, topology, and fence owners. The 500-line file ceiling,
path-keyed isolation, generated-file ownership, empty deferred real-derived partition, and pending
captain signoff remain unchanged.

**Why:** signed replay meaning cannot change through an unbound runtime dependency, untyped conflict
claim, parser recovery, host-dependent citation, or unmeasured executable file.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-154 · 2026-07-29 · captain-decision · Temporal, blast-radius, owner, and authority-closure semantics derive from signed facts

The `verin-corpus/1.12.0` preimage binds `verin-real-derived-semantics/1.7.0`. Synthetic DST context
requires cited recent-change records with exact UTC and local renderings, one signed zone identity, and
different offsets connected by an emitted transition from the pinned transition table. Shared-instruction
blast radius requires one exact cited changed instruction whose emitted topology resolves to multiple
distinct governed accounts. Assumption ids, same-offset timestamps, arbitrary recent records,
disconnected subjects, and distinct instruction identities cannot substantiate either context. A
correctly treated awkward context remains a clean control.

Instruction analysis preserves a destination's explicit duplicate-free normalized owner set. Multiple
owners no longer invalidate source-account, request, or destination-instruction terms, and
destination-subject terms match exact members of that set. The executable-authority closure reuses the
repository's comprehensive module-reference detector, follows runtime import-equals references, and
fails closed on createRequire, aliased require, module.require, and other indirect or non-literal loaders.

The tooling ceiling rises from 7700 to 7900 against 7739 measured lines, leaving 161 lines of explicit
headroom for the separate structural-context and fence owners. Only the DST synthetic case gains temporal
authority bytes. Path-keyed isolation, generated-file ownership, the empty deferred real-derived
partition, the unchanged 500-line file ceiling, and pending unsigned captain signoff remain intact.

**Why:** signed defect context must come from emitted facts, joint ownership must not invalidate
unrelated terms, and a local loader spelling cannot change signed semantics outside the digest.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-155 · 2026-08-05 · captain-decision · Corpus privacy, validation, determinism, and settled credits fail closed

Cross-household destination owners are emitted only as opaque `referencedOwners` ids unless another
request-household relationship independently makes the party local. Full roster names, kinds, and roles
remain confined to local parties. The referenced-owner collection participates in exact graph resolution,
so privacy minimization does not create dangling ownership edges.

The signed executable-authority roots include both real-derived intake and corpus validation gateways.
The nondeterminism fence resolves `globalThis` and `global` property roots through direct, aliased,
destructured, and bracket access. The `verin-corpus/1.12.0` preimage now binds
`verin-real-derived-replay/1.7.0` and `verin-real-derived-semantics/1.8.0`.

A settled incoming credit selects the distinct expected treatment
`credit-settled-incoming-availability`; omitting that credit is the signed mismatch
`omit-settled-incoming-availability`. Synthetic and real-derived validation derive this selector from the
same closed pending-action authority. The tooling ceiling remains 7900 against 7898 measured lines. The
real-derived partition remains empty and deferred, generated-file ownership remains intact, and captain
signoff remains pending.

**Why:** foreign ownership cannot expand private roster data, acceptance gateways cannot sit outside
signed semantics, ambient-global spellings cannot bypass determinism, and settled funds cannot disappear
behind a generic nonreducing treatment.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-156 · 2026-08-05 · reversible · Ambient access and pending-action balance accounting are explicit

The nondeterminism fence now records sensitive origins reached through property or element access, so
`globalThis.Intl.DateTimeFormat` and nested bracket access to `process.env` cannot bypass the source ban.

Every synthetic and real-derived pending action states `availableMinorIncludesAction`. Real-derived
funding applies no adjustment when the source-reported amount already includes the action, subtracts an
excluded reducing action once, and credits an excluded settled incoming action once. The closed treatment
selector distinguishes an included settled credit from an excluded one. The replay schema advances to
`verin-real-derived-replay/1.8.0`, the semantic contract advances to
`verin-real-derived-semantics/1.9.0`, and the captain-facing signoff prose names that exact scope.

The tooling ceiling rises from 7900 to 8000 against 7941 measured lines, leaving 59 lines of explicit
headroom across the existing determinism, schema, semantic, and topology owners. The 500-line file ceiling,
empty deferred real-derived partition, generated-file ownership, path-keyed isolation, and pending captain
signoff remain unchanged.

The complete fitness entry point now uses the same single-worker, file-serial policy as the default test
command. Two consecutive parallel runs pushed `dependency-rule` past its per-test timeout at 21 seconds;
the same test passed alone in 9.4 seconds. Assertions and timeouts remain unchanged.

**Why:** replay bytes must say whether an action is already reflected in reported availability, or the
same payload permits both adding and preserving the amount. A sensitive ambient origin must be recorded
independently of whether source syntax uses dots or brackets.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-157 · 2026-08-05 · reversible · Executable provenance and availability reconciliation share complete authorities

The corpus determinism project discovers source files through the same executable-source predicate as
the tooling budgets, covering TypeScript and JavaScript variants. Nondeterministic origin tracing follows
resolved declarations across local modules, fixed object and array members, callable returns, binding
patterns, and fixed control-flow alternatives. A forbidden origin cannot become safe by crossing a file
or a plain-data container.

Pending-action funding now computes one adjustment as expected liquidity effect minus the directional
effect already reflected in source-reported availability. This preserves included reducing outflows and
settled credits, applies excluded effects once, and reverses included blocked outflows or unsettled
inflows whose signed treatment requires no effect. An included action with unknown direction is refused.
The semantic contract's funding clause names exact-once pending-action accounting rather than only
reducing pending actions.

The tooling bucket measures 7972 lines under the unchanged 8000 ceiling. Canonical regeneration produces
`corpusDigest` `8d01240c5a65b36e2d80ab44d26dcc4e4b4314b6d750f833dd53923d98a33bbf`.
The real-derived partition remains empty and deferred, and captain signoff remains pending.

**Why:** executable coverage cannot depend on a filename suffix or module boundary, and source-reported
availability must be reconciled with the signed action treatment before sufficiency can be evaluated.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-158 · 2026-08-05 · reversible · Alternate origins, parameter binding, ambient APIs, and settled debits fail closed

The corpus determinism fence carries every possible origin through conditional and logical arms, callable
returns, declarations, and fixed containers. Object and array parameter patterns bind recursively from
their corresponding argument members. Runtime-state process APIs and entropy-producing prime generation
join the closed nondeterminism registry, including direct, imported, aliased, and destructured forms.

Pending-action availability now distinguishes settled incoming and outgoing directions. A settled
outgoing debit already reflected in source-reported availability is preserved; one not yet reflected is
debited exactly once. The replay schema advances to `verin-real-derived-replay/1.9.0`, and the semantic
contract advances to `verin-real-derived-semantics/1.10.0` with explicit included and excluded outgoing
treatments.

The tooling bucket measures 7989 lines under the unchanged 8000 ceiling. Canonical regeneration produces
`corpusDigest` `77388ead4e7cfd738954dc7b9915b32ecdcca7b013208ac20664505c643182c9`.
The real-derived partition remains empty and deferred, generated-file ownership remains intact, and
captain signoff remains pending.

**Why:** one safe branch cannot hide a reachable nondeterministic origin, parameter destructuring cannot
erase provenance, and settled debits cannot be added back or omitted during funding reconciliation.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-159 · 2026-08-05 · reversible · Determinism provenance and restriction lifecycle derive from complete facts

The corpus determinism project now expands from `scripts/corpus/` through the complete transitive local
executable import closure. Origin tracing covers method declarations, property accessors, and defaulted
parameters. Every process member and every `node:os` member is treated as host state, so a newly used
property or operating-system API cannot bypass a selected-member registry.

Real-derived restriction policy now carries `restrictionEffectiveFrom` and `restrictionEffectiveTo`.
Lifecycle state is recomputed from those instants at `evaluation.asOf`; absent restrictions require null
instants, present restrictions require a start instant, inverted intervals fail, and a claimed enum that
disagrees with the derived state is rejected before semantic attribution. The restriction defect context
uses the same derived authority. The replay schema advances to `verin-real-derived-replay/1.10.0`, and the
semantic contract advances to `verin-real-derived-semantics/1.11.0` with an explicit declarative lifecycle
rule.

The tooling ceiling rises from 8000 to 8100 against 8018 measured lines, leaving 82 lines of explicit
headroom for the existing determinism and semantic owners. Canonical regeneration produces
`corpusDigest` `befa00adb2f5081ba8854e4393a79373a05105078c37f2c872c0b594a271629c`.
The real-derived partition remains empty and deferred, generated-file ownership remains intact, and
captain signoff remains pending.

**Why:** imported executable helpers can alter corpus bytes, host state is an open category rather than a
stable API list, and a signed lifecycle defect cannot be replayed from a trusted enum without its
effectivity facts.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-160 · 2026-08-05 · reversible · Determinism and synthetic schedules fail closed

Corpus determinism provenance now models JavaScript default semantics conservatively, including an
explicit `undefined` argument and nested object or array binding defaults. Callable aliases preserve
method provenance, built-in origins enter through import-equals and ambient CommonJS loaders, constant
computed members resolve to their actual origin, and dynamic access on a sensitive origin fails closed.

The repository-wide no-blending fence again scans shipped product and tooling code. It follows local and
imported partition aliases and rejects arithmetic, reducers, helper calls, concatenation, constructors,
and rendered templates that combine synthetic and real-derived measurements. Only the symbol-resolved
report owner may receive both partitions, so a same-named local shadow receives no exemption.

Synthetic restriction and authorized-signer intervals now require `effectiveFrom` to precede a non-null
`effectiveTo`. Planned-withdrawal months must be valid calendar months in strictly increasing order, so
the hand-owned order is canonical and duplicate or descending segments cannot create ambiguous replay
bytes. The world spec advances to `1.5.0`.

The tooling bucket measures 8035 lines under the unchanged 8100 ceiling. Canonical regeneration produces
`corpusDigest` `67dadb0ecd3eed8c7b9ae0e52fc5c78fd1aa0eca4836b187f0d84e56b20a5f3f`.
The real-derived partition remains empty and deferred, generated-file ownership remains intact, and
captain signoff remains pending.

**Why:** default evaluation, module syntax, and computed access cannot erase a host-state origin; a
measurement cannot evade provenance separation by changing its spelling; and signed synthetic evidence
cannot rely on an impossible interval or an order-sensitive schedule with no valid ordering.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-161 · 2026-08-05 · reversible · Mutable keys and assignment provenance fail closed

Computed member resolution now trusts an initializer only for a `const` binding. A mutable key is treated
as dynamic sensitive access even when its declaration initializer is harmless, so a later assignment
cannot hide `Math.random`, `process.env`, or another forbidden origin.

The no-blending fence propagates partition taint to a fixed point across all analyzed source files. Direct
variable assignments, imported assigned values, and exact property or element assignments retain their
partition provenance. Member taint remains path-specific, so assigning a synthetic value to one property
does not contaminate an unrelated property.

Four review reports about identity cardinality, authority nullability, legal-hold scope, and reserve shape
were stale. The signed replay schema already rejects each contradictory state before topology or semantic
attribution. One explicit regression now exercises both identity cardinalities, missing authority facts,
an absent hold with an active scope, and missing or segmented reserves with incompatible schedule facts.

The corpus regenerates byte-identically with digest
`67dadb0ecd3eed8c7b9ae0e52fc5c78fd1aa0eca4836b187f0d84e56b20a5f3f`; the signed semantic authority and
pending captain signoff remain unchanged.

**Why:** a declaration initializer does not prove the reaching value of a mutable key, assignment cannot
erase measurement provenance, and already-enforced signed schema rules should be proven rather than
duplicated in a downstream semantic owner.
**Revert path:** none while the determinism and no-blending fences claim to cover mutable dataflow.

### D-162 · 2026-08-05 · reversible · Structured provenance, repository inputs, and temporal rules fail closed

The no-blending fence propagates partition provenance through object and array binding patterns and
`Object.assign` mutation writes. Exact member paths remain distinct, while dynamic mutation sources fail
closed onto the target. Separate structured writes cannot erase provenance before arithmetic, calls, or
rendering consume their values.

The determinism fence treats filesystem, subprocess, built-in network, and global fetch access as host
inputs. Repository reads are permitted only inside a closed list of named input owners, and an equivalent
read in another function is rejected. Those owners load the signed spec, schemas, semantic authorities,
inventories, citations, golden truth, or signoff state rather than ambient host data. The real-derived
tree reader rejects a symlinked root before traversal.

Real-derived temporal replay now carries the event's exact local rendering, IANA zone, tzdb version,
standard offset, and chronological transition table. Transition state and local rendering are derived
from those facts, and semantic attribution consumes the derived state. The replay schema advances to
`verin-real-derived-replay/1.11.0`, and the semantic contract advances to
`verin-real-derived-semantics/1.12.0`. Synthetic world transitions must be strictly chronological, and
beneficiary emission uses every output field as a total sort key.

ADR-0052 raises the tooling ceiling from 8100 to 8300 against 8112 measured lines, leaving 188 lines of
explicit headroom. Canonical regeneration produces `corpusDigest`
`3cd3c36730bd27adfad0c6b4b94ea065e49b5bf8b06166a4a6b7cd512174e94b`. The real-derived partition
remains empty and deferred, generated-file ownership remains intact, and captain signoff remains pending.

**Why:** container syntax and host-I/O spelling cannot weaken corpus controls, a filesystem boundary must
validate its root, replayed temporal defects require signed rule facts, and semantically neutral source
ordering cannot alter generated bytes.
**Revert path:** none while the corpus fences claim structured provenance, host independence, replayable
time-zone semantics, and order-independent generation.

### D-163 · 2026-08-05 · reversible · Corpus runtime and replay roots fail closed

The determinism fence rejects `eval`, the `Function` constructor, and their aliases rather than attempting
to inspect dynamically compiled source. Logical compound assignments preserve every possible ambient
origin. Declared repository-input owners now propagate their root requirements through local calls and
accept only the exact repository root or derivations made by symbol-resolved `node:path` transforms. An
external literal, an external caller parameter, or a shadowed path helper cannot authorize host bytes.

The no-blending fence propagates synthetic and real-derived provenance through standard container
mutations, including array insertion, set/map insertion, fill, and splice. Separate mutation calls cannot
erase both partitions before a reducer, arithmetic expression, helper, or rendering consumes the target.

Real-derived temporal replay accepts a zone and tzdb version only when the pair belongs to the recorded
IANA registry already bound into executable semantic authority. The request source account resolves
exactly once to the request household whether or not it appears in the selected funding set. The semantic
contract advances to `verin-real-derived-semantics/1.13.0` so both requirements invalidate prior signoff.

The tooling bucket measures 8138 lines under the unchanged 8300 ceiling. Canonical regeneration produces
`corpusDigest` `3403293fc63b3026616d9d00572f48ab3d8f00e3d5901b3be108f4730b38874a`.
The real-derived partition remains empty and deferred, generated-file ownership remains intact, and
captain signoff remains pending.

**Why:** runtime syntax, mutable flow, container APIs, loader call paths, self-asserted zone labels, and
foreign source accounts cannot weaken signed corpus acceptance.
**Revert path:** none while the corpus claims host independence, partition separation, recorded IANA
semantics, and request-household topology.

### D-164 · 2026-08-05 · reversible · Repository input and synthetic evidence semantics fail closed

Repository-root provenance follows only immutable bindings, so reassignment cannot redirect an approved
loader after a trusted initializer. All signed spec, schema, signoff, golden-case, and executable-authority
file reads pass through one runtime boundary that requires a regular file whose canonical target remains
inside the repository. A worktree symlink cannot import host bytes into corpus truth.

Synthetic authority state requires exactly one cited signer record. Multiple cited signers are rejected
instead of selecting the first emitted row. Bank-instruction verification is valid only after the current
change and no later than its source observation or the evaluation instant. The world schema and emitted
semantic validator enforce the same chronology.

The tooling bucket measures 8250 lines under the unchanged 8300 ceiling. Canonical regeneration produces
`corpusDigest` `5e945ae5da8f460f637980d2471d298480a14d84040b671b3bfbf187804e9b01`.
The real-derived partition remains empty and deferred, generated-file ownership remains intact, and
captain signoff remains pending.

**Why:** mutable aliases, canonical-path escapes, input-order-selected authority, and impossible
verification chronology cannot become signed replay truth.
**Revert path:** none while the corpus claims repository-contained inputs and replayable synthetic
authority and destination evidence.

### D-165 · 2026-08-05 · reversible · Repository-input refusals name their cause and one authority binding backs every digest

Every refusal from the single repository-input read path names the input and distinguishes a missing
path, an escape from the repository, and a non-regular file. Containment is decided on the canonical
target, which is also the path read, so an in-repository symlink resolves normally and only a target
that leaves the repository is refused. The blocking `corpus` job can no longer fail with a message that
names no file.

The versioned semantics a corpus is digested under - freshness policy, both real-derived JSON Schemas,
and the real-derived semantic contract with its executable authorities - are resolved once per validation
and passed explicitly to the manifest, to the digest recomputed beside it, and to the measurement report.
The manifest's `corpusDigest` and the validator's are the same object by construction rather than two
equal-by-coincidence rebuilds of the same ~50 hashed files, and `renderCorpusReport` reads no file: a
fully specified `ReportInput` is exactly what it measures. `buildManifest` takes only the inventory it
publishes, so a supplied inventory can no longer disagree with a separate file list. The dead
`CORPUS_VERSION` and `derivePick` exports are gone; `spec.world.corpusVersion` is the only corpus version.

The tooling bucket measures 8276 lines under the unchanged 8300 ceiling. Canonical regeneration produces
`corpusDigest` `7c9030abc5582face72119990c0839f3e37695428fe220527519db6c820cda7d`. The real-derived
partition remains empty and deferred, generated-file ownership remains intact, and captain signoff
remains pending.

**Why:** an anonymous refusal is unusable in a blocking gate, a second unenforced source of truth for a
signoff-bound value drifts silently, and a digest rebuilt independently in two places is only accidentally
the same digest.
**Revert path:** none while the corpus reads repository-contained inputs and binds signoff to a digest.

### D-166 · 2026-08-05 · reversible · One containment predicate, a named root, and LF as the repo-wide digest byte

The repository-input reader names the ROOT as well as the input: an unresolvable root is refused as
`repository root "..." does not exist` instead of a bare `ENOENT`, and a refusal describes its input
against whichever spelling of the root - the caller's or its canonical form - actually contains it, so a
repository reached through a symlinked root still names files repo-relatively.

Containment is decided in exactly one place. The taxonomy-citation check no longer hand-rolls its own
`realpath` + relative + regular-file sequence; it calls the same resolver the reader calls, exposed as
`isRepositoryContainedFile` because a detector over injected input must REPORT rather than abort. Two
copies of a containment predicate are two places to weaken it.

`CorpusValidation` carries the seed it validated under, so `pnpm corpus:report` measures the digest
inputs the validator used rather than a separately imported constant that only happens to agree. `loadSpec`
parses the two spec files it consumes; the defect taxonomy and the real-derived semantic contract are
strict-parsed by the loaders that own their schemas, and a discarded second parse was never a second check.

Canonical LF bytes are pinned repo-wide rather than for the fixture trees alone. `corpusDigest` folds in
the raw bytes of every executable semantic authority under `scripts/` and `src/contracts/`, and the
arch-version fence pins document bytes the same way, so a CRLF checkout would have broken the blocking
`corpus` job for a reason unrelated to any change.

The tooling bucket measures 8292 lines under the unchanged 8300 ceiling. Canonical regeneration produces
`corpusDigest` `71636c4034c16b6d3c6a2737d7c3e3acf8f98a820f6360105f7e117700b0fe17`. The real-derived
partition remains empty and deferred, generated-file ownership remains intact, and captain signoff
remains pending.

**Why:** a root is an input too, a duplicated security predicate drifts, a digest input carried beside the
result cannot disagree with it, and a byte-exact signature needs byte-exact checkouts.
**Revert path:** none while the corpus reads repository-contained inputs and binds signoff to a digest
over committed bytes.

### D-167 · 2026-08-06 · reversible · The corpus ADR is renumbered, its authority binding narrowed, and its tooling ceiling re-measured

The prompt-11 corpus ADR shipped as `ADR-0034`, colliding with the already-shipped
`0034-line-budget-infrastructure-headroom.md`. It is renumbered to **ADR-0052**, every reference is
updated, and it is registered in the ADR index it was never added to. The shipped ADR-0034 and the
ADR-0035/0036 amendment references that point at it are untouched.

`REAL_DERIVED_EXECUTABLE_AUTHORITY_FILES` no longer binds the whole runtime closure. It binds the
corpus-owned semantic modules plus exactly the shipped surfaces the replay result depends on:
`canonicalJson` and the record predicate it admits values through, the recorded IANA time-zone registry
and its reader, and the golden-case loader. `result.ts`, `errors.ts`, and the decision-record vocabulary
reached only through serializer projections the corpus never builds move to a declared
`REAL_DERIVED_GENERAL_PURPOSE_DEPENDENCIES` list. The fence holds the two lists TOGETHER equal to the
complete closure, so a new shipped dependency must be classified before it can build, and proves both
directions: a byte appended to any bound module moves the digest, every excluded module leaves it still,
and a drifted generated file still fails the byte comparison.

An evidence kind with no committed freshness window is now refused by name instead of computing
`x > NaN` and reading `"fresh"` for arbitrarily stale evidence, and the delivered schema's `evidenceKind`
enum is held equal to the executable vocabulary and the policy's windows rather than coupled to them by a
cast. A missing spec file in the generator preimage throws instead of hashing empty bytes, matching its
two sibling binders. The tautological `generatorDigest(...).length === 64` check is replaced by one that
can fail: every hand-owned file under `spec/` must be bound by a digest, so a new hand-owned input cannot
sit outside `SPEC_FILES`, the schema bindings, and the signoff while a signature survives edits to it.

The cross-time-zone determinism fence builds its in-process expectation from BOTH partitions, as the
runner does, so it reports genuine time-zone nondeterminism rather than an inventory mismatch the day the
real-derived partition is populated.

The fitness suite is now parallel-SAFE: three proofs planted fixture directories inside `REPO_ROOT`,
where they raced every fence that walks the repository, and `loadSignoff` takes a `repoRoot` like
`loadTaxonomy` already did, so containment is proven against a temp-tree root. It still runs SERIALLY,
and the reason is recorded in `vitest.config.ts` rather than left as bare flags: seven fences each build
an independent full-repository TypeScript program, and vitest isolates modules per file, so concurrency
multiplies the program. Measured on twelve cores - serial 134s with a 5s slowest fence, two workers 85s
with a 16s slowest, four workers crossing the 20s budget, twelve workers failing five files. The 40s and
60s timeout extensions the previous round added are therefore REMOVED: under the configuration CI
actually runs, no fence needs them, and a bespoke extension that only exists to survive a scheduler hides
the very slowdown a budget is for. (On the rebase onto the decision-ledger trunk the SHARED budget is
D-131's 60s, measured against a GitHub runner rather than this machine; the bespoke per-fence extensions
this entry removed stay removed - see D-177.)

ADR-0052's tooling ceiling rises from 8300 to 8700 against 8446 measured lines, taken after every change
above. The previous recorded figure was a round stale (8276 against 8292), leaving eight lines of real
headroom - the condition ADR-0033 wrote the honest-headroom rule to prevent.

**Why:** two ADRs cannot share a number; a signature invalidated by unrelated plumbing is one people
re-sign without reading; a silent default and a tautological check are both worse than no check; and a
suite forced serial without a measured reason hides whichever of the two it is.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-168 · 2026-08-06 · reversible · The corpus root is a closed inventory, strict JSON fails closed, and a contract gap reports

`fixtures/corpus/` is now an EXACT inventory. Every committed entry must be `manifest.json`, live under
`spec/`, `synthetic/`, or `real-derived/`, or be the allowlisted `README.md`; anything else fails
`pnpm corpus:validate` by name, and a missing or non-regular `README.md` fails it too. Each bucket names
the mechanism that accounts for it - regenerate-and-byte-compare, the spec digest coverage rule, the
fail-closed intake contract - so a file governed by nothing cannot sit in the tree unremarked. The
allowlist is stated in `docs/corpus.md` §2 and `fixtures/corpus/README.md`, not implied by which reader
happens to select what.

`parseStrictJson` refuses any input the YAML strict pass cannot finish instead of falling through to
`JSON.parse`. That pass is the only thing that sees a repeated key at all - `JSON.parse` resolves one
last-wins - so a diagnostic that ABANDONS the scan was a duplicate-key bypass for the four hand-owned
spec files, which get no canonical-byte re-serialization check to catch it downstream.

`inspectRealDerivedPartition` resolves semantic-contract problems BEFORE the per-file spread and skips
that spread when any are present. The per-case detectors execute the very authorities a contract gap
names, so a mis-declared contract plus one delivered intake file aborted the blocking `corpus` job with
an unhandled stack trace instead of the problem list `realDerivedSemanticContractProblems` exists to
produce. The underlying strictness is unchanged - the throws still guard a caller that reaches those
authorities without resolving the contract first.

`addBusinessDays` steps in LOCAL calendar days rather than fixed 86 400-second hops, so a DST transition
cannot drift the local wall clock and move `settlementEarliest` by a day; `isWithinRecentChangeWindow`'s
parameter is named `recordChangedAt` after the instant both call sites pass, the conflation D-078/D-080
removed; and `detectUnsanctionedReveal` takes only a `Project`, memoizing its secret-access scan per
project so the signature can no longer express a project paired with another project's access list.

**Why:** a bucket nobody named is a bucket nobody checks; a parser that gives up quietly is worse than
one that refuses; and a detector over injected data that crashes reports nothing at all.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.
### D-169 · 2026-08-06 · reversible · The corpus tree walk drops only what git refuses, and the DST correction is proven

`readTree` skips the entry names the repository's own `.gitignore` refuses to track
(`UNTRACKABLE_ENTRY_NAMES`, `.DS_Store` today). Every reader of that walk - the regenerate-and-
byte-compare gate, the exact root inventory (D-168), the spec digest-coverage rule - asks what the
COMMITTED tree holds, so surfacing a platform dropping turned opening `fixtures/corpus/` in a file
browser into a `pnpm corpus:validate` / `pnpm corpus:report` / `pnpm test` failure for a file that is
neither committed nor committable. The drop set is stated once at the walk rather than guessed per
reader, and the corpus-provenance-split fence holds every name in it against `.gitignore`, so the list
can never grant an exemption git does not; everything git WOULD track still fails closed by name.

`addBusinessDays`'s local-calendar-day stepping (D-168) now has a companion that crosses a pinned
transition in each direction and asserts the exact instant and local rendering, both of which the fixed
86 400-second stepping fails. The prior assertion stepped entirely inside EDT and passed byte-identically
under the bug.

**Why:** a check that says "committed" while reading the working tree fails on things no one can commit,
and a correction indistinguishable from the bug it replaced is detection without verification (charter #4).
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.
### D-170 · 2026-08-06 · reversible · The corpus walk drops on TRACKEDNESS, not on a name

`readTree` drops an entry only when git confirms it untracked, and only under a name in
`UNTRACKABLE_ENTRY_NAMES` (D-169). Keying the drop on the NAME alone made a force-added `.DS_Store` -
`git add -f`, or a commit predating the ignore rule - a genuinely committed byte under `fixtures/corpus/`
that no closure could see: not regenerated, not digest-bound, not intake-governed, not NFC-scanned, and
invisible to the exact root inventory D-168 added to forbid exactly that state. Trackedness is asked
lazily and once per walk (`git ls-files -z --cached`), so a tree holding no dropping never shells out,
and when git cannot answer at all - no repository, no binary - the walk drops nothing: an entry no one
can prove untracked is accounted for rather than assumed away.

The subprocess is the ONE the corpus tooling may run, registered in the corpus-determinism fence's input
boundaries with its exact argument. It cannot move a corpus byte: the drop set is a subset of
`UNTRACKABLE_ENTRY_NAMES`, and no generated path, intake path, or spec path can bear one of those names,
so no generated, inventoried, or digested value varies with git's answer. Untracked entries under any
OTHER name stay surfaced, so a delivered-but-uncommitted intake file is still validated rather than
silently passing as an empty partition.

**Why:** an exemption that a name alone can claim is an exemption anyone can plant; the walk must ask the
authority the readers actually mean - git - and fail closed when it has no answer.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.
### D-171 · 2026-08-06 · reversible · The dead-export gate reaches `scripts/**`, and freshness refuses an unparseable instant

`knip.json` listed `scripts/**/*.ts` as an ENTRY pattern, so every export under `scripts/` was assumed
reachable and the charter #5 dead-export gate could not see the tooling tree at all - the same escape
hatch ADR-0052 closed for the two budget fences, left open for a tree that now carries the corpus
generator. The entry is narrowed to `scripts/*.ts` - every TOP-LEVEL file, which is the invoked runners
plus two non-runner libraries that keep the exemption, `scripts/golden-cases.lib.ts` and
`scripts/error-message.ts` - with `scripts/**/*.ts` still in project scope. So the closure is the
`scripts/corpus/**` subtree and any future subdirectory, not the whole tooling tree; naming it as "the
runners" overstated it. `ignoreExportsUsedInFile: true` narrows it again: the gate sees only NEVER-
referenced exports, so the four symbols de-exported in this same change were beyond its reach either way
and the planted probe proves the subtree property, not the file-local one. Narrowing it immediately named
three dead exports no reviewer had found, all removed; the proof log records a planted export failing the
gate at `file:line`.

`deriveRealDerivedFreshness` now takes both instants through the corpus clock's `diffSeconds`, which
asserts canonical UTC. Its own local subtraction returned `NaN` for an unparseable instant, and
`NaN > windowDays * 86_400` is false - evidence of unknown age read `"fresh"` inside the fail-closed
intake path. The schema's `$defs/instant` pattern admits `garbage.123Z`, so nothing upstream was
guaranteed to have refused it. This is the failure the module already refuses for a missing window,
applied to the instant instead of the window.

The primitives that decide corpus bytes - `nfc`, `sha256`, `byKey`, `sortedBy`, `duplicates` - collapse
into `scripts/corpus/_util.ts`, a bound executable authority. `sortedBy` fixes emission order and
therefore `corpusDigest`, so a second copy is a second place for the corpus to drift while every gate
still reports green. Regeneration moved `corpusDigest` (bound authorities changed) and left every case's
bytes identical.

**Why:** a gate that cannot see a tree does not govern it, and a comparison that reads "fresh" for an
instant it could not parse is a fail-open in the one path built to fail closed.
**Revert path:** none while corpus version `2026.07.0` and ADR-0052 remain supported.

### D-172 · 2026-08-06 · reversible · Serial execution moves into `vitest.config.ts`; the test tree is named as unbudgeted

`vitest.config.ts` argues at length that these timeouts are honest only under `--maxWorkers=1
--fileParallelism=false`, and records the twelve-worker measurement where five files fail. It did not
HOLD that configuration: the flags lived in two `package.json` strings, so `pnpm test:watch` - a plain
`vitest` over an `include` of `src/**/*.{test,spec}.{ts,tsx}` - ran every fitness fence at default
parallelism, which is the measured failure case reachable by a documented command. `maxWorkers: 1` and
`fileParallelism: false` move into the config, and the three redundant copies (`test`, `test:fitness`,
the run `scripts/v3-invariants.ts` spawns) are dropped so one file both states the constraint and holds
it. No invocation path is left that can run these timeouts in the configuration their own rationale
calls dishonest.

ADR-0052's tooling ceiling stays at 8700 against a re-measured 8587 lines - 113 of real headroom. The
8446 recorded at D-167 was true when written and went stale by the 141 lines the two review commits
after it added, which is the same drift D-167 itself called out one round earlier. The figure beside a
ceiling is only worth what its last measurement is worth.

**DEFERRED, recorded rather than silently exempt:** `src/__tests__/**` is in no budget bucket.
`isShippedSourceFilePath` excludes it and `ceilingScopedFiles()` is shipped-source plus `scripts/**`, so
37,529 lines across 62 files - including this PR's 8,454 and a single 5,573-line fence file - sit under
no ceiling at all, while `scripts/**` now has to meet a 500-line per-file one. ADR-0052's own argument
against an unwalked tree ("moving code to `scripts/` would have been evasion rather than discipline")
applies to this tree verbatim; nothing about it being test code answers that argument. Extending the
fences is structural work, not a wrap-up correction, so it is deferred under follow-up key
`fu-corpus-test-tree-budget`. **Un-defer trigger:** the next structural test-tree work - a fence-file
split, a shared-fixture extraction, or any change that moves fence code between trees - takes the
bucket-and-ceiling decision with it. Until then the gap is stated in `line-budget.test.ts` beside the
ceilings that do hold, so no reader mistakes silence for coverage.

**DEFERRED, registered here for discoverability (ruling key `corpus11a-opus-review-20`, ruled after
this entry was written):** a formal amendment of [ADR-0016](docs/adr/0016-testing-strategy.md), which
still describes only the five test tiers and the non-UTC clock and not the execution policy this
decision moved into `vitest.config.ts`, is deferred under follow-up key `fu-adr-0016-amendment`;
AGENTS.md plus D-172/D-173/D-174 carry the fact meanwhile. **Un-defer trigger:** the next change to the
test execution policy - a project added or repartitioned, a worker-count change, or any move of the
constraint back out of `vitest.config.ts`.

**Why:** a constraint documented in one file and enforced in another is a constraint one refactor from
being lost, and an unmeasured tree that a fence's own rationale condemns should be named as a debt with
a trigger, not left to look like a scope nobody noticed.
**Alternatives:** budget `src/__tests__/**` now - rejected for this round, since a ceiling picked while
wrapping up would either be set at today's number (failing the next fence a review adds) or set high
enough to hold nothing.
**Revert path:** delete the two config lines and restore the `package.json` flags; the deferral is a
journal entry with no code to revert.

### D-173 · 2026-08-06 · reversible · The two oversized corpus fence files are split move-only; the intake filename rule gets one source; serialization is scoped to `fitness`

Ruling key `corpus11a-opus-review-18`. Four review findings, resolved in the order they constrain each
other.

**The split.** `corpus-provenance-split.test.ts` (5,572 lines) and `corpus-determinism.test.ts` (2,221)
were 11x and 4x the 500-line per-file ceiling this same PR extends to `scripts/**` - the discipline was
being asked of the tooling tree and not of the tree doing the asking. Both are now per-topic files plus
shared helper modules, and the split is MOVE-ONLY: every test block and every helper was relocated
verbatim, with no edit to an assertion, a description, or an order within a block. Safety is proved by
comparison, not by inspection: the sorted set of vitest `fullName`s before and after is IDENTICAL
(200 + 42 = 242 tests), and the whole suite is green. Two consequences are structural, not cosmetic. Each
new fence file must carry its own live `describe("detects…")` companion (the
detection-is-not-verification meta fence reads per FILE), so the enforcement chunks travel with companion
chunks rather than alone; and every new fitness file must be referenced by `charter-map.json`, so the
14 new fences are registered in the same change that adds them.

**Two helpers stayed above the ceiling, and are named rather than hidden.**
`_corpus-nondeterminism-scan.ts` (1,038 lines, `bannedNondeterminismUses`) and, before the verbatim
hoist of its pure AST readers, `blendingViolations` are single functions whose bodies cannot be divided
without EDITING them, which the move-only constraint forbids. The blending detector's stateless readers
moved to `_corpus-blending-ast.ts`, bringing both parts under 500; the nondeterminism scanner's helpers
are mutually recursive over per-file mutable state, so the same move buys ~200 lines and leaves 830 - not
compliance. It is left whole and reported here rather than split by a refactor this ruling excludes.

**The D-172 deferral stands.** D-172's un-defer trigger names "a fence-file split, a shared-fixture
extraction, or any change that moves fence code between trees" - which is exactly this change. The
ruling holds `fu-corpus-test-tree-budget` as recorded and excludes tree-wide budgets from this round, so
the trigger is recorded as FIRED-AND-HELD rather than quietly unmet. The measured figure moves with the
tree: `src/__tests__/**` is 38,125 lines (37,529 before this split, which costs one import header per
file), stated beside the ceilings that do hold.

**One intake filename rule.** `/^real-derived\/RD-[0-9a-f]{16}\.json$/` appeared identically in the
delivery loader and the collection checker, and a third time as the schema's `caseId` pattern the
checker's `expected` path already used. `intakeCaseIdPattern` now reads that pattern from the delivered
schema and `isCanonicalIntakePath`/`canonicalIntakePath` are its only statements. A pattern that is
missing, mistyped, unanchored or unparseable binds NO rule: no path is canonical AND
`caseSchemaVocabularyProblems` names the gap, so a schema edit cannot widen intake by accident. Proof log:
"one intake filename rule, read from the schema that owns the case id".

**Scope of serial execution.** D-172 moved `maxWorkers: 1` / `fileParallelism: false` into
`vitest.config.ts` and, in doing so, applied a fitness-specific measurement to `pnpm test:unit`,
`test:integration` and every other invocation. The measurement is about fences that each build an
independent full-repository TypeScript program; the unit and integration suites cause none of it. Two
vitest `projects` now hold the split - `fitness` (serial) and `app` (parallel) - so the constraint still
cannot be lost by an invocation path, and the rationale comment states the scope it actually enforces.

`realDerivedCaseProblems` appends its three delegated problem lists directly instead of funnelling
already-formed strings through `reject(true, …)` three times, and `realDerivedOutcomeProblems` is the
exported name of the function itself rather than a one-line alias for it.

**Why:** a ceiling the authoring tree is exempt from is a ceiling nobody believes, a rule written three
times is three places to drift while every gate reports green, and a measurement applied outside the tree
it was taken on is a wall-clock tax for a problem that tree does not have.
**Alternatives:** split by editing the two indivisible detectors into smaller functions - rejected, the
ruling requires move-only and a behaviour-preserving refactor of an AST detector is not a review
wrap-up; budget `src/__tests__/**` now - rejected, see D-172 and the ruling.
**Revert path:** the split is mechanical (concatenate the per-topic files back, drop the helper modules,
remove the 14 `charter-map.json` refs); the intake authority and the vitest projects are each a single
file's change.

### D-174 · 2026-08-06 · reversible · The non-determinism scanner is decomposed into a scanner object; the intake refusal is rendered from its rule; the corpus world is validated once; the vitest projects actually partition

Ruling key `corpus11a-opus-review-19`, plus one defect found while verifying it.

**The scanner object.** D-173 left `bannedNondeterminismUses` whole at 1,038 lines because the move-only
constraint forbade the only split available: its inner helpers close over per-file mutable state
(`origins`, `localFunctions`) and the walk is mutually recursive, so relocating text alone cannot divide
it. This ruling authorizes the refactor for that one function. The closure state is now an explicit
`OriginResolver` handed to each step, and the walk lives in five modules under the 500-line ceiling -
vocabulary (which origins are banned and what they are reported as), stateless AST reads, calls, member
reads, and the resolver itself - with the recorder and the reporting passes in `_corpus-nondeterminism-scan.ts`.
The proof replacing move-only is equivalence, not inspection: the FULL violation set over five trees is
byte-identical before and after in file, line, api and order (184 findings), the fence's 42 adversarial
companions are green, and an injected `Date.now()` is still caught with `file:line`.

**The refusal is rendered, not restated.** D-173 single-sourced the intake filename PREDICATE and left
the message a literal - a smaller copy of the same drift. `canonicalIntakeFilenameRule` renders the
sentence from `CASE_ID_PATTERN`, so a schema change moves rule and message together; an unbound pattern
names the schema that failed to mint a rule rather than a shape nobody holds. Proof log: "the intake
refusal is rendered from the rule it enforces".

**One corpus validation per run.** `_corpus-world.ts` called `validateCorpus()` at module scope, and
vitest isolates modules per test file, so the D-173 split raised that from 2 executions to 13 - serially,
under the fitness worker cap. A fitness-project `globalSetup` computes it once and injects it. Global
setup runs in vitest's MAIN process, which does NOT inherit `test.env`, so it reads the pinned zone back
from that same config and refuses a UTC clock the way `src/__tests__/setup.ts` does: a corpus validated in
UTC and asserted in New York is a green suite proving nothing (charter #8). No fence's assertions changed;
each still reads the same validated corpus.

**The projects did not partition (defect).** D-173 split `fitness` (serial) from `app` (parallel), but
`extends: true` runs vite's `mergeConfig`, which CONCATENATES arrays - so the root `include` was ADDED to
the fitness project's, never replaced by it. Every unit, integration and component file was collected by
BOTH projects: 21 files run twice per `pnpm test`, and one of those runs serialized under the very worker
cap D-173's comment says they are exempt from, while `pnpm test:unit` ran each file twice. The root
`include` is removed and each project declares its own scope; collection is now 53 fitness + 21 app, each
file in exactly one project, and `pnpm test` is 74 files / 1,497 tests in 144s.

**Why:** a rule stated twice drifts even when one copy is only prose; work that runs thirteen times to
produce one deterministic answer is wall clock nobody chose; and a project split that does not split is
worse than none, because the comment above it certifies a partition that never happened.
**Alternatives:** accept the 1,038-line helper with the reason recorded - rejected, the ruling authorizes
the decomposition and equivalence is provable; disable vitest isolation for `fitness` so a module-scope
`validateCorpus()` runs once - rejected, eight fitness files use `vi.mock`/`vi.stubEnv` and would leak
across a shared registry; give `fitness` an exclude list instead of removing the root `include` - rejected,
a complement list silently re-leaks the next time a test directory is added.
**Revert path:** each part is one file's change - concatenate the five scanner modules back into
`bannedNondeterminismUses`, inline the refusal literal, restore the module-scope `validateCorpus()` and
drop the `globalSetup` line, or put `include` back at the root of `vitest.config.ts`.

### D-175 · 2026-08-06 · reversible · The shared corpus world rebuilds on a watch rerun, refuses an unpinned clock, and the intake naming rule moves into its own module

Review round 20 (wrap-up), under the recorded review-15 runtime obligation that governs the shared-world
design. The ruled shape is kept; the recorded `globalsetup-widens-corpus-failure-blast-radius` cost is
narrowed in passing (a corpus that does not validate now fails the fences that READ it, not all 53).

**A watch session cannot assert against a snapshot.** D-174 moved `validateCorpus()` into a fitness
`globalSetup`, and vitest runs global setup ONCE PER PROCESS - it never re-invokes it - so every rerun in
a `pnpm test:watch` session read the world computed at startup. The fences had also stopped importing the
generator, so a `fixtures/corpus/**` or `scripts/corpus/**` edit had no module-graph edge either: the
fences would not rerun at all, or rerun green against bytes that no longer exist. Two mechanisms close it:
`forceRerunTriggers` declares the world's real inputs (corpus fixtures, corpus generator, golden fixtures
and their loader, the scenario matrix, the golden doc), and the global setup registers an `onTestsRerun`
hook that REBUILDS and re-provides the world before the rerun collects - only for its own project, so an
`app` rerun does not pay for a world it never reads. The triggers are ROOT-ANCHORED absolute globs: a bare
`**/…` refuses to traverse a dot-directory, so under a checkout like `~/.worktrees/x` (or an agent
worktree) they - and vitest's own two defaults - silently match nothing. Proven end to end in a scripted
watch session: editing `fixtures/corpus/spec/world.json` reruns `corpus-timestamps` RED and reverting it
returns GREEN, while the same edit with the rebuild hook removed reruns green against the stale world.

**The clock guard fails closed.** `pinConfiguredClock` skipped the pin when `project.config.env.TZ` did
not resolve and only refused UTC, so a config-binding break left the corpus built on the machine's own
clock - a Europe/Paris laptop passes both offset checks while the workers assert under America/New_York.
It now refuses an absent, empty or non-string zone, an unresolvable zone, and a process clock whose winter
and summer offsets disagree with the named zone, each by name, keeping the UTC refusal (charter #8).

**One validation per run is now true.** `conflict-key-families` and `corpus-timestamps` still called
`validateCorpus()` at module scope, making a full fitness run three validations rather than one; both read
the injected world. A corpus that does not validate is reported through that world as the recorded reason
and raised in the fences that READ it, rather than aborting global setup and taking all 54 fitness files
down with a setup error - fail-closed either way, since no fence can read a world that was never built.

**The intake naming rule is its own module.** `canonicalIntakeFilenameRule` rendered its message with
`pattern.source.slice(1, -1)`, which is only correct because `intakeCaseIdPattern` refuses unanchored
input - but both exported consumers take a `RegExp` from any caller, and an unanchored one corrupts both
(a substring match widens what intake accepts; a blind slice chops real pattern characters off each end
and prints a name intake rejects). The anchoring invariant is now asserted where it is relied on and
refused by name. `scripts/corpus/scrub-contract.ts` was two lines under the 500-line ceiling, so the rule -
the schema read, the pattern binding, the path, the refusal and the predicate - moved to
`scripts/corpus/intake-filename.ts` and joined the executable authority inventory (`corpusDigest` is
`86f870e6a5a35849fd7187e08136ce2da22d7771593fd5db0241c688d3080d20`; no case's bytes changed and captain
signoff remains `pending-captain`).

**Why:** a rerun that reads a snapshot is a green suite proving nothing, which is the exact class the
charter targets; a guard that silently keeps the machine's clock is the failure it exists to prevent, one
zone over; and an invariant only the default path enforces is an invariant the next caller breaks.
**Alternatives:** record the watch-mode limitation beside D-174 instead of fixing it - rejected, a
documented command that reports stale green is worse than no sharing; recompute the world on EVERY rerun -
rejected, an `app`-only rerun would pay for a world it never reads; keep the naming rule in
`scrub-contract.ts` and shrink prose to fit the ceiling - rejected, the rule has two consumers in two
files and the ceiling was telling the truth about the file.
**Revert path:** each part is one file's change - drop the `onTestsRerun` hook and the `forceRerunTriggers`
list, restore the permissive zone check, re-inline the two `validateCorpus()` calls, or fold
`intake-filename.ts` back into `scrub-contract.ts` and regenerate.

### D-176 · 2026-08-06 · reversible · The sharing fence proves the seam against a counted double, the intake anchoring rule is read structurally, and the watch trigger's cost is recorded

Review round 21 (wrap-up), under the recorded review-15 (one validation per run, without weakening) and
review-17 (real measurements) obligations.

**The fence that measures the seam no longer moves it.** `corpus-world-sharing` called the REAL global
setup and then the REAL rerun hook, so a full fitness run paid THREE `validateCorpus()` executions - the
one D-175 claimed was the only one, plus two the fence spent watching itself. The builder is now a
parameter of `setup()` defaulted to the real one, and the fence drives it with a counted double whose every
result is distinct. That proves MORE than before, not less: the exact object provided at each point is
pinned, so a rebuild can no longer be confused with a re-provide of a cached world, and the build COUNT is
asserted (one at setup, none on another project's rerun, one on this project's). What a double cannot see -
that the shipped default builds a real corpus - is proven by a new case reading the injected world and by
the eighteen fences that already read it, all on the single validation the run had already paid for.

**Anchoring is a structural property, not the first and last character.** `isWholeStringRule` tested
`startsWith("^") && endsWith("$")`, which admits three shapes that then produce exactly the corruption the
assertion exists to prevent: a top-level alternation (`/^RD-[0-9a-f]{16}|junk$/`) leaves a branch anchored
at neither end, so `.test()` matches a substring and widens what intake accepts; an escaped trailing dollar
(`/^RD-\$/`) is a literal, and slicing it for display prints a filename intake rejects; and the `m` flag
redefines both anchors while `g`/`y` make `.test()` answer differently on the same input each call. The
rule is now read structurally - class- and group-aware, escape-aware, flags checked - and each shape is
refused by its own name. A bounded alternation INSIDE the anchors still passes, so the check refuses
corruption without refusing regexes. `scripts/corpus/intake-filename.ts` is a bound executable authority,
so this changes `corpusDigest` to
`2de7c9fe090ffaf29e51063eed5261e0f949f883d55337d094a088a224ab3e25`; no case's bytes or labels changed and
captain signoff remains `pending-captain`.

**The blunt watch trigger is kept, with its cost stated.** `forceRerunTriggers` schedules every file BOTH
projects have already run, so a corpus edit mid-`pnpm test:watch` costs a full-suite cycle (MEASURED 177s
and 185s on two runs) against 48s for the 18 corpus fences that actually read the world - a ~4x tax on
corpus iteration in watch mode, most of it the serial fitness tree. Vitest 4's targeted
`watchTriggerPatterns` was weighed and refused on correctness, not taste: `getTestFilesFromWatcherTrigger`
runs BEFORE `handleFileChanged` and suppresses it on a match, so a scoped trigger must itself enumerate
every test depending on the changed input by ANY route including the module graph - and these inputs are
read with `readFileSync`, so no compiler edge backs that list. It would already be wrong:
`config/demo/scenarios.yaml` is read by `src/__tests__/unit/decision-core.test.ts` in the OTHER project,
which a fitness-scoped list would silently stop rerunning.

**Why:** a fence whose own cost falsifies the claim it proves is the measurement problem this repo refuses,
and an invariant only the default path enforces is an invariant the next caller breaks. A hand-kept
dependency map whose staleness mode is a green suite is a worse trade than wall clock.
**Alternatives:** reword the "one validation per run" claim to admit the fence's two - rejected, the seam
is provable without paying them; probe whole-string-ness behaviourally by appending a prefix and suffix to
a known match - rejected, no caller supplies a known-matching id, so the probe would only work on the
default path that already holds; adopt `watchTriggerPatterns` - rejected above.
**Revert path:** drop the builder parameter and let the fence call the real setup twice; restore the
two-character anchoring check and regenerate the manifest; the trigger list is unchanged.

### D-177 · 2026-08-07 · reversible · The corpus identifier spaces, tooling ceiling, and test budget are re-taken on the decision-ledger trunk

Rebasing this branch onto the prompt-7 decision-ledger trunk collided on three identifier spaces, and two
records cannot share a key. Prompt 7 shipped ADR-0041..ADR-0051, D-105..D-131, and PF-193..PF-204, so:

- **ADR:** the corpus ADR moves 0039 -> **0052** and its file is renamed. It has now moved twice (0034 ->
  0039 -> 0052, D-167 owning the first); the trunk's ADR-0039 (primitive vocabulary) and every ledger ADR
  keep their numbers untouched.
- **DECISIONS:** this branch's D-102..D-146 shift to **D-132..D-176**.
- **Proof log:** the corpus rounds PF-188..PF-218 shift to **PF-205..PF-235**.

Every reference moves with them - `charter-map.json`, the scenario-matrix deferral, `.gitattributes`, the
generator sources, the fence headers, and the numbering notes in D-132 and the proof log, which now record
both moves. Only lines this branch authored were renumbered; a trunk line citing a trunk id is untouched.
`fixtures/corpus/{manifest.json,synthetic/}` are REGENERATED, not hand-edited: the taxonomy note cites the
ADR path, so `corpusDigest` moves with it, to
`6a1d00b8678275660ce62f5c82476578d95724db348bdf8aa5b80d4ca4a216de`. No case's bytes or labels changed and
signoff was already `pending-captain`, so no signature is invalidated.

**The ledger's own tooling is charged to the envelope that now measures it.** `scripts/**` was unbudgeted
until this branch added the `tooling` bucket, so the trunk's build-time scripts - `seed-decision-ledger.ts`,
`ledger-rebuild.ts`, `ledger-rebuild-args.ts`, `decision-ledger-vacuity.ts`, plus the chain-verify,
restore-drill, seed and golden-loader edits, 366 lines in total - are measured here for the first time.
The ceiling rises 8700 -> **9300** against a re-measured **9053**, recorded as an ADR-0052 §7 amendment. A
ceiling is measured on the tree AS IT LANDS; inheriting the pre-rebase figure would have been a ceiling
nobody re-took. The unbudgeted `src/__tests__/**` figure is re-measured at **45,362** (the ledger suites
and fences land in the same tree); the gap stays DEFERRED under `fu-corpus-test-tree-budget`, not exempt.

**`src/contracts/decision-core/ledger.ts` is classified as a general-purpose dependency, not bound
authority.** The trunk's golden-case loader now imports and re-exports `LEDGER_EVENT_TYPES`, which put a
new module in the corpus's runtime closure - the `corpus-executable-authority` fence caught it and refused
to build until it was classified, which is the behaviour that fence exists for. It is consumed only by
`validateGoldenCases`; the corpus calls `loadGoldenCases`/`loadScenarioRefs` and derives no byte from the
ledger event vocabulary, so binding it would invalidate a signature over bytes that cannot move.

**The shared test timeout stays the trunk's 60s.** D-167 removed this branch's bespoke per-fence
extensions and left the shared budget at 20s, measured on a fast dev machine under serial fitness
execution. D-131 then raised the shared budget to 60s because a GitHub runner is roughly twice as slow and
CI timed out three whole-repo semantic fences that pass locally. Both hold: the bespoke extensions stay
removed, and the shared budget stays the one measured against the machine CI actually uses. The serial
`fitness` project, its `globalSetup` world, and the parallel `app` project are unchanged.

**Why:** two records cannot share a key; a ceiling measured on a tree that no longer exists is not
holding anything; a closure the fence cannot classify is the review decision it was built to force.
**Revert path:** none - the trunk's ids are load-bearing and this branch's are the ones that moved. The
tooling ceiling reverts to 8700 only by removing the trunk's ledger scripts from `scripts/**`.

## D-178 - Prompt-9 policy AST and interpreter land as ratified, with the grammar in contracts and the interpreter in domain

**Date:** 2026-08-07 · **Reversible** · Relates to: ADR-0053, ADR-0054,
waveb-design-ratification, ADR-0039/D-102, marriage-map C6, v3 §6.1/§6.2,
invariant 16, charter #1/#4/#5

The captain's Wave B ratification settled the design; this entry records the
landing shape and the implementation choices it left open (all detailed in
ADR-0053): the ratified grammar as strict versioned Zod schemas in
`src/contracts/decision-core/policy.ts` with exactly three ratified deltas
(constants-only `in` sets, the OQ-2 `reviewTemplateId` contract, the OQ-7
reserved `elapsed` op at grammar 1.1.0, load-refused as grammar-only); the
seven-check loader with its precise accumulated issue codes and the conservative
disjointness prover (DNF cap 64, reject-when-unprovable, per the captain's
explicit ruling); the pure four-phase evaluator with Kleene fail-closed
semantics, commutative accumulation, and the fixed disposition lattice;
day-or-finer integer freshness windows (calendar-granular and fractional
windows refuse at load - richer temporal semantics are the `elapsed`
activation's to ratify); stratification extended to `set_parameter` VALUE
nodes (forced by the phase structure - a Phase-0 value cannot read a key no
primitive has published); Phase 1 running the REAL catalog primitives over
harness-assembled invocations, with content failures landing as unevaluable
executions and only structural impossibilities refusing; and the migration
fixture pinning version-stamp-free digests under both grammar versions.

Invariant 16 activates (policy-ast fence + loader suite; the report shows 7
active-pass, 0 active-fail). The evaluation input plane is PIIBearing-marked;
the grammar's evidence-kind discriminators join the llm-pii-boundary reviewed
escapes as identifiers-never-contents; the module's pure functions join the
tenant-context port escapes with the foldDecisionProjection rationale. The
vocabulary/purity scanners shared with the primitive-catalog fence moved
verbatim into `_fence-utils`-style module `_module-scan.ts` so the two fences
cannot drift. fast-check enters as a devDependency for property families A-F.

**Alternatives rejected:** recorded in ADR-0053 (order-resolved conflicts,
interim elapsed semantics, a TenantContext on the pure evaluator, loader-only
scope).

**Revert path:** ADR-0053's revert path; ADR-0054 restores the ceilings.

## D-179 - Prompt-9 review round: an unevaluable rule contributes nothing, and the grammar pin reads the real schemas

**Date:** 2026-08-07 · **Reversible** · Relates to: D-178, ADR-0053, ADR-0054,
firm ruling `p9-param-rejection-trace`, v3 §6.1, invariant 12/16, charter #1/#4

Five corrections to the prompt-9 landing, all forward fixes:

**Atomic unwind (the firm ruling).** When Phase 1 rejects a policy-resolved
parameter, the writing rule is marked unevaluable - but Phase 0 had already
applied ALL of its effects. The trace therefore reported a parameter resolution
the primitive never ran with, and named an `unevaluable` rule inside
`approvalRequirements` / `prohibitions` / `blockers` / `evidenceRequirements` /
`strategyResolutions`. Invariant 12 makes the trace the output, so the ruling is
FULL ATOMICITY: every Phase-0 contribution of the rejected rule is unwound
first, an accumulator whose only contributor was that rule disappears with it,
and the synthesized `rule-unevaluable:<id>` blocker carries the reason. The
blocker accumulator now keys resolving evidence kinds PER CONTRIBUTING RULE, so
a co-contributor's blocker survives with only its own resolving kinds. The
disposition was already fail-closed and stays so.

**The grammar-closure pin now reads the shipped schemas.** It compared a
hard-coded ratified list against a second hard-coded list of vocabulary
constants that fed no schema, so the only widening it could catch was a widening
of the list. It now introspects `policyAstSchemaFor` - the factory `loadPolicy`
itself parses with - down to the predicate arms, comparator enum, value-node
discriminators, and effect discriminators, and holds BOTH the ratified pin and
the contracts constants to that. `findReservedOps` reads
`RESERVED_PREDICATE_OPS` instead of restating `elapsed` as a case arm, so the
declaration is load-bearing.

**Canonical temporal bytes match the brand.** `temporal.ts` validated digit
COUNTS, so `2026-13-45T99:88:77.000Z` parsed into an epoch value instead of
refusing, while `TimestampSchema` rejects it - and `asOf` / `observedAt` are
plain strings, so the brand is not on that path. The byte forms now carry the
brand's field ranges plus integer-only calendar-day validity, and `load-checks`
consumes the same predicates rather than duplicating looser regexes.

**String constants widen, string references do not.** `typesAgree` let ANY
`string`-typed operand agree with `iso-date`/`iso-timestamp`, though its own
rule is about string CONSTANTS; the canonical-form guard then passed
non-constants vacuously, so an ordering comparison over an arbitrary string
reference loaded. Agreement now takes the operands, not just their types.

**One walk per rule.** `primitiveKeyReads` ran twice per rule (stratification
check, then phase classification); it is computed once and shared, which is also
what makes the two consumers provably one definition.

ADR-0054's figures were taken before this round and went stale by 20 lines in
contracts and 13 in domain, with domain passing its own ceiling. Re-measured on
the tree as it lands: contracts 6,555/6,600 and domain 4,063, so ADR-0054 is
amended to a 4,150 domain ceiling. The pinned migration-fixture digests are
unchanged - the fixture does not exercise the rejection path.

**Alternatives rejected:** recording the rejected parameter resolution with a
"rejected" marker instead of dropping it (the ruling is atomicity, and a
half-present rule is what the finding names); keeping the vocabulary constants
as a second declaration list checked only against the pin (that is exactly the
tautology).

**Revert path:** D-178's revert path; each correction is independent of the
others.

## D-180 - Prompt-9 review round two: the unwind cascades, and rejection blames only the rule that wrote the refused name

**Date:** 2026-08-07 · **Reversible** · Relates to: D-179, ADR-0053, ADR-0054,
firm ruling `p9-unwind-scope-and-freshness`, v3 §6.1, invariant 12/16, charter #4

Five corrections to D-179's atomic unwind and its neighbourhood, all forward
fixes:

**The unwind cascades to every primitive the rejected rule configured.** D-179
unwound a rejected rule's Phase-0 contributions, but Phase 1 had already run and
only the REFUSING primitive was skipped. One rule may write `set_parameter` to
two primitives (load check 7 keys on `set_parameter:<primitiveId>:<parameter>`),
so the other could publish a result computed from a write the trace no longer
records. Per the ruling, option (i): every primitive a rejected rule configured
by `set_parameter` or `select_candidate` now lands `unevaluable`, publishes
nothing, and its dependents fall out unevaluable through the ordinary
missing-binding path - so no published value anywhere in the trace rests on a
deleted write. No re-evaluation pass (option (ii) was rejected).

**Rejection blames only the rule whose written name was refused.** The rejection
was attributed to every rule that had written ANY parameter on that primitive,
which under atomicity erased an innocent rule's whole Phase-0 contribution.
Attribution now reads the parameter names the schema refusal actually names
(issue `path[0]`, strict-object `keys`, recursing through union arm `errors`)
and implicates exactly the rules that wrote one; when no policy-written name is
among them the malformed harness assembly keeps the structural refusal.

**One context-key precedence.** `resolveValue` read intent first and the Phase-1
binding assembly read published facts first, so a key present in both would
resolve two ways in one evaluation. Both now go through `resolveContextKey`:
published facts, then intent. `deriveContextKeys` already refuses the collision
upstream, so the order decides nothing today - naming it once is what keeps it
that way.

**A future-dated observation is unevaluable, not maximally fresh.** `is_fresh`
computed `asOf - observedAt <= window`, and a negative age satisfies every
window, so impossible-in-time data read as fresh and a `not(is_fresh(...))`
staleness guard silently did not fire - the one fail-open corner in a
fail-closed evaluator. It now returns unevaluable with an
`is_fresh:<kind> (observation after asOf)` ref, so the rule synthesizes its
blocker like every other content failure.

**Symmetric assembly guards, deterministic rejection keys.** The constant
binding overwrote a disagreeing harness context entry while the context binding
refused one; both now refuse with `context-assembly-conflict`. A rejected
invocation's execution was also filed under `<primitiveId>:<executions.size>`,
which is invocation-LIST order - two rejections in different input orders
produced different trace bytes. Every execution, rejected or not, is now keyed
by its canonical `(primitive, parameter bytes)` identity, and duplicate
detection moved onto that one key so a duplicated rejected invocation is refused
rather than silently collapsing.

ADR-0054's domain figure went stale again by this round's 101 lines and passed
its own 4,150 ceiling. Re-measured on the tree as it lands: contracts 6,555
(unmoved) and domain 4,164, so ADR-0054 is amended to a 4,250 domain ceiling.
The pinned migration-fixture digests are unchanged - the fixture exercises
neither the rejection path nor a future-dated observation.

**Alternatives rejected:** re-running Phase 1 without the unwound rule's writes
(ruled out explicitly - a second evaluation pass is a second semantics);
unwinding an innocent co-writer's contributions too (its write resolved, nothing
refused it, and nothing published rests on it).

**Revert path:** D-179's revert path; each correction is independent of the
others.

## D-181 - Prompt-9 review round three: the predicate union discriminates, admission is depth-bounded, and rejection implicates rather than misdiagnoses

**Date:** 2026-08-07 · **Reversible** · Relates to: D-178, D-179, D-180, ADR-0053, ADR-0054,
v3 §6.1, invariant 12/16, charter #4

Five corrections, all forward fixes, none of them narrowing the ratified grammar:

**The predicate arms discriminate on `op`.** `predicateSchemaFor` built its arm list with
`z.union`, which tries every option in order, and a strict object does not abandon its remaining
keys once one fails - so the `all` arm fully re-parsed the children of every `any` node before the
right arm was reached. MEASURED: 588ms at eleven nested connectives, quadrupling every two more,
against 0.03ms for the same document once the arms discriminate. `ValueNodeSchema` and
`PolicyEffectSchema` already discriminated; the predicate arms now match them, which also means a
wrong `op` reports itself instead of aggregating seven arms of noise. The arms lost their
`.readonly()` wrapper (a wrapper carries no discriminator, and the ratified value and effect
unions never froze their outputs either); canonical bytes are unchanged, so the pinned
migration-fixture digests did not move.

**Admission is depth-bounded, because everything below it recurses.** `all`/`any`/`not` nest
without limit by ratification, and the Zod parse, `findReservedOps`, the closure and key-read
walks, `predicateDnf`, and `evaluatePredicate` all recurse with them - so a deep document threw a
RangeError out of `loadPolicy`, which is contracted to return typed errors and never throw
(MEASURED: `safeParse` overflowed between 600 and 800 levels). `loadPolicy` now refuses a document
nested past a 64-level structural cap, BEFORE the parse and by an ITERATIVE walk, since the parse
is one of the recursions the bound protects. Bounding once at admission is what makes the module
total: a `LoadedPolicy` is the only thing the evaluator consumes, so no later walk has to carry a
depth it cannot. The cap counts raw document nesting (roughly two levels per connective), leaving
~30 nested connectives against the three or four a real firm policy uses.

**A rejection with no attributable name implicates the writers, it does not misdiagnose.** D-180
attributed a parameter rejection to exactly the rules that wrote a NAMED refused parameter and
kept the structural refusal otherwise. But a write can flip the arm of a discriminated parameter
union - `set_parameter(sufficiency-check, mode, "cap-limited")` is admissible at load, and at
runtime the newly selected strict arm refuses the `available` DEFAULT the harness supplied,
naming a key no rule wrote. The evaluator then hard-refused `invalid-invocation-parameters` on
legal policy content, contradicting the rule that a refusal is a STRUCTURAL impossibility. When
the refusal names no policy-written parameter but a policy write DID reach that primitive, every
writer on it is now implicated and the ordinary fail-closed unwind runs; the structural refusal is
kept for the case it was written for - no policy write on the refusing primitive at all. D-180's
named-attribution rule still wins whenever a name IS available, so an innocent co-writer's
Phase-0 contribution is still not erased on a refusal that names someone else.

**The evidence-requirement comparator is as total as its accumulation key.** Entries accumulate
under `kind:absence:reviewTemplateId` but sorted on `(kind, absence)`, so two specialist
requirements on one evidence kind under DIFFERENT review templates compared equal and fell back to
Map insertion order - rule-id order leaking into bytes the migration fixture pins.
`reviewTemplateId` is now the third term.

**The context-key collision refusal is structural.** `deriveContextKeys` returned
`{ contextKeys, collisions }` with the colliding key ADMITTED under the intent origin, so a caller
that ignored the side channel would register a key `primitiveKeyReads` does not count as a
primitive read - the rule classifies `configuration`, the OQ-6 stratification check never fires,
and the same key resolves from intent in Phase 0 and from published facts in Phase 2. That is
precisely the one-key-two-resolutions outcome D-180 said was impossible. It now returns a
`Result`: no registry at all on a collision, so no caller can admit one.

Also folded in: the Phase-0 parameter writes are keyed by their `(primitiveId, parameter)` target
instead of re-scanned out of a list by object identity, which drops a quadratic lookup and a
non-null assertion from a function documented never to throw. ADR-0054's domain figure passed
inside its 4,250 ceiling by TWO lines, which is the ADR-0033 failure mode the line-budget header
exists to prevent, so ADR-0054 is amended a third time to 6,650/4,350 against re-measured
6,567/4,248.

**Alternatives rejected:** capping depth inside the grammar (the Zod parse is itself one of the
recursions, so a refinement runs too late); a dedicated `predicate-too-deep` issue code (the
refusal happens before any rule is parsed, so it has no rule to name - `grammar-parse` is the code
the other pre-parse structural refusal already uses); detecting discriminator flips specifically
rather than falling back to all writers (the general fail-closed rule subsumes it and cannot be
defeated by a schema shape the detector did not anticipate).

**Revert path:** D-180's revert path; each correction is independent of the others.

## D-182 - Prompt-9 review round four: the synthesized reason-code namespaces are reserved at load, and every fact source fails closed on a non-scalar

**Date:** 2026-08-07 · **Reversible** · Relates to: D-178, D-179, D-180, D-181, ADR-0053,
v3 §6.1, invariant 12/16, charter #4, ruling p9-blocker-namespace

**The evaluator owns its blocker-code namespaces, and the loader proves it.** Trace blockers key
on the code alone, and the evaluator synthesizes two namespaces into that key space:
`rule-unevaluable:<ruleId>` and `evidence-required:<kind>`. `ReasonCodeSchema` is
`brandedString()` with no shape to refuse a collision, so a firm could author a `blockerCode` of
literally `rule-unevaluable:rule-x` - and the authored entry would MERGE with the platform's, one
trace blocker pooling firm rule ids and resolving kinds with a platform unevaluability, one
`blockerCodes` entry standing for both. Fail-closed safety was never at stake; attribution and
resolvability were. Per the firmmate/captain ruling, option (a) LOAD-TIME RESERVATION: the two
prefixes are declared ONCE in `trace.ts` next to the constructors that mint them
(`RESERVED_REASON_CODE_PREFIXES`, `ruleUnevaluableBlockerCode`, `evidenceRequiredBlockerCode`), so
the loader's refusal and the evaluator's synthesis read the same source and cannot drift, and
`loadPolicy` refuses an authored `block`/`prohibit` code under either prefix as
`reserved-reason-namespace`, naming the rule, the code, and the prefix. Option (b), keying
blockers by (source, code), was explicitly rejected: it changes the trace shape and would move
every pinned digest for an attribution problem a load-time refusal solves outright.

**A non-scalar is a miss in EVERY value source, not just the published one.** `resolveValue`
scalar-checked only the `context` arm, where published facts are structured by declaration. But
`PolicyEvaluationFacts` is a plain harness-assembled type with no runtime validation anywhere in
the module, and a structured value at a declared evidence or instruction path flowed straight into
`compareScalars` (where `eq` degrades to reference equality and every ordering comparator lands in
its type guard) and into `memberOf` (where no member can match) - three different ways for a
restrictive rule to read `not-fired` on malformed data, in a module whose whole posture is that an
unresolvable read lands unevaluable and synthesizes a blocker. All three sources now apply the
same guard.

Also folded in: `policyAstSchemaFor` is memoized per grammar version over the closed
`POLICY_GRAMMAR_VERSIONS` list (the factory is a pure function of that list, and it was rebuilding
the lazy predicate union, its discriminator map, the six effect schemas, and two refinements on
every load); and the pre-parse depth walk carries an integer depth instead of materializing a path
array per node, since the path was read only by the refusal message and the walk runs over every
node of every document. Neither moves trace bytes - the pinned migration digests are unchanged.

**Alternatives rejected:** a `ReasonCode` schema-level shape refusal (the brand is deliberately
opaque, and the reservation belongs to the evaluator that mints into it, not to the id
vocabulary); a runtime validator over `PolicyEvaluationFacts` (assembly is prompt 14-16's, per
D-102 - the interpreter's job is to fail closed on what arrives, which it now does uniformly).

**Revert path:** D-181's revert path; each correction is independent of the others.

## D-183 - Prompt-9 review round five: ADR-0054's ceilings hold, and its figures are re-taken

**Date:** 2026-08-07 · **Reversible** · Relates to: D-178, D-182, ADR-0018, ADR-0033, ADR-0054,
charter #1/#14

**A ceiling raised without a measurement beside it is a ceiling nobody is holding, and a
measurement left stale is the same ceiling with a number nobody re-took.** That is the
line-budget fence's own header, and D-182's commit broke it: 80 domain lines (trace, load, facts,
evaluate, load-checks) and 17 contracts lines (the grammar-schema memoization) landed while the
header and ADR-0054's table still read the round-three figures, 6,567/4,248. The build passed on
4,328 against 4,350, so nothing failed - which is exactly why a stale figure is dangerous rather
than loud: it reports 102 lines of correction room where 22 exist, and the next one-line fix
anywhere under `src/domain/**` fails `pnpm test` on an unrelated ceiling. Both the fence header
and ADR-0054's table are re-measured with the fence's own algorithm on the tree as this
correction lands: contracts 6,584/6,650 (66), domain 4,328/4,350 (22), infrastructure
7,786/7,840 (54). The `src/__tests__/**` figure, which no ceiling holds, is re-taken the same way
at 49,014 (45,362 before the prompt-9 suites, property families, and fence landed).

**The ceilings do NOT move.** Both layers measure inside their envelopes, and a measurement that
stays inside its envelope is not a reason to raise one - raising on a passing measurement is how a
ratchet turns into a rubber stamp. The 22 lines left on domain are named in both places instead of
banked, so the next change under `src/domain/**` reads as the measured ADR-0054 amendment it now
is. This correction touches only comment and documentation text, so it cannot move the totals it
records: `load.ts`'s header sentence was rewritten line-for-line, and the re-measure was taken
after the edit and confirmed against the fence's own reported totals.

Also folded in: that `load.ts` header now says checks 2-4 live in `load-checks.ts` EXCEPT check
2's reserved-namespace half, which the 500-line per-file ceiling keeps in `load.ts` -
`load-checks.ts` sits at 495. The documentation now matches the real layout rather than the
intended one.

**Alternatives rejected:** raising the domain ceiling to buy the round-five headroom the finding
suggested (nothing exceeded it, and ADR-0018 makes a raise a measured amendment for growth that
happened, not for growth anticipated); moving the namespace half of check 2 into `load-checks.ts`
to match the header (it would push that file to ~511 and fail the per-file fence - the seam to
reunite check 2 is a reference-closure module, and that is the next edit to that file, not this
one).

**Revert path:** restore the round-three figures in `src/__tests__/fitness/line-budget.test.ts`
and ADR-0054; the ceilings are unchanged, so there is nothing else to undo.

## D-184 - Prompt-9 review round six: key-shaping parameters are configuration, not policy

**Date:** 2026-08-07 · **Reversible** · Relates to: D-102, D-104, D-178, D-181, D-183, ADR-0039,
ADR-0053, ADR-0054, charter #1/#3/#4, ruling `p9-key-shaping-params`

**A primitive's published context keys are DERIVED from its configured parameters, once, at load -
so a policy write to one of those parameters silently desynchronizes the closed vocabulary from the
runtime key space.** `candidate-selection.publishedKeys` builds every key from `subjectSlot`,
`evidence-reconciliation` from `factKind`, `net-availability` from `claimEvidenceKinds`, and
`restriction-screen` from `restrictionKinds`; all four are ordinary parameters, so
`parameterSchemaKeys` yielded them and `parameterConstantAdmissible` accepted a write. The
consequences run past a bad read: rules reading the derived key miss and land unevaluable,
`published-key-escape` cannot see it because `producedKeys` derives from the same shifted call, and
two invocations that differ only in that parameter collapse onto one canonical identity - a
`duplicate-invocation` or `published-key-collision` REFUSAL driven by admissible policy content,
which `trace.ts` reserves for structural impossibilities.

**The catalog now declares it, and the declaration is the single source of truth.** Every entry
carries `keyShapingParameters`, and `loadPolicy` refuses a `set_parameter` naming one with
`key-shaping-parameter-not-writable` (rule, primitive, and parameter named). The check runs BEFORE
constant admissibility, so an author is told the write is illegal rather than that the value is
wrong. The `primitive-catalog` fence reads each `publishedKeys` body with ts-morph and requires the
declaration to equal the parameters it actually reads - the metadata cannot go stale, and a body
this fence cannot read statically (destructured, computed, whole-object) fails closed rather than
scanning as "reads nothing". A new property family (G) proves the runtime consequence over EVERY
parameter of every catalog primitive: no write the loader accepts changes the key set an invocation
publishes.

**Prompt 10 must not re-open this.** A binding chooses the key scope; a rule may not move it.
Recorded here and in `docs/primitive-rationale.md` so the binding model inherits the constraint
rather than rediscovering it.

**Also folded in:** `fast-check` is exact-pinned to `4.9.0`. It was the only floating specifier in a
manifest where all 37 other dependencies are exact, and its generator and shrinker behavior is what
the property families registered against v3 invariant 16 are proven with - a silent minor bump
changes what the invariant means.

**The per-file ceiling forced a split, and the split is the one D-183 named.** `load-checks.ts` sat
at 495 lines with all of `checkEffects` in it, so the new check had nowhere to land.
`load-effects.ts` now holds every check that reads an effect, which reunites check 2's
reserved-namespace half (stranded in `load.ts` by the same ceiling) with the walk it belongs to and
drops the second iteration over `rule.effects`. That costs one module header and one import block;
ADR-0054 is amended a fifth time to domain 4,500 against a re-measured 4,400, contracts unmoved at
6,650 against 6,602 - the raise pays for code, not for formatting (ADR-0050).

**Alternatives rejected:** detecting the desync at evaluation time (it is detectable only as the
refusal the module contract forbids for policy content, and the trace would carry no rule to blame);
deriving the shaping set from the AST at load instead of declaring it (the loader would depend on
source introspection at runtime - the fence is where an AST claim belongs, and it holds the
declaration honest instead); leaving the parameters writable and re-deriving the registry per
resolved write (Phase 0 runs after the vocabulary must already be closed, which is what OQ-6
stratification exists to guarantee).

**Revert path:** drop `keyShapingParameters` from `CatalogPrimitive` and the six entries, delete
`checkKeyShapingWrite` and its issue code, fold `load-effects.ts` back into `load-checks.ts` and
`load.ts`, restore ADR-0054's round-five figures and the `^4.9.0` fast-check range.

## D-185 - Prompt-9 review round seven: a context key resolves by its declared origin

**Date:** 2026-08-07 · **Reversible** · Relates to: D-102, D-181, D-182, D-183, D-184, ADR-0053,
ADR-0054, charter #3/#4

**Searching two planes in order is a fail-OPEN when one of them is unvalidated harness input.**
`resolveContextKey` read the published facts first and fell back to `facts.intent` for ANY key.
`PolicyEvaluationFacts.intent` is a plain `ReadonlyMap<string, Scalar>` the harness assembles, and
nothing checks its keys against `registries.contextKeys` - so a stray intent entry sitting under a
primitive's published key SUBSTITUTED for the fact whenever that primitive landed unevaluable and
published nothing. `net-availability` refusing its own input left `availability.net` unpublished,
the intent entry resolved, and the Phase-2 rule reading it compared, fired, and reached its effects
on harness data - in a module whose contract is that an unresolvable read makes the enclosing rule
unevaluable and synthesizes its blocker. The structural collision refusal of D-181 closed the
DERIVED vocabulary; it could not close this, because the two keys never meet in the registry.

**Resolution now reads the key's DECLARED ORIGIN, not a search order.** A key the registry declares
`{source: "primitive"}` resolves ONLY from that run's published facts; `{source: "intent"}` resolves
ONLY from the intent slots; a key the registry never declared resolves nowhere. The registry rides
with the published facts as one `PolicyContextPlane`, so the AST value plane and the Phase-1 binding
assembly cannot disagree - the same object serves both, which is what keeps one key to one
resolution per run. The substitution is now unrepresentable rather than improbable: the map the
harness controls is never consulted for a key it does not own.

**Fenced by a companion that fails on the old code.** The regression case puts an intent entry under
`availability.net` while `net-availability` refuses its input, and pins BOTH planes - the rule lands
unevaluable with `context:availability.net` and only its synthesized blocker, and `sufficiency-check`
misses the same binding. Restoring the ordered search makes the rule read `fired`, which is the
whole finding. The both-present precedence case of D-180 is unchanged: published still wins, because
`availability.net` is primitive-origin.

**Also folded in:** ADR-0054's TITLE and the `docs/adr/README.md` index row said domain 4,350 while
the Decision section, table, and fence all said 4,500 - the two artifacts a reader consults first
disagreeing with the enforced number, which is D-183's staleness class in the headings rather than
the figures. Both now read 4,500, and both the fence header and the ADR table are re-measured on the
tree as this correction lands: contracts 6,602/6,650 (48), domain 4,444/4,500 (56). The ceilings do
NOT move - a measurement inside its envelope is not a reason to raise one. AGENTS.md's policy-AST
paragraph gains the D-184 key-shaping constraint (prompt 10's implementer reads that file every
session; DECISIONS.md and `docs/primitive-rationale.md` are not loaded), the corrected ten-file
inventory with `load-effects.ts`, and this origin rule.

**Alternatives rejected:** validating `facts.intent` keys against the registry at the evaluator
boundary (it turns a harness assembly bug into a whole-evaluation refusal, which `trace.ts` reserves
for structural impossibilities, and it would still leave the resolution order deciding the answer for
every key that passed); keeping the ordered search and documenting the hazard (the same
documented-not-enforced posture D-181 rejected for the collision case).

**Revert path:** restore the two-line ordered lookup in `resolveContextKey`, drop
`PolicyContextPlane` and pass `publishedFacts` again through `facts.ts`, `evaluate.ts`, and
`evaluate-primitives.ts`, and delete the shadowing regression case.

## D-186 - Prompt-9 follow-up: temporal-typed fact reads hold their bytes to the canonical forms

**Date:** 2026-08-10 · **Reversible** · Relates to: D-102, D-182, D-185, ADR-0053, charter #4;
firm ruling `p9-temporal-fact-bytes` (post-merge review of PR #34, applied as its own PR)

**Lexicographic ordering is chronological ONLY for canonical bytes.** Load check 5 pins temporal
byte forms for string CONSTANTS, and `is_fresh` refuses a non-canonical `observedAt`/`asOf` at
runtime - but a harness-supplied evidence/instruction/context value under an
`iso-date`/`iso-timestamp`-typed registry path reached `compare`/`in` positions with only the
scalar check. `'2026-8-1'` sorts AFTER `'2026-12-31'` (`'8' > '1'`), and an offset instant like
`'2026-08-01T12:00:00+02:00'` interleaves arbitrarily with Z-suffixed ones, so a rule read
chronologically wrong data and silently fired or not-fired - the same silent-wrong-answer class
D-182 closed for non-scalar facts and future-dated observations. Reachable through declared
timestamp paths (`reservation-release.releasedAt`, `bank-instruction-change.changedAt`).

**The fix plumbs the declared types into resolution rather than trusting assembly.**
`PolicyContextPlane` now carries the evidence and instruction path registries alongside the derived
context-key registry (the plane is the declared vocabularies resolution validates with, not just
the published facts), and `resolveValue` holds a value under a temporal-typed path to
`isCanonicalDate`/`isCanonicalTimestamp`: non-canonical bytes - including a non-string under a
temporal type - are the same miss a non-scalar gets, so the enclosing rule lands unevaluable and
synthesizes its blocker with a precise `(non-canonical iso-date/iso-timestamp bytes)` ref.
Constants stay load-validated; `exists` stays presence-only; no new module files and no grammar
change, so the migration fixture digests are unchanged.

**Proven by example and by property.** The evaluate suite pins all three sources (offset timestamp
under an evidence path, the ruling's `'2026-8-1'` under an instruction path, a number under a
date-typed intent slot) landing unevaluable with their refs, and the SAME reads over canonical
bytes firing - over-refusal cannot hide. Property family H generates instants and four
non-canonicalizing mutations per form and asserts the mutated bytes always synthesize the
`rule-unevaluable` blocker while the canonical form of the same instant never does.

**Prompts 14-16 keep their own obligation.** Assembly-time canonicalization (evidence projection,
tz anchoring - D-102) still owes canonical temporal bytes at the boundary; this guard is the
fail-closed backstop for bytes that arrive wrong, not a substitute. Recorded in the `facts.ts`
module header where the assembly contract is documented.

**The guard is measured, not squeezed.** It costs 70 domain lines (the helper, the three arm
checks, the plane fields, and their rationale), landing domain at 4,514 against the 4,500 ceiling.
ADR-0054 is amended a SIXTH time - domain 4,550 on the 4,514 measurement, contracts unmoved -
rather than compressing the rationale to fit (the ADR-0050 posture). The
`llm-pii-boundary` escape set gains `PolicyContextPlane.evidence` with the same
identifiers-never-contents justification as `PolicyRegistries.evidence`, which is the map it
threads.

**Alternatives rejected:** deferring entirely to prompts 14-16 as a named obligation (leaves the
ratified fail-closed posture unenforced until a future prompt honors a note - the same
documented-not-enforced posture D-181/D-185 rejected); validating the whole facts plane at the
evaluator boundary (turns content into a structural refusal, which `trace.ts` reserves for
impossibilities).

**Revert path:** drop the two registry fields from `PolicyContextPlane` and the
`temporalByteMiss` guard in `facts.ts`, restore the three plane constructions in `evaluate.ts` /
`evaluate-primitives.ts`, and delete the evaluate case, property family H, and the two
temporal-typed world paths (`standing-preference.effectiveOn`, `intent.requestedOn`).

### D-186 · 2026-07-28 · captain-decision · Gate A owns invariants 1, 2, 4, 5; invariant 3 is gated at B

Gate A (Wave A, prompts 4-7) required all five foundation invariants, but invariant 3 ("no core module,
directory, or evaluator branch is named for a decision domain") cannot activate until prompt 10 migrates
account opening into the domain-configuration system - and prompt 10 is in Wave B, which cannot begin
until Gate A is green. The governance contained a cycle whose only other exits were re-ordering prompt 10
ahead of its own prerequisites or declaring invariant 3 green on substrate that does not implement it.

Captain ruling (decision key `gate-a-ordering`): Gate A requires invariants 1, 2, 4, and 5 active and
green; invariant 3 stays honestly `not-yet-active` until prompt 10; Gate B requires invariant 3 active
and green; Wave B may begin only after prompts 5, 6, and 7 have landed and Gate A's corrected
requirements are green; no document, proof, or UI may claim invariant 3 is implemented before prompt 10
exists.

Implemented as structure, not prose (ADR-0055): `v3-invariants.json` gates are now `{wave, prompts,
requires, entryCondition, outcome}`, invariant 3 moves to gate B, every not-yet-active invariant declares
`activationPrompts`, and invariant 3 declares `activationArtifacts`
(`config/domains/account-opening.yaml`, `config/domains/money-movement.yaml`) that must exist before it
may be flipped to `active`. `src/__tests__/fitness/v3-gate-ordering.test.ts` fails the build if any gate
requires something that lands after that gate closes, if activation ownership drifts from the
requirement list, or if prose names a later prompt than the structured field admits.
The ratified `verin-prompt-sequence-v3.md` keeps its verbatim bytes and pin; its Gate A sentence is read
through ADR-0055, the same mechanism ADR-0024 and ADR-0026 use to override v3's letter.

Review round `gatea-opus-review-1` (2026-07-28) amended ADR-0055 in place on four points, without
touching the original ruling: **(1)** all nine gates of the ratified sequence are registered (0, A, B, C,
D, E, F, G/H, I) - Gate D's entry condition cited "Gate C is green", a precondition nothing could
compute; **(2)** `requires` becomes a list of TYPED requirements (`invariant` | `artifact` | `fitness` |
`ci-gate` | `evidence`), separating activation OWNERSHIP (`invariant.gate`, what the ordering rule is
computed against, and which every gate must require for the invariants it owns) from gate REQUIREMENT
(what a gate needs to be green, which may REFERENCE invariants earlier gates own - Gate C restates
invariant 1 without taking it from Gate A); **(3)** a gate with no machine-checkable requirement is
rejected by the fence and can never read green in the report, because empty sets never prove readiness;
**(4)** the rule set moves to `scripts/v3-gates.lib.ts` so the blocking runner enforces every rule the
fence does - the runner's report is itself a document bound by ruling clause 5, and it previously
re-checked only the ordering rule. The fence also stopped asserting invariant 3's transient
`not-yet-active` status and now asserts the durable rule that `active` requires its declared prompt-10
artifacts to exist.

Review round `gatea-fix-review-2` (2026-07-28) amended ADR-0055 in place again, still without touching
the original ruling: **(1)** the ordering rule is decided from a requirement's PROOF POINT (the last of an
invariant's `activationPrompts`, or - when it declares none - the closing prompt of the gate that owns
it) instead of short-circuiting on `status: "active"`, so a gate referencing an invariant a LATER gate
owns now fails whether or not that invariant is already active, and the verdict does not flip when one
activates; **(2)** `ci-gate` requirements and mechanisms name the `command` their blocking job runs,
checked against a structural parse of `ci.yml`, because a job NAME alone is satisfied by a comment or a
path; **(3)** both prose scanners cover every spelling the registry uses - ranges, comma lists,
conjunctions, and lower-case gate names - while still reading nothing that merely looks like a prompt
reference; **(4)** two RATCHETS in the fence file pin the complete 30-invariant activation-ownership map
and every gate's invariant requirement set, so pushing an invariant to a later gate fails CI even though
it passes every structural rule; **(5)** Gate B additionally requires invariant 16 and Gate C invariant
11, each being complete inside that gate's own prompt range, while invariant 6 stays a Gate D requirement
because it needs BOTH prompt 15's bundle and prompt 16's evaluator - a requirement-set change only, since
16 stays owned by Gate E and 11 by Gate D. Where the ruling's general reference rule and its specific
Gate-B-requires-16 instruction conflict, ADR-0055 records that the specific instruction governs and the
general rule is enforced in its provable form (proof point at or before the referencing gate's close).

Review round `gatea-review-3` (2026-07-28) amended ADR-0055 in place a third time, on the two halves of
"a job NAME is not evidence" that the second round's hand-rolled line scanner still left open: **(1)**
`parseCiJobs` now uses the real YAML parser (`yaml`, already a declared dependency) and walks
`jobs.<key>.steps[].run`, because the scanner read a column-0 comment as leaving the `jobs:` block -
silently dropping four jobs including the blocking `v3-invariants` one - and matched a step's `env:`
value by indentation; **(2)** YAML alone is insufficient, since inside a `|` block scalar a `#` is
literal script text, so each `run` script is additionally split into the commands it EXECUTES with shell
comments stripped (quote-aware) and `\` continuations rejoined - otherwise
`# pnpm audit:chain temporarily disabled` kept proving the blocking gate it had just switched off, with
invariant 5 still reading `active-pass`; **(3)** a gate's `awaiting:` line now lists every requirement
holding it back, undecidable ones included, so gate C names its `evidence` clause instead of printing
only `#1 · #11`. The gate state machine is unchanged: green still requires zero unmet AND zero
undecidable requirements, and no gate reads green.

Review round `gatea-fix-review-3` (2026-07-28) amended ADR-0055 in place a fourth time: **(1)** the
requirement ratchet pins each gate's COMPLETE TYPED requirement set (kind plus id/ref, plus a `ci-gate`'s
command) rather than its invariant ids - gate 0's only unmet requirement was its `evidence` clause, so
deleting that one entry passed every structural rule and both prior ratchets and printed `✓ green` for a
gate whose §4 surface completeness nothing decides; **(2)** a `ci-gate` is proven only by a job that also
BLOCKS: `continue-on-error` (job or step) and any `if:` are read as neutralizing, because a command whose
failure is ignored or skipped keeps every parse green while the gate stops gating - present-but-disabled,
one level up from the shell comment; **(3)** charter-drift check (a') stops using `ci.includes(ref)` and
reads the workflow through the same `parseCiJobs`, so a deleted job no longer matches its own leftover
comment, and the charter map's `axe`/`unit` refs become the blocking job keys that run them (`e2e`,
`test`) rather than job DISPLAY-name text; **(4)** Gate D additionally requires invariants 18 and 19,
both complete at prompt 18 inside Wave D, with activation ownership staying at Gate F - the same
requirement-vs-ownership split already applied to 16 and 11; **(5)** the merged `G/H` registry label is
split into the two gates the ratified wave map declares, Gate G (prompts 27-28; invariants 26, 28, 30)
and Gate H (prompt 29; invariants 27, 29), which moves the registry toward the ratified sequence and so
needs no reading key. ADR-0024's prompt-27 deferral still governs Gate G. All ten gates read non-green.

The captain-approved outcome-completeness review (2026-07-28) amended ADR-0055 in place a fifth time:
**(1)** Gate B gains prompt 11 stable-corpus evidence, Gate F gains prompt 26
verification-reconciler evidence, and Gate H gains seven-minute timing, measured-results, and cold-review
evidence, preserving each declared outcome without narrowing it to the current invariant list; invariant
23's proof point now includes prompt 26 because its subject includes status occurrences; **(2)** every
gate declares structural `entryGates`, the fence ratchets the predecessor chain, and readiness computes
predecessor state, so Gate B cannot report green while Gate A is non-green; **(3)** the complete
requirement ratchet includes every non-invariant requirement's `prompt`; **(4)** CI command evidence now
requires a dedicated simple command whose exit status controls a non-neutralized blocking step, rejecting
echo arguments, short-circuited expressions, heredocs, compound scripts, and `|| true`, with missing and
neutralized commands diagnosed separately; the audit seed and verifier are separate workflow steps;
**(5)** charter rule 9 maps both the blocking `pnpm test:e2e` command and an Axe-specific fence proving
the public, authenticated, and demo E2E specifications execute Axe; **(6)** the gate-ordering proof is
uniquely PF-030, and the Axe proof is PF-031; **(7)** the v3 reading guide now names ADRs 0023-0029 and 0055.
All ten gates remain non-green.

The captain-approved earliest-proof/completeness review (2026-07-28) amended ADR-0055 in place a sixth
time: **(1)** invariants 7, 8, and 9 permanently record prompt 5 as their structural proof point and
become Gate A requirements without moving Gate D activation ownership; Gate D keeps the distinct
evaluator/property-test re-assertion; **(2)** Gate B gains prompt-10 schema-validation and shared-engine
binding evidence for both domain YAML files, so empty or invalid files cannot satisfy the gate by
existence; **(3)** the metadata ratchet now pins every gate's `wave`, `entryGates`, `entryCondition`, and
`outcome`, while the requirement ratchet continues to pin every typed proof prompt; **(4)**
`parseCiJobs` resolves effective workflow, job, and step shells and fails closed on unsupported runners
or custom shell semantics; **(5)** both v3 charter mappings name and ratchet the exact blocking
`pnpm v3:invariants` command; **(6)** the Axe fence accepts only an enabled, reachable test that awaits
analysis and fails on its violations, rejecting skipped, dead, unawaited, unasserted, or unawaited-helper
scans; **(7)** the ADR index's related-governance range now includes ADR-0055. Focused companions and
real injection evidence extend PF-030 and PF-031.

The captain-approved enforcement-completeness review (2026-07-28) amended ADR-0055 in place a seventh
time: **(1)** every declared `activationPrompts` array is validated for active and not-yet-active
invariants, while a fourth ratchet pins invariants 7, 8, and 9 exactly to prompt 5; **(2)** a CI evidence
job with a non-empty `needs` dependency is rejected under the stricter evidence-job contract, because a
skipped dependency can prevent the mapped command from running; **(3)** Axe analysis and assertion move
to the sanctioned `e2e/axe.ts` helper, which the fence pins to a complete WCAG-tagged scan and a direct
assertion over unmodified violations; and **(4)** required Playwright tests must register at module scope
or directly inside an enabled module-scope `test.describe`, then await the helper outside any caught or
dead path. Focused companions and real injections extend PF-030 and PF-031.

The captain-approved false-green boundary review (2026-07-28) amended ADR-0055 in place an eighth time:
**(1)** every enforced charter CI mapping now binds and ratchets its exact command, while the weakest
name-only job query still requires a valid non-neutralized executable step, so malformed, empty,
unsupported-shell, and fully skipped jobs prove nothing; **(2)** required Axe specifications reject
module/file/describe scope skip and fixme annotations plus `test.fail`; **(3)** the sanctioned helper
accepts only the exact non-mutating document-animation settlement before analysis, so a DOM-clearing
`page.evaluate` cannot mask the scan; and **(4)** invariant 3 pins both domain YAML artifacts and the
exact future `domain-configuration` fitness mechanism as activation prerequisites, so an unrelated
naming-only fence cannot produce `active-pass`. Focused companions and real injections extend PF-030
and PF-031.

The captain-approved execution-reachability review (2026-07-28) amended ADR-0055 in place a ninth time:
**(1)** Gate 0's unmechanized surface clause becomes the executable
`demo-surface-completeness` fitness requirement, binding the normative section 4 list to one typed
manifest, all dynamic route cases, component existence, and the canonical ordered screenshots; blocking
E2E reaches every typed demo route after its loaded marker, so Gate 0 now computes green; **(2)** normal
CI evidence requires unfiltered `push` and `pull_request` triggers, repository-root execution after
workflow/job/step working-directory resolution, and direct owned entry points rather than mutable
package-script aliases; **(3)** the Axe fence parses Playwright selection configuration, binds required
public, authenticated, and demo route groups to navigation and loaded-state assertions, and resolves
direct, computed, destructured, and aliased neutralization calls through imported symbols. PF-030,
PF-031, and new PF-032 record focused companions and real injections.

The captain-approved executable-evidence review (2026-07-29) amended ADR-0055 in place a tenth time:
**(1)** Playwright configuration proof rejects multiple `defineConfig` arguments because later values
can override the inspected selection contract; **(2)** required route loops must be direct statements
of an enabled registered test, outside uncalled functions and caught branches; **(3)** optional Axe
assertion messages are structurally side-effect-free; **(4)** computed, destructured, aliased, and
namespace-imported Playwright symbols share one neutralization resolver; and **(5)** Gate 0 accepts only
direct awaited canonical `snap` calls whose helper directly awaits `page.screenshot` into the pinned
`demo-screens` directory and asserts a non-empty capture. PF-031 and PF-032 record the red reproductions,
focused companions, and restored green proofs.

The captain-approved enforcement-integrity review (2026-07-29) amended ADR-0055 in place an eleventh
time: **(1)** the v3 runner exits nonzero when the shared fitness invocation fails or any mapped fitness
file, including a gate-only fence, fails or produces no result; **(2)** charter drift ratchets the
complete set of effective enforced mechanism tuples, including the Axe-specific fitness mechanism and a
mechanism-level status override; **(3)** Playwright configuration proof normalizes direct and computed
literal property names at root and project scope and fails closed on unresolved computed names; and
**(4)** Gate 0 binds each station to the component imported from its manifest path, while every canonical
capture names its station and verifies that station's URL and loaded marker before the screenshot.
PF-001, PF-030, PF-031, and PF-032 record the red reproductions, companions, and restored proofs.

The captain-approved runner-and-alias review (2026-07-29) amended ADR-0055 in place a twelfth time:
**(1)** CI evidence validates the effective `runs-on` value independently of shell selection, so an
explicit `bash` or `sh` cannot make a missing, non-string, dynamic, unsupported, or unschedulable runner
look executable; and **(2)** the Playwright neutralizer resolver follows the latest preceding simple
assignment for named imports, namespace imports, and member aliases, including typed `let`
declarations. PF-030 and PF-031 record the red reproductions, focused companions, and restored green
proofs.

The captain-approved control-flow, artifact, mechanism, and matrix review (2026-07-29) amended
ADR-0055 in place a thirteenth time: **(1)** required Axe route collections reject reassigned aliases,
including assignments hidden in unreachable control flow; **(2)** the shared AST reachability proof
rejects conditional callback exits before required Axe loops and canonical screenshot calls; **(3)**
CI runs a dedicated post-Playwright validator that requires every canonical screenshot artifact to
exist and be non-empty, while upload-artifact fails when the directory is missing; **(4)** every
shipped active invariant ratchets its complete mechanism tuple set, so status cannot remain active
after proof is redirected to an unrelated fence; and **(5)** evidence jobs using `strategy.matrix`
are non-evidence until complete matrix reachability semantics exist. PF-024, PF-030, PF-031, and
PF-032 record the red reproductions, focused companions, and restored green proofs.

The captain-approved route-and-capture-integrity review (2026-07-29) amended ADR-0055 in place a
fourteenth time: **(1)** the dynamic demo page binds its resolved station to both the loaded marker and
the validated `renderStation` invocation, so a complete switch cannot hide a constant caller;
**(2)** Playwright neutralizer analysis considers every preceding assignment source and fails closed
when unreachable control flow overwrites an alias that previously named `test.skip`, `test.fixme`, or
`test.fail`; **(3)** required Axe route collections and their entries are frozen at runtime, while the
structural fence rejects direct reassignment, descendant mutation, and array-mutator calls before a
required loop; and **(4)** the launcher capture proves its canonical URL and loaded marker before an
awaited `page.screenshot` to `00-launcher.png`, with the same non-empty assertion as every station
capture. PF-031 and PF-032 record the red reproductions, companions, and restored proofs.

The captain-approved active-ratchet, TestInfo, wrapper, and ratified-surface review (2026-07-29)
amended ADR-0055 in place a fifteenth time: **(1)** active invariant IDs must exactly equal the shipped
mechanism-ratchet keys, so a newly active invariant cannot point at an unreviewed passing fence;
**(2)** required Axe tests and directly registered hooks reject `testInfo.skip`, `testInfo.fixme`, and
`testInfo.fail`, including member aliases; **(3)** Playwright symbol resolution normalizes parentheses
and TypeScript assertion wrappers before recognizing neutralizers; and **(4)** Gate 0 ratchets the
mutable contract and typed manifest to the exact twelve surface identities from the SHA-pinned ratified
demo contract. PF-024, PF-031, and PF-032 record the red reproductions, companions, and restored proofs.

The captain-approved reachability and delivery review (2026-07-29) amended ADR-0055 in place a
sixteenth time: **(1)** required tests and directly registered hooks reject TestInfo skip, fixme, and
fail neutralizers obtained from `test.info()` as well as callback parameters, including aliases and
destructuring; **(2)** the dynamic demo page's validated return must be provably reachable, so a nested
or conditional exit cannot hide a constant surface; **(3)** the canonical Gate 0 journey must click the
complete ordered accessible-control graph and cannot substitute `page.goto`; and **(4)** the
`demo-screens` upload rejects false conditions and `continue-on-error` while allowing the current
`!cancelled()` predicate. PF-031 and PF-032 record the red reproductions, companions, and restored proofs.

The captain-approved callable-provenance and Gate 0 route-graph review (2026-07-29) amended ADR-0055
in place a seventeenth time: **(1)** positive Axe-helper aliases must have stable imported provenance,
so an unreachable reassignment cannot make a runtime no-op count as the sanctioned scan; **(2)** bound
Playwright neutralizers and transitively invoked local neutralizer helpers are resolved, while unresolved
local callable indirection fails closed; **(3)** the dynamic demo page passes its exact resolved scenario
and firm identifiers to `getJourney`, with every supported scenario-by-firm outcome checked exhaustively;
and **(4)** the canonical clickable journey admits only the complete ordered product-control graph,
read-only loaded-state assertions, and sanctioned helpers, so DOM mutation, injected controls, and
alternate navigation are non-evidence. PF-031 and PF-032 record the red reproductions, companions, and
restored proofs.

The captain-approved callback, assertion, renderer-ID, and runner-ratchet review (2026-07-29) amended
ADR-0055 in place an eighteenth time: **(1)** Axe neutralizer analysis traverses callback arguments
executed by calls such as `test.step`, so a nested TestInfo skip cannot hide outside the callback's
direct call ownership; **(2)** the sanctioned helper accepts only a stable, unreassigned Playwright
`expect` import; **(3)** the dynamic route structurally binds both renderer ID fields to the resolved
query or returned journey identifiers; and **(4)** the complete active-ID and mechanism-tuple ratchet
moves into the shared gate library and is invoked by both the registry fence and the blocking
`v3:invariants` runner. Prompt 10's activation procedure now requires adding invariant 3's complete
mechanism tuple to that shared ratchet in the same PR. PF-024, PF-031, and PF-032 record the red
reproductions, companions, and restored proofs.

The captain-approved indirect-call, page-integrity, hook-isolation, and approval-binding review
(2026-07-29) amended ADR-0055 in place a nineteenth time: **(1)** Playwright neutralizer provenance
resolves invocations through `Function.call` and `Function.apply` as well as `bind`; **(2)** required Axe
route callbacks admit only their typed loops and a stable canonical login call, whose helper is pinned
to the uninstrumented browser flow, and required specifications may register no Playwright hooks;
**(3)** the canonical Gate 0 journey rejects registered Playwright hooks that could inject controls or
replace screenshot evidence; and **(4)** the renderer's approval input is bound to the exact
`first(sp.approved) === "1"` query-derived declaration. PF-031 and PF-032 record the red reproductions,
focused companions, and restored proofs.

The captain-approved shared-ratchet, reflective-call, Vitest-registration, and route-inventory review
(2026-07-29) amended ADR-0055 in place a twentieth time: **(1)** all five exact gate ratchets and the
ratified prompt ranges move into `scripts/v3-gates.lib.ts`, where the blocking runner and fitness fence
invoke one constitution validator; each runner result has an immediate fail guard before reporting;
**(2)** Playwright neutralizers and registered hooks invoked through direct or aliased `Reflect.apply`
are resolved through shared callable-indirection analysis; **(3)** charter-drift replaces its disabled
fence regex with symbol-aware Vitest registration analysis covering computed members, namespace imports,
imported and assigned aliases, and x-prefixed registrations; and **(4)** the Axe fence derives the
complete Next `page.tsx` inventory and requires every static and dynamic route to have an exact loaded-state
scan owner. PF-001, PF-024, PF-030, PF-031, and PF-032 record the adversarial companions and restored
green proofs.

The captain-approved fitness-inventory and execution-provenance review (2026-07-29) amended ADR-0055
in place a twenty-first time: **(1)** the blocking test job invokes a direct fitness-inventory runner
that enumerates every fitness file and fails if Vitest configuration omits any per-file result;
**(2)** charter-drift resolves `todo`, `fails`, `skipIf`, and `runIf` through computed and aliased
Vitest chains, failing closed on unknown conditions; **(3)** the v3 companion executes the real runner
against injected ratchet drift and requires exit 1; **(4)** the Axe helper rejects module-scope runtime
replacement, while required specifications cannot import the Axe runtime directly; **(5)** callable
indirection composes nested `Reflect.apply`, `call`, and `apply` forms for Playwright neutralizers and
hooks; and **(6)** Gate 0 requires stable unreassigned screenshot helpers and identity preservation for
every supported URL scenario and firm resolver. PF-001, PF-024, PF-031, and PF-032 record the red
reproductions, continuous companions, and restored green proofs.

The captain-approved recursive-inventory and bound-reflection review (2026-07-29) amended ADR-0055
in place a twenty-second time: **(1)** one shared recursive fitness inventory now drives the blocking
runner, charter-drift disabled and orphan analysis, and the detection-not-verification meta-fence, so
a nested subtree cannot escape execution or governance; and **(2)** shared reflective-call resolution
follows direct and aliased `Reflect.apply.bind(...)` values, including bound callables invoked through
`call` or `apply`, for both Axe neutralizers and Gate 0 hook registration. The three unchanged,
AST-intensive enforcement checks that exceeded the global 20-second per-test limit under full-suite worker
contention have explicit 60-second budgets; no assertion was removed. PF-001, PF-031, and PF-032 record
the real red reproductions, focused companions, and restored green proofs.

The captain-approved gate-local evaluator proof and single-run fitness review (2026-07-29) amended
ADR-0055 in place a twenty-third time: **(1)** Gate D carries a ratcheted prompt-17 evaluator
property-test evidence requirement for invariants 7, 8, and 9, separate from the prompt-5 structural
mechanism that supplies their global `active-pass` state; **(2)** the v3 runner rejects a nonzero mapped
fitness invocation immediately after report parsing and before emitting any invariant or gate state; and
**(3)** the blocking test job enters Vitest once through the complete fitness-inventory runner, which runs
the full unit, integration, and fitness suite while recursively requiring one passing result from every
fitness file. PF-001, PF-024, and PF-030 record the reproductions, companions, and restored proofs.

The captain-approved cross-gate proof and imported Axe-graph review (2026-07-29) amended ADR-0055 in
place a twenty-fourth time: **(1)** the proof-point ratchet derives every invariant referenced across
gate ownership and pins the complete set - invariant 1 at prompt 6, invariants 7-9 at prompt 5, invariant
11 at prompt 15, invariant 16 at prompt 9, and invariants 18-19 at prompt 18 - so matching prose cannot
fabricate an earlier proof while the general ordering rule remains green; and **(2)** the Axe fence
follows the complete runtime local import graph of required specifications and sanctioned helpers
through side-effect imports, re-exports, configured TypeScript aliases, literal dynamic imports, and
CommonJS imports. Every reachable local module rejects Playwright hook registration and Axe runtime
access outside `e2e/axe.ts`; unresolved, unclassified, and non-literal runtime imports are non-evidence. PF-030 and
PF-031 record the reproductions, companions, and restored proofs.

The captain-approved complete fitness, CommonJS, graph-root, and Vitest-global review (2026-07-29)
amended ADR-0055 in place a twenty-fifth time: **(1)** the recursive fitness inventory and Vitest config
consume one shared matcher that admits `.test.ts`, `.test.tsx`, `.spec.ts`, and `.spec.tsx`; **(2)**
indirect CommonJS loader provenance, including aliases of `require` and ambient `module.require` member
forms, fails closed in the Axe evidence graph; **(3)** Axe-runtime and Playwright-hook prohibitions apply
to every named graph root and transitive local module, with only the exact Axe import in `e2e/axe.ts`
allowed; and **(4)** charter-drift resolves disabled registrations through imported `suite` and the
unshadowed `describe`, `suite`, `test`, and `it` globals enabled by Vitest while preserving locally
shadowed application callables. PF-001 and PF-031 record the real red reproductions, non-vacuous
companions, and restored proofs.

The captain-approved registration-option, declarative-route, and precedence review (2026-07-29)
amended ADR-0055 in place a twenty-sixth time: **(1)** charter-drift rejects `skip`, `only`, `todo`, and
`fails` in Vitest registration option objects, including unresolved values, computed keys, spreads, and
aliases; **(2)** unshadowed `globalThis` Vitest member paths are registration authorities while local
shadows remain application code; **(3)** unresolved computed member access on ambient `module` is
non-evidence for CommonJS loading; **(4)** Playwright hook provenance follows callable values stored in
object properties; **(5)** Axe route collections are non-empty declarative frozen literals whose runtime
contents cannot vary by process; and **(6)** concrete Axe URLs are assigned through Next route precedence,
so a static page cannot falsely cover an overlapping dynamic page. PF-001, PF-002, and PF-031 record the
real red reproductions, companions, and restored proofs.

The captain-approved callable-member, helper-syntax, and parameterized-registration review (2026-07-29)
amended ADR-0055 in place a twenty-seventh time: **(1)** Playwright hook provenance follows member
assignments and direct or aliased `Object.assign` mutations through object aliases; **(2)** the
sanctioned Axe helper requires exactly two plain parameters and exactly the side-effect-free `{ page }`
builder configuration; **(3)** Node `global` is treated as the same unshadowed Vitest authority as
`globalThis`; and **(4)** `.each` and `.for` registrations require statically non-empty case
collections, including tagged tables, while empty, spread-derived, and unresolved collections are
non-evidence. PF-001 and PF-031 record the real red injections, focused companions, and restored green
proofs.

The captain-approved reachability, reflective-write, screenshot, and CI-environment review (2026-07-29)
amended ADR-0055 in place a twenty-eighth time: **(1)** fitness registrations must be direct reachable
module-scope statements or direct statements inside an enabled reachable module-scope suite callback,
so dead control flow and uncalled registration helpers cannot preserve a false-green file; **(2)**
Playwright hook provenance follows `Object.defineProperty` and `Reflect.set` through aliases and
`bind` / `call` / `apply` wrappers, while unresolved reflective property writes fail closed; **(3)**
canonical screenshot options contain exactly the sanctioned `path` and `fullPage: true` fields, so
content masking is non-evidence; and **(4)** governed CI commands reject non-literal inherited
environment maps and execution-affecting workflow, job, or step overrides. PF-001, PF-030, PF-031, and
PF-032 record the real red injections, focused companions, and restored green proofs.

The captain-approved registration-input, computed-member, login, builtin-loader, and
container-environment review (2026-07-29) amended ADR-0055 in place a twenty-ninth time: **(1)** Vitest
registration options and parameterized case collections must be immediate literal or direct frozen
inputs, so member assignments and array mutators cannot invalidate initializer-only evidence; **(2)**
Playwright member access resolves static concatenation and stable literal aliases, while unresolved
computed members rooted at the imported API are non-evidence; **(3)** the canonical login helper has
exactly two plain required parameters and authenticated scan sites pass `PRINCIPAL` explicitly; **(4)**
ambient `process.getBuiltinModule("module")` construction is rejected throughout the required Axe
runtime graph, including stable aliases; and **(5)** CI execution-environment validation includes
`job.container.env` between job and step scope. PF-001, PF-030, and PF-031 record the real red
injections, focused companions, and restored green proofs.

The captain-approved CI provenance, imported-registration, query-helper, and shared-hook review
(2026-07-29) amended ADR-0055 in place a thirtieth time: **(1)** governed CI commands accept only an
exact ratcheted predecessor chain, so unreviewed actions, commands, inputs, fields, or environment
settings cannot mutate command resolution, workflow environment files, repository files, or governed
entry points before evidence runs; **(2)** governed container images are exact ratcheted literals and
additional execution-shaping container fields are non-evidence; **(3)** Playwright `skip`, `fixme`, and
`fail` neutralizers are rejected across the complete reachable Axe runtime graph; **(4)** every fitness
entry's complete local runtime import graph is inspected, and imported helpers may neither import Vitest
nor register tests or suites; **(5)** Gate 0 pins its `first` query helper to the identity-preserving
single-value semantics used by every resolver; and **(6)** Gate 0 and Axe evidence share one hardened
Playwright hook-provenance authority. PF-001, PF-030, PF-031, and PF-032 record the real red injections,
focused companions, and restored green proofs.

The captain-approved identity, reflection, and result-ownership review (2026-08-05) amended ADR-0039
in place a thirty-first time: **(1)** the Gate A decision entry is D-186, leaving the existing prompt-6
security decision as the sole D-061; only Gate A proof references moved; **(2)** Vitest registration
analysis resolves the invoked target of `Reflect.apply`; **(3)** one shared callable-indirection helper
supplies static `Reflect.get` provenance to Vitest and Playwright analyzers, with unresolved Playwright
keys failing closed for neutralizers and hooks; and **(4)** the complete-suite and v3 runners
canonicalize result names to exact repository-relative paths and reject duplicate exact results, so a
passing suffix-matching shadow file cannot satisfy an omitted fence. PF-001, PF-024, and PF-031 record
the red reproductions, focused companions, and restored green proofs.

The captain-approved composite-callable and executable-workflow review (2026-08-05) amended ADR-0039
in place a thirty-second time: **(1)** Vitest and Playwright provenance resolves conditional, logical,
and sequence callable expressions; **(2)** shared `Reflect.apply` and `Reflect.get` resolution considers
every initializer and preceding assignment source, and incomplete resolution is non-evidence; and
**(3)** CI command evidence first validates the workflow's complete local, reusable, run-step, and
uses-step forms, so a GitHub-invalid `run` / `uses` / `with` combination invalidates the workflow rather
than proving a command that cannot execute. The assignment index and Reflect-free source fast path keep
the charter audit bounded while preserving exact path ownership. PF-001, PF-030, and PF-031 record the
real red reproductions, focused companions, and restored green proofs. Gate A and Gate B requirements,
ownership, proof points, and readiness semantics are unchanged.

The captain-approved intrinsic-alias, higher-order, and workflow-schema review (2026-08-05) amended
ADR-0039 in place a thirty-third time: **(1)** shared callable provenance resolves stable global
`Reflect` and `Object` aliases plus statically computed intrinsic and member names; **(2)** locally
invoked callable parameters inherit every caller-supplied value, so a higher-order helper cannot hide a
Vitest registration, Playwright neutralizer, or Playwright hook; **(3)** `Object.assign` mutation through
an intrinsic alias remains visible to hook provenance; and **(4)** the structured CI authority validates
supported workflow, job, container, and step field value schemas across the complete workflow before
accepting command evidence. A per-source invocation index and parameter-path cache preserve the bounded
charter audit. PF-001, PF-030, and PF-031 record focused companions, real red injections, and restored
green proofs. Gate A and Gate B requirements, ownership, proof points, and readiness semantics are
unchanged.

The captain-approved cross-module, CI-grammar, and route-binding review (2026-08-05) amended ADR-0039
in place a thirty-fourth time: **(1)** higher-order callable provenance follows caller arguments through
reachable imports and re-exports, so an imported helper cannot hide a Vitest registration, Playwright
neutralizer, or Playwright hook; **(2)** stable object-property sources for global `Reflect` and `Object`
aliases are resolved, while incomplete computed property provenance fails closed; **(3)** GitHub
permission scope keys, job identifier grammar, and positive-integer or explicit-expression timeout
forms are validated before any workflow command becomes evidence; and **(4)** every Gate 0 renderer arm
is bound to its exact journey view model, resolved identifier spread, and query-derived approval input.
PF-001, PF-030, PF-031, and PF-032 record focused companions, real red injections, and restored green
proofs. Gate A and Gate B requirements, ownership, proof points, and readiness semantics are unchanged.

The captain-approved trigger, constructor, and descriptor-provenance review (2026-08-05) amended
ADR-0039 in place a thirty-fifth time: **(1)** the blocking workflow accepts only the complete normal
`push` and `pull_request` trigger set, rejecting extra, non-string, duplicate, filtered, or unsupported
events before command evidence is considered; **(2)** constructor calls and parameters participate in
the shared callable invocation index; **(3)** incomplete callable-parameter provenance is unsafe even
when no known path was recovered; **(4)** destructured intrinsic aliases resolve through stable holder
properties; and **(5)** Object and Reflect descriptor reads retain the receiver and member provenance
of callable values. PF-001, PF-030, and PF-031 record the focused companions, real red injections, and
restored green proofs. Gate A and Gate B requirements, ownership, proof points, and readiness semantics
are unchanged.

**Why:** a gate that can only be passed by lying about activation is the exact fake-green failure v3 §17
and charter #5 forbid; moving the requirement to the gate that covers its prerequisite removes the cycle
without weakening the invariant or re-ordering the build against its own dependencies.
**Revert path:** none while invariant 3's prerequisite remains prompt 10. Changing any gate's `requires`
list - of any requirement kind, including deleting an `evidence` clause - its `wave`, `entryGates`,
`entryCondition`, `outcome`, or any
invariant's `gate`, is an amendment to ADR-0055, ADR-0023, and all five ratchets in
`scripts/v3-gates.lib.ts`, never a registry edit alone.

### D-099 · 2026-08-05 · reversible · CI triggers and callable provenance fail closed across construction and descriptors

Five review findings were legitimate symptoms of two shared ownership gaps. The structured CI authority
validated jobs and steps but accepted partially valid trigger declarations, while callable provenance
modeled ordinary calls and direct property reads without covering construction, empty incomplete
parameter flow, destructured intrinsic holders, or property descriptors.

The CI trigger boundary now admits only complete unfiltered `push` and `pull_request` declarations in
mapping or array form. The shared callable invocation index includes `new` expressions and constructor
parameters, parameter analysis emits an unsafe root whenever provenance is incomplete, destructured
intrinsics inherit stable object-property provenance, and Object or Reflect descriptor reads retain the
original receiver and member. Vitest disabled-registration and Playwright hook analysis consume the same
shared result.

**Alternatives rejected:** validate only the two required events while ignoring extras (GitHub can reject
the whole workflow); special-case class names in each consumer (the next constructor form would drift);
and add descriptor syntax separately to Vitest and Playwright (two security authorities would diverge).

**Revert path:** revert this changeset to restore partial trigger acceptance and call-only callable
provenance. Gate A and Gate B semantics remain unchanged.
