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
- **ADR-0029** (`docs/adr/0029-line-budget-wave-a-security-boundaries.md`): line-budget amendment
  (contracts 600→1000, infrastructure 2500→3000 against the pre-decision-core base) — the sanctioned
  ADR path for growth scheduled by the ratified sequence; ratchet-down at wave gates unchanged.
  Composed on rebase with main's decision-core raise (3500), the shipped contracts ceiling is 4000.
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

### D-044 · 2026-07-27 · reversible · Prompt-6 trusted-set, sink-authority, and compiler-resolution boundaries hardened

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
LLM path resolution, and direct-symbol-only privileged access checks. D-039
through D-043 remain the underlying prompt-6 decisions.

### D-045 · 2026-07-27 · reversible · Prompt-6 completeness proofs and governed repository entry guards hardened

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
and signature-only tenant fence. D-039 through D-044 remain the underlying
prompt-6 security decisions.

### D-046 · 2026-07-27 · reversible · Prompt-6 resolver, observability, and callable-boundary proofs hardened

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
D-039 through D-045 remain the underlying prompt-6 security decisions.

### D-047 · 2026-07-27 · reversible · Prompt-6 typed evidence, observability identity, and wrapper analysis hardened

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
infrastructure ceiling. D-039 through D-046 remain the underlying prompt-6
security decisions.

### D-048 · 2026-07-27 · reversible · Ninth-round review: structural resolution, derived observability vocabulary, and boundary-honest fences

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
ADR-0031 would be withdrawn with it. D-039 through D-047 remain the underlying
prompt-6 security decisions.

### D-049 · 2026-07-27 · reversible · Tenth-round review: leading-name binding, the account shape, and semantic fence keys

D-048 replaced two enumerated vocabularies with structural rules; the tenth round
found that both structures were drawn slightly off the predicate they claimed to
derive from, and that the D-048 crash fix had been narrowed rather than closed.

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
uncanonicalized `executionId`. D-048 and ADR-0031 stand independently.
