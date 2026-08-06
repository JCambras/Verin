# FOUNDATION.md — Verin foundation acceptance artifact (Part 1)

This is the Part-1 acceptance artifact required by `CHARTER.md`. It states what exists, every fence with its
proof, the self-audit findings, the control-matrix gap list, the decision journal, and the open decisions.
It is written so the **independent falsification session (Part 2)** can reproduce every claim **from this
repo alone** — if a proof cannot be reproduced without asking me, that is my defect.

> **Reproduce everything in one place.** `corepack pnpm install` then:
> `pnpm typecheck` · `pnpm lint` · `pnpm test` (the unit/integration/fitness suite; the command reports the
> live count, non-UTC clock) · `pnpm knip` · `pnpm build` ·
> `pnpm exec playwright install chromium && pnpm test:e2e` (the Playwright + axe browser specs) ·
> `pnpm exec tsx scripts/backup-restore-drill.ts` · `pnpm load:smoke` ·
> `pnpm db:seed && pnpm audit:chain` · `pnpm v3:invariants` (three-state v3 invariant report) ·
> `pnpm golden:validate` (the 16-case golden truth set, D-035). Every
> one except the backup-restore drill is also a blocking CI job (`.github/workflows/ci.yml`); the
> drill runs nightly in `scheduled.yml`.

---

## 1. What exists

A four-layer Next.js/TypeScript app (`src/{contracts,domain,infrastructure,app}`) with an inward dependency
rule, and a walking skeleton that runs end-to-end in a browser.

**Platform & discipline (Iris lineage, ported):** dependency rule; `Result<T,E>` + typed `AppError`; one
Zod config module that fails closed at boot; PII boundary (`assertNoPIIValues` + scrub); a build-failing
fitness-fence suite; ratchet-down line budgets + a separate presentation budget.

**v3 security boundaries (prompt 6, D-061..D-096):** every repository and port receives a runtime-sealed
`TenantContext`; governed request surfaces mint action-specific `ActionGrant`s that reach their sinks;
write attribution uses sealed `WriteActor`s; PII can enter `src/infrastructure/llm/` only as scrubber-minted,
deeply frozen `Tokenized<T>` values; and config secrets leave the config boundary only through
fence-allowlisted HMAC consumers. Operational telemetry uses closed vocabularies, and request-derived
record UUIDs become tenant- and field-scoped keyed digests instead of being emitted verbatim.

**v3 decision-core contracts (`src/contracts/decision-core`, ADR-0029, D-040):** the canonical decision
type system as Zod strict schemas with derived types - proceed requires authority + a non-empty execution
plan, blocked/prohibited carry neither, a prohibition has no resolving condition (v3 invariants 7-9 as
parse-level facts) - plus a versioned canonical serializer whose byte form is locked by the
`fixtures/decision-core/` round-trip fixtures. Parsed contracts are recursively readonly and frozen,
replay-ID collections reject duplicates, and version-keyed recursive fingerprints prevent nested
projection growth under an unchanged hash-preimage version. Every named tenant-owned link is a strict
`{ firmId, id }` reference, compensating actions carry the same retry-safety contract as execution
steps, and replay time zones are pinned to a persisted versioned registry instead of host ICU data.

**v3 decision-primitive vocabulary (`src/contracts/primitives`, ADR-0039, D-102):** primitive set
`1.0.0`, **versioned and provisional** - six pure primitives (`candidate-selection`,
`evidence-reconciliation`, `horizon-projection`, `net-availability`, `restriction-screen`,
`sufficiency-check`), each with a strict Zod parameter schema, a refined input schema, declared
published context keys, and a total pure `evaluate`. The root registry `primitive-set-version.json`
mirrors the catalog and names the three declared future primitives, and
[`docs/primitive-rationale.md`](./docs/primitive-rationale.md) carries the composability razor, the
per-primitive falsification criterion, and the cross-domain matrix over the sixteen signed golden
cases. Each kill criterion is asserted **unrepresentable** in the unit suite, so absorbing a
falsifying case by quiet schema growth fails the build instead of passing silently.

**Canonical schema + provenance (`src/domain/schema`):** 9 entities modeled only to declared need, each
field typed/nullable/united with provenance; golden-record survivorship; Salesforce object-graph mapping
(documentation only — no SF adapter code).

**Walking skeleton (`src/app`, `src/domain/workflow`, `src/infrastructure`):**
- **Real auth:** login server action (atomic cookie + redirect), server-side sessions with expiry /
  revocation / sliding renewal + id rotation, RBAC enforced at the port; identity is never client-trusted.
- **Account opening** through the generic engine + a view-driven form; the engine **suspends** at a
  simulated e-sign step (fire-and-return) and **resumes** via an HMAC-authenticated webhook; one **audited,
  idempotent** house-CRM write, **exactly-once** under replay.
- **Tamper-evident, hash-chained audit trail** (append-only Postgres triggers + transactional outbox +
  per-org hash chain), re-verifiable (`/api/audit`, `scripts/audit-chain-verify.ts`).
- **House-CRM console:** RBAC-gated CRUD; every edit through the audited-write helper.
- **Observability:** OpenTelemetry spans on every flow step + external call, exported over OTLP/HTTP
  when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (ADR-0013); pino structured logs; `/health` + `/ready`.
- **House-CRM store:** PGlite (real Postgres) behind the store interface (`SqlDb`) in dev/CI; managed Postgres in prod
  (D-006); serialization mutex + `globalThis` singleton. Migration startup proves an exact ledger prefix
  and managed-schema virginity, then applies all pending DDL and read-only orphan preflights atomically.
- **Design-system port (`src/app/presentation`):** OKLCH slate tokens + Geist + keyframes + reduced-motion,
  the "Verin." wordmark, WhyBubble doctrine, and the micro-components the skeleton renders — all axe-clean.
- **Playwright spec files** (smoke, happy walkthrough, failure/access-control, console CRUD, demo journey)
  plus axe, green on a non-UTC clock; `pnpm test:e2e` reports the live count.

**Governance:** 40 ADRs, STRIDE threat model, SOC 2 control matrix, sacrificial-components register,
PORT-LEDGER (all 20 debrief non-data gaps catalogued with triggers), DO-NOT-PORT ledger, the persona board
(3 seats), `DECISIONS.md`, the charter-as-code enforcement (`charter-map.json` + charter-drift fence),
the phase-gated v3 invariant registry (`v3-invariants.json` + `pnpm v3:invariants`, ADR-0023), the
normative Phase 1 demo contract (`docs/demo-contract.md` + `config/demo/scenarios.yaml`, D-034), and the
captain-signed golden-case truth set (`docs/golden-cases.md` + `fixtures/golden/`, D-035).

---

## 2. Every fence, with its proof

The build-failing fences in `src/__tests__/fitness/` are inventoried below. **Each ships a co-located
`describe("detects …")` companion** that feeds it a synthetic violation and asserts it is caught (charter
#4) — so a green fence can never be vacuous; the `detection-not-verification` meta-fence fails the build if
any fence lacks one. Adversarial real-tree injection proofs are in
[`docs/fences/proof-log.md`](./docs/fences/proof-log.md) (PF-001..PF-192; every PF id names exactly one
proof — the prompt-6 entries were renumbered on rebase, see the numbering note in the log).

| Fence | Enforces (charter) | Proof |
|---|---|---|
| `charter-drift` | the constitution enforces its own enforcement | PF-001 |
| `dependency-rule` (ts-morph: TypeScript-resolved aliases/baseUrl/package mappings, static+relative+dynamic+CommonJS+createRequire+import-type+import-equals+source-declarations+triple-slash+implicit JSX runtime; fail-closed local paths, ambient declarations, and ES-only platform surface; Zod-only external allowlist in `contracts/`) | layer boundary (#1) | PF-002 + extensions + companions |
| `no-process-env` (content scan) | env only in config (#7) | PF-003 |
| `no-bare-throw` | typed errors in domain/infra (#1) | PF-004 |
| `no-console` (all server-side layers incl. `src/app/`; leading `"use client"` files exempt) | PII-safe logging only (#14) | PF-005 + PF-020 |
| `no-secret-fallback` / no-live-org-domain / placeholder-.env / `SecretValue` containment | config hygiene + secret containment (#7, v3 §15.4) | PF-006, PF-034 |
| `line-budget` (platform ratchet + separate presentation) / `max-file-size` | budgets (#1,#10) | companions |
| `detection-not-verification` (meta) | every fence has a companion (#4) | PF-META |
| `provenance-required` | every field has provenance (#2) | PF-007 |
| `no-unlabeled-synthetic` | synthetic can't feed compliance (#3) | PF-008 |
| `metric-provenance` (AST: renderer contract + no metric field in a child or non-sanctioned attribute/spread) | every displayed metric carries source/asOf (#3, Vale V12) | PF-018 + companions |
| `derived-provenance` | a synthetic- or demonstration-derived artifact is a demonstration (transitive), can't feed compliance (#3, ADR-0022) | PF-019 + companions |
| `org-id-required` | every tenant query filters org_id (#7) | PF-009 + companion |
| `no-client-role-header` | identity never from a header (#7) | PF-010 |
| `audited-write-required` (+ anti-fork) | every write audited, no hand-rolled audit (#13) | PF-011 |
| `auth-enforcement` (AST, per exported handler, incl. Server Actions) | every handler/action resolves a session (#12) | PF-012 + companions |
| `idempotency-exactly-once` | replay = exactly once (#16) | PF-013 |
| `flowstep-suspend-resume` | engine really suspends/resumes (#6) | PF-014 |
| `observability-coverage` | flow steps + external calls emit spans (#14) | PF-015 |
| `no-pii-in-audit-store` | PII scrubbed from the audit trail (#3,#13) | PF-016 |
| `bounded-request-body` | no unbounded body reader — json/text/formData/arrayBuffer/blob (DoS) (#11/#14) | PF-017 + companions |
| `arch-version` (SHA-256 pins on the ratified documents registered in `v3-invariants.json`; the fence iterates that registry, never the `docs/v3/` directory - D-099) | build work never targets a stale or edited architecture copy (ADR-0023) | PF-023 + companions |
| `v3-invariants` (registry integrity + activation ratchet) | the 30 v3 invariants stay activation-only, mapped to live fences, never fake green (ADR-0023) | PF-024 + companions |
| `demo-scenarios-contract` | the scenario matrix stays inert data (no executable YAML), id-stable (append-only), and internally consistent (D-034) | PF-025 + companions |
| `golden-cases` | the golden truth set stays complete, vocabulary-aligned, structurally consistent, and captain-signoff-gated (#1/#4, v3 prompt 2, D-035) | PF-026 + companions |
| `demo-skeleton-honesty` | skeleton branch data stays equal to the scenario contract and presentation surfaces cannot recompute decisions (#4/#5, ADR-0027, D-036) | proof-log section + companions |
| `decision-core-illegal-states` | proceed requires usable authority with future expiration + a non-empty plan; blocked/prohibited carry neither; a prohibition has no resolving condition - all parse-level (v3 invariants 7-9, prompt 5, ADR-0029, D-040) | PF-027 + companions |
| `decision-core-tenant-scope` | registered prompt-5 reference boundaries reject cross-tenant values; an exact schema-derived inventory follows aliases, wrappers, and composites and fails on any unregistered scoped-reference collection (v3 invariant 2, ADR-0029, D-045-D-058) | PF-028 + companions |
| `decision-core-external-action-safety` | execution steps and compensation require retry-safe action metadata, one tenant, and evidence-targeted revalidation at standalone and plan boundaries; idempotency keys cannot alias; set-like execution references are duplicate-free and canonical (#16, ADR-0029, D-047-D-058) | PF-029 + companions |
| `tenant-context-required` (ts-morph: sealed tenant authority on ordinary repository/port signatures; exact capability-keyed escapes registered) | ordinary calls cannot compile or parse without tenant authority; registered capability loads derive or re-check tenant scope before work (#7, v3 §15.2, invariant 2) | PF-030 + companions |
| `tokenized-factory-only` (AST: `Tokenized<T>` + the seven sealed security types construct only via their factories) | PII leaves for a model only as scrubber-minted `Tokenized<T>` (#3, #13, v3 §15) | PF-031 + companions |
| `llm-pii-boundary` (import-reachability: no `PIIBearing`-marked type reachable from `src/infrastructure/llm/`) | no PII-bearing type reaches a model surface (#3, #13, v3 invariant 1, ADR-0031) | PF-032 + companions |
| `governed-actions` (AST: per-action `ActionGrant` bound at each governed request surface) | governed human actions authorized per-action, never by a bare role check (#12, v3 §15.3) | PF-033 + companions |
| `observability-vocabulary` (AST: span/log/action/attribute values drawn from a sealed vocabulary) | un-listed telemetry values degrade to `[REDACTED]`, never leak PII (#14) | PF-035 + companions |
| `primitive-catalog` (registry/catalog agreement both ways, rationale-doc coverage without phantoms, domain-neutral naming, purity, evidence-kind declarations resolving to real parameters) | the primitive vocabulary stays versioned, provisional, domain-neutral, and pure - a new or stretched primitive is a version bump, never a quiet edit (#1/#4, v3 prompt 8, ADR-0039, D-102) | PF-188, PF-189 + companions |

**Current prompt-8 line-budget PR evidence:** contracts 5,433/5,460 (27
headroom), domain 1,298/1,350 (52), infrastructure 3,484/3,550 (66), and
presentation 928/6,000 (5,072). ADR-0040 is the latest ceiling amendment,
measured with the fence's own algorithm after the primitive catalog AND its
review hardening landed (PF-192), so the headroom is bounded correction room
rather than a stale pre-review figure. No useful implementation or
documentation was removed or compressed.

`charter-map.json` maps all 16 non-negotiables to an **enforced** mechanism; the charter-drift fence fails
the build if any enforced CI gate is not declared in the BLOCKING `ci.yml`, any enforced fence/file is
missing, any fence (itself included) is disabled, or any entry that ever shipped as `enforced` is flipped
back to `planned` (a monotonic ratchet).

### Falsifier proof-of-life (reproduce without asking me)

- **Fence adversarial proofs:** re-inject any violation described in `docs/fences/proof-log.md` and run
  `pnpm exec vitest run src/__tests__/fitness/<fence>` — it fails with `file:line`; revert → green.
- **Webhook replay exactly-once + audit chain:** `pnpm exec vitest run src/__tests__/integration/account-opening.test.ts` (fires the webhook twice → one financial account, chain verified).
- **Audit-chain edit rejected + tamper detected:** `src/__tests__/integration/audit-chain.test.ts` (UPDATE/DELETE blocked by trigger; `verifyChain` catches a row altered after disabling the trigger).
- **Authz bypass attempt:** `e2e/access-control.spec.ts` (unauthenticated mutation → 401; advisor → 403 on audit; forged webhook signature → 401).
- **~2-minute walkthrough:** `e2e/walkthrough.spec.ts` drives login → account opening → suspend → sign
  webhook → resume → finalize → the verified audit chain, headed via `pnpm exec playwright test e2e/walkthrough.spec.ts --headed` (records a trace/video under `test-results/`).

---

## 3. Self-audit findings (Part 1, deliverable G)

Run under the fresh-context rule (a session that authored code never reviews it inline) by three personas —
Dr. Vale (white-box code-reading, Overall 6.5/10), Wren (accessibility), Sable (security red-team). Full
reports: [`docs/reviews/01-vale-foundation.md`](./docs/reviews/01-vale-foundation.md),
[`02-wren`](./docs/reviews/02-wren-foundation.md), [`03-sable`](./docs/reviews/03-sable-foundation.md).

**28 findings; 22 fixed in this pass, 6 explicitly deferred with a trigger.** The audit was materially
valuable — it caught issues the walkthrough could not, including two false-passes in my own fences.

**Highest-impact fixes (all re-verified green at the self-audit pass — typecheck / lint / test / knip / e2e;
re-derive the live suite with `pnpm test` and `pnpm test:e2e`):**
- **Audit-chain truncation (Vale V1 / Sable F4, Critical):** the chain couldn't detect tail-truncation or
  full deletion. Added a `BEFORE TRUNCATE` trigger + an out-of-band `audit_anchor` (expected count +
  max-sequence) that `verifyChain` checks — now detected and tested.
- **PII in the audit trail + a VACUOUS fence (Vale V2/V3 / Sable F1, High):** client names landed raw in
  `after_json`/`detail`, and `no-pii-in-audit-store` only checked email/phone. Expanded PII detection to
  names, PII-minimized `detail`, wired the fail-closed `assertNoPIIValues` backstop, and fixed the fence to
  scan `detail` + assert names are gone. This was the charter's exact "detection is not verification" trap,
  in my own fence.
- **Login timing oracle (Vale V6, High):** constant-work `authenticate()` (scrypt always runs).
- **org-id fence evasion (Vale V4, High):** now requires `org_id` as a `WHERE` predicate, not anywhere.
- **Failed-flow retry (Vale V7, Medium):** `resumeFlow` retries a `failed` execution idempotently.
- **Auth events now in the hash chain (Vale V5 / Sable F6):** login/logout recorded via `auditEvent`.
- **Request-size DoS (Sable F2, Medium):** bounded `readJsonBody` + a fence.
- **Accessibility (Wren W1-W7, all fixed):** live-region status announcements, contrast-safe FreshValue,
  distinct button names, `aria-current`, `aria-controls`, table scope/caption; the axe gate now also
  scans `/app/audit`.

**Deferred (with triggers) — also in the gap list below:** meta-fence efficacy / mutation testing (V9);
knip `domain/schema` exemption for forward-looking vocabulary (V11 / D-013); the displayed-metric→source
trace (V12 — **now CLOSED**: Wave-1 prereq, ADR-0022, `metric-provenance` + `derived-provenance` fences,
D-025/D-026); a scheduled outbox drainer (V14; the dead-letter half has since landed, D-024: poison rows
park after 5 failed deliveries); org-qualified login (Sable F3); axe on the
post-submit account-opening states (Wren meta).

---

## 4. SOC 2 control-matrix gap list

The full matrix is [`docs/compliance/controls.md`](./docs/compliance/controls.md). Explicit gaps (owner +
date/trigger), never omitted:

| Gap | Criterion | Owner | Trigger / date |
|-----|-----------|-------|----------------|
| Branch protection alterable by the solo founder | CC8.1 | founder | second human reviewer / external attestation before first paying customer |
| Field-level PII-at-rest encryption | CC6.7 | red-team | WISP technical control (pre-launch) |
| Full DSAR / erasure workflow (retention hold defined) | P4 | compliance | before first customer PII at scale |
| WORM archive for 17a-4(f) | CC7.4 | founder | first Tier-1 audit entry nears 6 years |
| Formal org-policy set + vendor risk register | CC1/CC9 | founder | pre-audit (Vanta/Drata templates) |
| Per-tenant rate limiting | A1.1 | red-team | scale-ladder trigger (ADR-0015) |
| Alerting rules as code | CC7.2 | founder | deploy-target selection |
| Managed-Postgres (`node-postgres`) store adapter | — | founder | production deploy (D-006; PGlite is dev/CI) |
| Mutation-testing harness for fence efficacy (Vale V9) | CC5 | founder | add a check that a gutted fence fails |
| Dead-export exemption for `domain/schema` vocabulary (Vale V11 / D-013) | CC5 | founder | remove when entities gain runtime consumers / a 2nd source lands |
| Displayed-metric→source provenance trace (Vale V12) — **CLOSED** (Wave-1 prereq: ADR-0022, `metric-provenance` + `derived-provenance` fences in the `provenance-trace` gate; D-025/D-026) | #3 | — | done |
| Scheduled outbox drainer (Vale V14; dead-letter parking landed, D-024) | CC7.1 | founder | deploy-target selection |
| Org-qualified login (Sable F3) | CC6.1 | red-team | self-registration / multi-org email collision |
| Auth fail-closed when its audit cannot be recorded (today: pino error + proceed) | CC7.4 | founder | SOC 2 Type II evidence window / first regulated-customer review (ADR-0007) |
| External audit-anchor witness / HMAC-signed chain (anchor shares the DB; hash is unkeyed) | CC7.4 | founder | production deploy (D-006) or first examiner/WORM requirement (ADR-0007/0019) |
| Content-Security-Policy (nonce strategy) | CC6.6 | founder | before first real deployment (ADR-0021 / D-020) |
| Login rate limiting / lockout (failed logins ARE audited) | CC6.1 | red-team | before first pilot with real users (ADR-0008 / D-015) |
| SHA/digest-pinned CI actions + semgrep image | CC8.1 | founder | SOC 2 Type II window or first production deploy (ADR-0017 / D-019) |
| Versioned schema-migration mechanism - **CLOSED** (`runMigrations` validates the exact ledger prefix and virgin schema, then applies the pending preflight/DDL plan atomically; D-016/D-029, D-075..D-088) | CC8.1 | - | done |
| Scheduled chain-verify against a PERSISTENT store (today: seeded per-run) | CC7.4 | founder | managed Postgres lands (D-017) |
| Flow compensation + retry-by-execution-id recovery | CC7.1 | founder | first flow with external obligations / first manual-recovery incident (ADR-0011 / D-021) |

---

## 5. Decision journal

Full journal: [`DECISIONS.md`](./DECISIONS.md). Captain decisions (D-001..D-005): PostgreSQL behind the
store port; build real auth behind an identity port; container hosting; keep "Verin."; port the feel but
DEFER the populated demo world (un-defer trigger = first demo milestone). Reversible decisions (D-006..D-013)
logged with rationale + revert path. Review-round captain decisions (D-014..D-021): audit/OTel actor =
opaque userId; failed-login auditing now with rate limiting deferred; schema versioning, persistent-store
chain verification, nightly load scale-up, action/image pinning, and CSP recorded as triggered deferrals;
pre-suspend idempotency keys with compensation deferred.

Prompt-6 security decisions (D-061..D-096) add the sealed tenant, actor, grant, token, secret,
observability, and authenticated-error boundaries. The review entries harden their semantic fences,
make migration history and orphan checks fail before mutation, and replace shape-trusted telemetry
record IDs with secret-derived keyed correlation while retaining the audit record.

---

## 6. Open decisions (for the captain)

All four carry a recommendation (charter). Two were needed to build the skeleton and were answered at the
read-back gate (production DB → PostgreSQL; auth → build behind identity port). Remaining:

- **Hosting platform** — recommend a container platform (Fly/Render/Cloud Run/ECS) with managed Postgres +
  a queue; final pick at the deploy gate (D-003).
- **Real brand name** — "Verin." stands as code name + wordmark until named (D-004).
- **Separation-of-duties for a solo founder** — is the compensating control (protected main + no-mistakes
  independent gate + persona fresh-context rule + Part-2 falsification) sufficient, or is a human reviewer
  required in the loop? (controls.md CC8.1 gap.)
- **Demo milestone scope** — when to un-defer the populated world + tour/narration/recorder engines
  (PORT-LEDGER + ADR-0012).
