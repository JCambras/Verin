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

### D-039 · 2026-07-26 · reversible · Security boundaries landed (v3 build sequence, prompt 6): sealed TenantContext, governed-action authz, Tokenized factory + llm/ boundary, secret containment
**What:** Implemented v3 §15 as structural seams over the existing substrate (marriage-map §6: EXTEND the
org-id fence / PII scrub / RBAC / no-secret-fallback, displace nothing).
**Rebase note:** This decision was D-036 on the topic branch. Prompt-6 implementation references to
D-036 refer to this entry; origin/main had already assigned D-036 through D-038.
- **TenantContext** (`contracts/tenant.ts`): compile-time unique-symbol brand + runtime module-private
  seal; minted ONLY by `tenantOf(principal)` / `systemTenant(systemId, orgId)`. Every repository and port
  call requires it (writes carry it inside `WriteActor`); capability-keyed loads (session id, e-sign
  token, resume token) and the identity-provider internals are exact-match reviewed escapes, mirroring the
  org-id fence's NON_TENANT classification. Missing context cannot compile (TS2741) or parse (repository
  asserts reject casts/spreads/JSON impostors with `INTERNAL`). Fence: `tenant-context-required` (PF-027).
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
  allowlists are the role-level floor, not the authority machinery). Fence: `governed-actions` (PF-030).
- **Tokenized + llm/ boundary**: `Tokenized<T>` lands with the ratified shape (verin-core-contracts.ts)
  and is constructible only via the scrubber factory `infrastructure/pii/tokenize.ts` (runtime-sealed,
  scrub-by-construction); `infrastructure/llm/` holds the ONLY LLM-bound shapes (masked request schema +
  evidence-to-LLM projection with deterministic known-entity masking) and no model client (first LLM
  surface = prompt 13; charter #5's no-dead-scaffolding is honored by keeping the boundary to the seam the
  ratified invariant 1 requires — v3 invariant 1 is ACTIVATED by this PR, per its registry activation
  clause). Fences: `tokenized-factory-only` (PF-028) + `llm-pii-boundary` (PF-029) + an ESLint edit-time
  mirror.
- **Secret containment** (`contracts/secret.ts`): config secrets become closure-held `SecretValue`s
  (every coercion path redacts; `.reveal()` allowlisted to the two HMAC consumers — PF-031). Span
  attributes and span error messages are PII-scrubbed at the trace boundary (values by pattern, keys by
  the same field-name rule as the log scrubber); pino redact list extended to account/routing numbers;
  `safeReason` is the sanctioned exception-text log helper (a free-form deep-scrub helper lands with its
  first real consumer at the prompt-13 LLM logging surface, per charter #5).
- **ADR-0029**: line-budget amendment (contracts 600→1000, infrastructure 2500→3000) — the sanctioned
  ADR path for growth scheduled by the ratified sequence; ratchet-down at wave gates unchanged.
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
not-yet-active and drop invariant 2's added mechanism; restore ADR-0018 ceilings (delete ADR-0029);
remove PF-027..PF-031 and this entry.

### D-040 · 2026-07-26 · reversible · Prompt-6 security boundaries hardened after adversarial review

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
- PF-027 through PF-031 now use semantic type/call resolution where syntax-only
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
has not shipped to a persistent store, and restore the prior PF-027 through
PF-031 implementations. D-039 remains the underlying prompt-6 decision.

### D-041 · 2026-07-26 · reversible · Prompt-6 authority, token immutability, and semantic boundary fences hardened

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
code pattern, and PF-027 through PF-029 implementations. D-039 and D-040 remain
the underlying prompt-6 decisions.

### D-042 · 2026-07-27 · reversible · Prompt-6 execution proof, write attribution, workflow PII, and declaration-form fences hardened

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
prior declaration-form-specific PF-027/PF-029 implementations. D-039 through
D-041 remain the underlying security-boundary decisions.

### D-043 · 2026-07-27 · reversible · Prompt-6 recovery and completeness fences hardened

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
surface table, and file-level reveal allowlist. D-039 through D-042 remain the
underlying security-boundary decisions.
