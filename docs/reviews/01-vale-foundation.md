# 01 — Dr. Vale (white-box code-reading) — foundation audit

Fresh-context review (the authoring session did not review inline). Overall **6.5/10**. Full method in
`docs/personas/vale.md`. Dispositions below; **Fixed** items were fixed in the Phase-G hardening pass and
re-verified (typecheck / lint / test / knip / e2e green).

| Scored dimension (round 1) | Score |
|---|---|
| Architecture Integrity | 8.0 · Security Posture | 6.5 · Error Handling | 6.5 · Test Coverage | 6.5 · Fence Architecture | 5.5 · Data Integrity | 5.5 · Consistency | 7.0 |

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| V1 | Critical | Hash chain can't detect truncation/deletion (no BEFORE TRUNCATE trigger, no anchor) | **Fixed** — `BEFORE TRUNCATE` trigger + out-of-band `audit_anchor` (count + max-seq) checked by `verifyOrgChain`; tests added (truncation detected, TRUNCATE blocked). |
| V2 | High | Client names persist raw in the audit store; comment falsely claims redaction | **Fixed** — `PII_FIELD_RE` covers name fields; `detail` PII-minimized + scrubbed; fence now asserts names absent in before/after AND detail. |
| V3 | High | `assertNoPII` backstop documented but never wired | **Fixed** — `assertNoPIIValues` wired fail-closed in `enqueueAudit` (rolls back rather than persist residual PII). |
| V4 | High | `org-id-required` fence substring-evadable (org_id in projection passes) | **Fixed** — requires `org_id =`/`IN` predicate; companion added for the evasion. |
| V5 | High | audited-write fence evasions; identity writes unaudited | **Partially fixed** — login/logout (session lifecycle) now recorded in the hash chain via `auditEvent`. The fence is intentionally scoped to CRM data adapters; `tx.query`-outside-`perform` AST detection is deferred (below). |
| V6 | High | Login is a user-enumeration timing oracle (scrypt skipped for unknown user) | **Fixed** — `authenticate()` runs constant scrypt work on a cached dummy hash. |
| V7 | Medium | Failed finalize permanently wedges the flow (no retry) | **Fixed** — `resumeFlow` retries a `failed` execution from its cursor; idempotency keys make replay safe; test added. |
| V8 | Medium | Session role is a login snapshot | **Fixed** — `resolveSession` reads `role` from the live `users` row. |
| V9 | Medium | Meta-fences enforce structure, not efficacy | **Deferred** — charter-drift/detection-not-verification prove structure; per-fence efficacy is proven by each fence's own adversarial companion + proof-log. **Trigger:** add a mutation-testing harness (a fence whose assertions are gutted should fail). |
| V10 | Medium | auth-enforcement fence misses `export const POST = …` | **Fixed** — pattern matches const-arrow handlers. |
| V11 | Medium | Dead-export gate exempts `domain/schema`; test-only capabilities unflagged (`resolveConflict`, `canFeedComplianceDecision`) | **Accepted (D-013) with trigger** — these are forward-looking vocabulary the charter's own ADR-0005 defers (golden-record activates on a 2nd source; compliance-decision gate on the first compliance flow). **Trigger:** remove the knip exemption when entities gain runtime consumers / a 2nd source lands. |
| V12 | Medium | "No unlabeled synthetic" covers only the schema half | **Deferred** — mitigated: `FreshValue` requires a provenance prop (type-enforced) and the skeleton renders only real `verin-crm` data. **Trigger:** implement the displayed-metric→source trace before any synthetic value renders. |
| V13 | Medium | HMAC webhook rejection untested | **Fixed** — integration test asserts bad signature → `invalid-signature`, valid → completed. |
| V14 | Low | Outbox: no scheduled drainer, no poison handling | **Deferred** — inline drain + scheduled verify today. **Trigger:** deploy-target selection (add a scheduled drainer). *Update 2026-07-19:* the max-attempts/dead-letter half has since landed (D-024: a row failing 5 deliveries parks as `parked`); only the scheduled drainer remains deferred. |
| V15 | Low | `setEsignRequested` silent no-op on 0 rows | **Fixed** — `RETURNING` row-count check. |
| V16 | Low | Several denylist fences pattern-narrow | **Fixed** — broadened header / process.env / bare-throw patterns. |
| V17 | Low | Line-budget is one combined ceiling, not per-layer | **Fixed** — per-layer ceilings (contracts/domain/infrastructure) + separate presentation budget. |
| V18 | Low | Resume merges webhook payload over trusted context | **Fixed** — context now takes precedence over the payload. |

Credited as genuinely strong: the dependency-rule fence (AST + relative + dynamic + require), the idempotency
exactly-once proof, the append-only trigger + chain-edit detection, and the DB serialization singleton.
