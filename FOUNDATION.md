# FOUNDATION.md — Verin foundation acceptance artifact (Part 1)

This is the Part-1 acceptance artifact required by `CHARTER.md`. It states what exists, every fence with its
proof, the self-audit findings, the control-matrix gap list, the decision journal, and the open decisions.
It is written so the **independent falsification session (Part 2)** can reproduce every claim **from this
repo alone** — if a proof cannot be reproduced without asking me, that is my defect.

> **Reproduce everything in one place.** `corepack pnpm install` then:
> `pnpm typecheck` · `pnpm lint` · `pnpm test` (158 unit/integration/fitness, non-UTC clock) ·
> `pnpm knip` · `pnpm build` · `pnpm exec playwright install chromium && pnpm test:e2e` (12 tests) ·
> `pnpm exec tsx scripts/backup-restore-drill.ts` · `pnpm load:smoke` ·
> `pnpm db:seed && pnpm audit:chain`. Every one except the backup-restore drill is also a blocking CI
> job (`.github/workflows/ci.yml`); the drill runs nightly in `scheduled.yml`.

---

## 1. What exists

A four-layer Next.js/TypeScript app (`src/{contracts,domain,infrastructure,app}`) with an inward dependency
rule, and a walking skeleton that runs end-to-end in a browser.

**Platform & discipline (Iris lineage, ported):** dependency rule; `Result<T,E>` + typed `AppError`; one
Zod config module that fails closed at boot; PII boundary (`assertNoPII` + scrub); 20 build-failing fitness
fences; ratchet-down line budgets + a separate presentation budget.

**Canonical schema + provenance (`src/domain/schema`):** 9 entities modeled only to declared need, each
field typed/nullable/united with provenance; golden-record survivorship; Salesforce object-graph mapping
(documentation only — no SF adapter code).

**Walking skeleton (`src/app`, `src/domain/workflow`, `src/infrastructure`):**
- **Real auth:** login server action (atomic cookie + redirect), server-side sessions with expiry /
  revocation, RBAC enforced at the port; identity is never client-trusted.
- **Account opening** through the generic engine + a view-driven form; the engine **suspends** at a
  simulated e-sign step (fire-and-return) and **resumes** via an HMAC-authenticated webhook; one **audited,
  idempotent** house-CRM write, **exactly-once** under replay.
- **Tamper-evident, hash-chained audit trail** (append-only Postgres triggers + transactional outbox +
  per-org hash chain), re-verifiable (`/api/audit`, `scripts/audit-chain-verify.ts`).
- **House-CRM console:** RBAC-gated CRUD; every edit through the audited-write helper.
- **Observability:** OpenTelemetry spans on every flow step + external call; pino structured logs;
  `/health` + `/ready`.
- **House-CRM store:** PGlite (real Postgres) behind the store interface (`SqlDb`) in dev/CI; managed Postgres in prod
  (D-006); serialization mutex + `globalThis` singleton.
- **Design-system port (`src/app/presentation`):** OKLCH slate tokens + Geist + keyframes + reduced-motion,
  the "Verin." wordmark, WhyBubble doctrine, and the micro-components the skeleton renders — all axe-clean.
- **Four Playwright spec files** (smoke, happy walkthrough, failure/access-control, console CRUD; 12
  tests) plus axe, green on a non-UTC clock.

**Governance:** 21 ADRs, STRIDE threat model, SOC 2 control matrix, sacrificial-components register,
PORT-LEDGER (all 20 debrief non-data gaps catalogued with triggers), DO-NOT-PORT ledger, the persona board
(3 seats), `DECISIONS.md`, and the charter-as-code enforcement (`charter-map.json` + charter-drift fence).

---

## 2. Every fence, with its proof

20 build-failing fences in `src/__tests__/fitness/`. **Each ships a co-located
`describe("detects …")` companion** that feeds it a synthetic violation and asserts it is caught (charter
#4) — so a green fence can never be vacuous; the `detection-not-verification` meta-fence fails the build if
any fence lacks one. Adversarial real-tree injection proofs are in
[`docs/fences/proof-log.md`](./docs/fences/proof-log.md) (PF-001..PF-017).

| Fence | Enforces (charter) | Proof |
|---|---|---|
| `charter-drift` | the constitution enforces its own enforcement | PF-001 |
| `dependency-rule` (ts-morph: static+relative+dynamic+require) | layer boundary (#1) | PF-002 + companions |
| `no-process-env` (content scan) | env only in config (#7) | PF-003 |
| `no-bare-throw` | typed errors in domain/infra (#1) | PF-004 |
| `no-console` | PII-safe logging only (#14) | PF-005 |
| `no-secret-fallback` / no-live-org-domain / placeholder-.env | config hygiene (#7) | PF-006 |
| `line-budget` (platform ratchet + separate presentation) / `max-file-size` | budgets (#1,#10) | companions |
| `detection-not-verification` (meta) | every fence has a companion (#4) | PF-META |
| `provenance-required` | every field has provenance (#2) | PF-007 |
| `no-unlabeled-synthetic` | synthetic can't feed compliance (#3) | PF-008 |
| `org-id-required` | every tenant query filters org_id (#7) | PF-009 + companion |
| `no-client-role-header` | identity never from a header (#7) | PF-010 |
| `audited-write-required` (+ anti-fork) | every write audited, no hand-rolled audit (#13) | PF-011 |
| `auth-enforcement` (AST, per exported handler, incl. Server Actions) | every handler/action resolves a session (#12) | PF-012 + companions |
| `idempotency-exactly-once` | replay = exactly once (#16) | PF-013 |
| `flowstep-suspend-resume` | engine really suspends/resumes (#6) | PF-014 |
| `observability-coverage` | flow steps + external calls emit spans (#14) | PF-015 |
| `no-pii-in-audit-store` | PII scrubbed from the audit trail (#3,#13) | PF-016 |
| `bounded-request-body` | no unbounded body reader — json/text/formData/arrayBuffer/blob (DoS) (#11/#14) | PF-017 + companions |

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

**Highest-impact fixes (re-verified: typecheck / lint / test 158 / knip / e2e 12 green):**
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
trace (V12); a scheduled outbox drainer (V14; the dead-letter half has since landed, D-024: poison rows
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
| Displayed-metric→source provenance trace (Vale V12) | — | founder | before any synthetic/estimated value renders |
| Scheduled outbox drainer (Vale V14; dead-letter parking landed, D-024) | CC7.1 | founder | deploy-target selection |
| Org-qualified login (Sable F3) | CC6.1 | red-team | self-registration / multi-org email collision |
| Auth fail-closed when its audit cannot be recorded (today: pino error + proceed) | CC7.4 | founder | SOC 2 Type II evidence window / first regulated-customer review (ADR-0007) |
| External audit-anchor witness / HMAC-signed chain (anchor shares the DB; hash is unkeyed) | CC7.4 | founder | production deploy (D-006) or first examiner/WORM requirement (ADR-0007/0019) |
| Content-Security-Policy (nonce strategy) | CC6.6 | founder | before first real deployment (ADR-0021 / D-020) |
| Login rate limiting / lockout (failed logins ARE audited) | CC6.1 | red-team | before first pilot with real users (ADR-0008 / D-015) |
| SHA/digest-pinned CI actions + semgrep image | CC8.1 | founder | SOC 2 Type II window or first production deploy (ADR-0017 / D-019) |
| Versioned schema-migration mechanism (DDL is CREATE IF NOT EXISTS) | CC8.1 | founder | first real schema change (D-016) |
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
