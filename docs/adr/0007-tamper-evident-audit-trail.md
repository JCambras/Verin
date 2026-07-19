# ADR-0007: Tamper-evident, hash-chained audit trail (append-only triggers + outbox + chain)

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect (D-009)
**Relates to:** Charter non-negotiable #13; SOC 2 CC7.4; SEC 17a-4 / Rule 204-2
**Informed by:** retro-r7 do-again #34 (append-only triggers + outbox); don't-again #8 (fire-and-forget audit could silently lose records), #40 (audit detail double-escaped), #41 (actor hardcoded "system", unfixable after 90 days)

## Context

Meridian's audit was "immutable by convention" and fire-and-forget (could silently lose records). Iris
made it append-only via DB triggers + a transactional outbox, but hardcoded the actor as `"system"` at
~30 sites and double-escaped stored detail. The charter demands *tamper-evident, hash-chained*, mechanically
re-verifiable — "we promise we didn't edit it" is not an answer.

## Decision

Every write to a CRM/house-CRM entity goes through the **audited-write helper** (ADR-0009 wraps it),
recording `org_id`, `actor` (the session principal's opaque **userId** — never defaulted to "system",
and never the raw email: the audit boundary must not see PII, ADR-0006/D-014; views resolve
userId → email at render), `action`, and `before`/`after` snapshots (scrubbed per ADR-0006). Three
integrity layers:

1. **Append-only** — Postgres `BEFORE UPDATE`/`BEFORE DELETE` triggers `RAISE EXCEPTION` on the audit
   table (verified working in PGlite).
2. **Transactional outbox** — the audit entry is enqueued in the same transaction as the business write;
   a drainer moves it to the append-only log at-least-once (survives crashes), claiming rows atomically to
   avoid double-write.
3. **Hash chain** — each entry stores `prev_hash` and `entry_hash = sha256(canonical(entry) || prev_hash)`,
   computed in the app over a canonical serialization. A **scheduled CI/ops job re-verifies the whole chain**
   (`scripts/audit-chain-verify.ts`) and fails on any break — producing dated evidence over time.

Escape-at-render, not at-storage (store the value once; escape when displayed) — avoids Iris's
double-escape. A companion test proves a tampered chain is *detected* (charter #4).

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Append-only by convention (Meridian) | Not verifiable; can silently lose or be edited. |
| Triggers only, no hash chain | Triggers stop app-level mutation but not a DBA/root bypass; the chain detects it. |
| External immutable ledger service now | Over-scoped for the foundation; the chain + WORM archive (ADR-0019) covers 17a-4. |

## Trade-offs and Costs

- **Gained:** an examiner-grade "prove it wasn't edited" answer; integrity re-verified on a schedule.
- **Sacrificed:** hash computation + canonicalization on each write; the chain must be verified, not assumed.

## Consequences

Fences: audited-write-required + anti-fork (audits callable only inside the helper), audit-chain-verify CI
gate, tampered-chain-detected companion. Retention/WORM in ADR-0019. The house-CRM console (Phase E) is the
first live demo of the trail.

## Deferred hardening (explicit, with triggers — charter: deferrals are named, never silent)

- **Auth fails closed when its audit cannot be recorded.** Today a failed security-event audit
  (`auditEvent` in `src/infrastructure/wire.ts` — login/logout/session records) is logged as a pino
  error and the auth operation proceeds: availability over completeness, so an outbox hiccup cannot
  lock every user out. DEFERRED: make the auth operation itself fail when its audit write fails.
  **Trigger:** the SOC 2 Type II evidence-collection window opens (a Type II auditor requires
  complete session-lifecycle records), or the first regulated customer's security review.
- **Externalize the audit anchor / HMAC-sign the chain.** The `audit_anchor` table lives in the same
  database as the chain and the entry hash is unkeyed SHA-256, so an adversary WITH DB write access
  can rewrite entries, recompute hashes, and update the anchor — the anchor detects accidental
  truncation, bad restores, and naive edits, not that adversary. DEFERRED: export each org's anchor
  head to an external witness (object storage / signed log) or HMAC the chain with a KMS-held
  secret. **Trigger:** production deploy (the same milestone as the managed-Postgres adapter,
  D-006), or the first SEC-examiner/WORM conversation (ADR-0019).

## Revisit When

Write volume makes per-write hashing a latency problem (batch/merkle the chain), or a regulated customer
requires an external notarization/WORM vendor beyond the archive plan.
