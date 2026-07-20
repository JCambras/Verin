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
