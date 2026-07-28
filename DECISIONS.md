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

### D-102 · 2026-07-28 · captain-decision · Signed money truth, complete evidence, and canonical status planes stay aligned

The signed Smiths request remains $75,000 with planned withdrawals of $8,000 per month. Firm A's
six-month reserve floor is $48,000 and Firm B's twelve-month floor is $96,000. The demo derives both
floors through the shared money-movement arithmetic instead of carrying a second floor constant.

Every signed golden case now includes an evidence-completeness matrix. Each fact required to compute
or validate the expected outcome identifies present evidence or an explicit observed absence. A
proceed result cannot infer missing evidence is benign. All trigger and evidence instants use the
canonical UTC form required by `TimestampSchema`.

`completed` is the only canonical external status for proven downstream success; presentation may
label that sourced result "Settled · verified." `rejected` remains an external observed outcome,
`stuck` is a verification projection, and duplicate suppression is an execution receipt. GC-16
records `ApprovalStageEscalated` at P1D followed by `ApprovalStageExpired` at the projected deadline.
It does not invalidate a nonexistent approval or derive a new decision solely from lapse.

The browser reproduction showed the default workspace at $6,000 per month and the comparison at
$36,000/$72,000 reserve floors, while `pnpm golden:validate` passed the signed
$8,000/$48,000/$96,000 fixtures. History identified a later walking-skeleton placeholder as the
trigger and a structure-only validator as the masking condition. The counterfactual that changed
only the monthly input to $8,000 restored both floors.

**Why:** displayed arithmetic, signed fixtures, demo configuration, event vocabulary, evidence
completeness, and execution status must express one product truth before additional decision
machinery is built.
**Revert path:** none without a new captain decision re-signing the golden truth and its semantic
contract.

### D-103 · 2026-07-28 · reversible · Signed money is structured data; the ledger extension is an ADR, not a comment

Review of D-102 found four defects in how the signed truth was fenced rather than in the truth
itself. All four are fixed forward:

- **The semantic validator crashed instead of reporting.** A fixture missing (or fractionally
  stating) `firmConfiguration.cashReserveMonths` reached the throwing shared arithmetic, so
  `pnpm golden:validate` died on a `RangeError` and discarded every diagnostic it had already
  computed. `@contracts/money-movement` now exports `isMoneyQuantity` - the SAME predicate the
  authority throws on - and every caller validating untrusted fixture input guards with it, so a
  guard cannot drift from the throw conditions.
- **The money-unit half of the cross-artifact fence was tautological.** The snapshot asserted its own
  `"currency-minor"`/`100` literals. `formatMetricValue` now renders through the single money
  authority, and the snapshot projects the units the demo ACTUALLY carries: the formats of the
  emitted money metrics, and the divisor recovered by inverting the shipped renderer on those
  metrics. A divisor changed anywhere on the display path now fails the gate.
- **Surface 11 kept a second money path.** `buildPolicyAuthoring` re-derived the monthly withdrawal
  by inverting the reserve floor it had just computed (`12 * floor / months`, undefined at a
  zero horizon). It now calls the shared arithmetic directly, and the snapshot projects the
  DISPLAYED simulated floor so the $96,000 on that surface is fenced to the signed twelve-month
  horizon.
- **Signed numbers were regexed out of signed prose.** Every case now carries a structured
  `signedMoney` block (currency, cadence, request amount, monthly schedule, reserve floor). The
  fence reads the structure; the validator separately requires the prose to still state each figure,
  so a captain rewording a summary moves neither product truth nor the gate, and all sixteen cases'
  amounts are fenced instead of two.

**Why:** a fence that crashes, asserts its own constant, or depends on prose wording does not
enforce the invariant it names (charter #4).
**Revert path:** the structured block is additive to the fixtures and the validator reads it through
one helper; removing the block and restoring prose parsing is a single-file change.
**See also:** [ADR-0039](docs/adr/0039-authority-lapse-ledger-events.md) records the
`ApprovalStageEscalated`/`ApprovalStageExpired` extension of the ratified `LedgerEntry` union that
D-102 signed into GC-16, with the prompt-7 collapse trigger and a fence against the pinned reference
- previously carried only as a code comment.

### D-063 · 2026-07-28 · reversible · Demo liquidity is per-branch signed evidence, not a global assumption

Review of D-062 found the demo still carrying two global constants — `AVAILABLE_CASH_MINOR`
($200,000) and `PENDING_DISTRIBUTION_MINOR` ($40,000) — applied to every scenario branch under both
firms. With the signed schedule corrected to $8,000/month, Firm B's twelve-month floor rose to
$96,000 and the happy path began contradicting itself on screen: `Amount $75,000.00` printed beside
`Available after reserve $64,000.00`, under a `proceed` badge and the sentence "available liquidity
covers the amount". Surface 11's Firm A simulation drifted the same way. The globals were also
unsigned: GC-01 and GC-02 state $420,000 of available taxable liquidity and positively observe NO
pending activity, so the demo was inventing both figures.

The globals are gone. Each branch now carries firm-specific signed-liquidity authority naming the
golden case it mirrors (`sourceCaseId`, initial-decision liquidity, and optional pre-execution
revalidation liquidity). Every visible liquidity figure, headroom, blocker, policy-trace row,
comparison column, and simulation delta derives from it through the shared arithmetic
(`headroomMinor` in `@contracts/money-movement`). The happy paths run on GC-01/GC-02's $420,000 with
no pending activity; approval-invalidation starts at GC-15's $300,000 with no pending activity and
adds the new $15,000 distribution only at pre-execution revalidation; competing-liquidity keeps
GC-10's constrained $160,000 pool for Firm A, which is what makes two $75,000 requests jointly
invalid.

That constrained pool forced one contract question. Under Firm A's $48,000 six-month reserve the
first request is individually valid and proceeds (GC-10, signed). The matrix records Firm B as
blocked by its twelve-month reserve before a live reservation matters, but there is no
branch-and-firm signed numeric case for that rendered arm. The demo therefore surfaces missing
numeric authority instead of borrowing GC-05. GC-05 remains the separate signed single-request
case: $160,000 available minus $20,000 pending equals $140,000 effective liquidity; after the
$75,000 request, $65,000 remains, below Firm B's $96,000 reserve.

Two fences make the class of defect unrepeatable rather than the instance:

- **Signed side.** A `proceed` golden case must state complete structured numeric authority and
  leave its request covered: available minus pending minus reserve floor must be at least the
  request amount. Available liquidity and pending activity are structured
  `signedMoney` fields tied to the evidence rows that observed them (`observedAbsent: true` requires
  `pendingLiquidityUsd: 0`; stating liquidity without stating the pending activity beside it is
  rejected). Missing authority fails by field name instead of skipping the arithmetic. A structured
  revalidation snapshot must independently match phase-tagged evidence and cover the request.
- **Rendered side.** The snapshot projects EVERY decision the demo displays. A displayed headroom
  that is not `available - pending - floor`, liquidity sourced from a case whose `scenarioRef` or
  firm does not match the rendered branch, or a `proceed` beside contradictory headroom fails with
  the branch and firm named. A branch with no exact signed numeric case must display the gap and
  render no borrowed figures.

**Why:** the demo's own figures are product truth in front of an investor; a `proceed` beside a
number that contradicts it is the exact dishonesty the charter's provenance rules exist to prevent.
**Revert path:** the branch liquidity is inert data on `ScenarioData` read through one accessor;
restoring a single global is a one-line change plus deleting the two fence halves.

### D-064 · 2026-07-28 · reversible · Rendered money is inverted with integer arithmetic; the status vocabulary is one document set

Two smaller review findings from the same pass:

- **The renderer inversion produced false failures.** Recovering the divisor by floating-point
  division (`minor / major`) and comparing with `!==` meant any value that is not a whole number of
  dollars failed the build — `7_500_010 / 75000.1` is `99.99999999999999` — and the digit-stripping
  regex dropped the minus sign, so a negative headroom (reachable now that liquidity is per-branch)
  failed too. The fence now decomposes the rendered string into an exact decimal and compares
  `minor × 10^scale === majorUnits × MINOR_UNITS_PER_MAJOR`: whole dollars, fractional cents, and
  negatives all pass or fail on their own merits, sub-cent precision is reported rather than rounded
  into agreement, and a changed divisor still cannot pass.
- **The normative contract had not been amended.** `scenarios.yaml` cited a captain annotation for
  canonical status planes that `docs/demo-contract.md` did not carry, while the design language had
  already been amended to say there is no canonical `settled` state. `demo-contract.md` now carries
  annotation 3 (captain, 2026-07-28) stating the three planes by name — six observed statuses,
  `stuck` as a verification projection, `duplicate-suppressed` as an execution receipt — and the
  acceptance checklist restates the honesty rule status-neutrally: submitted is not final execution
  completion. A new fence half reads all three normative documents and fails if any drops a status,
  names a plane member without saying which plane it belongs to, or reinstates a canonical `settled`.

**Why:** a fence that fires on correct input trains people to ignore it, and a normative document
that cites an annotation it does not contain is not normative.
**Revert path:** both are pure functions in `scripts/golden-demo-semantics.lib.ts` with injected
inputs; deleting either leaves the rest of the gate intact.

### D-065 · 2026-07-28 · reversible · Liquidity authority is firm-bound and phase-aware

Review of D-063 found two ownership defects in the single branch-level liquidity record. First,
GC-15's after-approval pending distribution was rendered as if it existed at initial evaluation.
Second, the same `sourceCaseId` was reused across both firms and across branches that had no matching
signed numeric case.

`ScenarioData` now carries signed liquidity by firm. Each source case is accepted only when the
fixture's own `scenarioRef` and `firm` match the rendered branch. Missing pairs render an explicit
authority gap and do not emit headroom or policy-simulation figures. GC-15 carries an
`initialDecision` snapshot with $300,000 available and no pending activity plus a
`preExecutionRevalidation` snapshot with the new $15,000 pending distribution. The invalidation
surface and printed record show those phases in order.

GC-16 authority events are also rendered as ordered data. `ApprovalStageEscalated` at P1D precedes
`ApprovalStageExpired` at the projected deadline, and the dual-approval stage remains pending
because it never arms.

**Why:** evidence ownership includes branch, firm, and time. A numerically correct value is still
false when borrowed from another decision context or shown before it existed.
**Revert path:** the authority union and its accessor are confined to the demo fake-service
layer; removing phase or firm binding requires reverting the companion semantic and browser proofs.

### D-066 · 2026-07-28 · reversible · Signed demo authority is exact, paired, and chronological

The demo projects each source-bound request instant from its captain-signed fixture and derives
every later visible instant through one stable case-relative timeline. The semantic snapshot
requires the projection to remain byte-equal to the fixture trigger, every event to remain at or
after that request, every display to contain its rendered instant, and the ordered sequence to
remain monotonic in the demo zone, UTC, and a second representative zone.

A source case is eligible only when its signoff, scenario, firm, disposition, request, currency,
cadence, liquidity, and reserve policy exactly match the rendered decision. An exact candidate
cannot be hidden behind a missing-authority message. The competing-liquidity branch projects both
GC-10 and GC-11, so the first request's proceed result and the sibling's reservation-blocked result
have separate signed ownership. Evidence completeness now requires the decisive source facts for
blocked and prohibited cases as well as the full input set for proceed cases.

The stable state registry is also enforced as an ordered prefix, not merely a set. Existing IDs
cannot be reordered while preserving membership, and new IDs append after the previously shipped
sequence.

**Why:** signed truth includes ownership, causal order, and the decisive evidence for every
disposition. Set equality and unconstrained pointers allowed semantically impossible displays to
pass while all individual artifacts remained internally valid.
**Revert path:** the fixture-backed trigger map, timeline projector, exact-source index,
case-specific evidence requirements, and ordered-prefix check are independent pure boundaries and
can be reverted together with their companion mutations.

### D-067 · 2026-07-28 · reversible · Execution reach requires signed liquidity and satisfied ordered authority

Demo reachability now fails closed from structured evidence and authority state. A proceed
disposition reaches Safety only after every ordered authority stage satisfies its eligible-role,
quorum, distinct-actor, and requester constraints. Execution and Verification additionally require
exact signed liquidity authority for the rendered scenario and firm. Missing authority displays the
gap without reservation or idempotency identifiers.

Approval invalidation is represented as two explicit passes. GC-15 records both original approvals,
invalidates both after the revalidation snapshot, derives a new decision and bundle, records two
fresh approvals, then reaches reservation, execution, and submitted verification. The printable
record projects the signed ledger sequence. GC-13 projects the exact partial receipt without
promoting either the incomplete part or the overall unknown movement to settled. Policy simulation
uses the latest applicable liquidity snapshot.

**Why:** disposition, authority, and execution eligibility are separate planes. Inferring all three
from `proceed` allowed unsupported branches and incomplete authority stages to look executable.
**Revert path:** journey pass selection, structured approval stages, and downstream reach guards are
confined to the demo fake-service and semantic snapshot.
