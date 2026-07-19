# ADR-0009: Idempotent, retry-safe external writes; audited-write helper; queue-backed long work

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiable #16, #13
**Informed by:** retro-r7 do-again #32 (one integration-client wrapper), #37 (auditedWrite applied inconsistently); Iris ADR-0025 (crm_write_cache idempotency)

## Context

The charter: every CRM/custodian/e-sign write carries an idempotency key and is provably safe under
timeout-replay (replay the same write → exactly-once effect). The app tier is stateless so horizontal
scale is a deployment choice. Iris retired the copy-paste audit block into an `auditedWrite` helper but
applied it inconsistently; the strongest idea was making "audit both paths" true *by construction*.

## Decision

Every external/house-CRM mutation goes through a single **`auditedWrite`** helper that: times the op,
performs it, and audits **both** success and failure paths by construction (ADR-0007). Idempotency is a
`(org_id, idempotency_key)` unique record (`crm_write_cache`-style): `auditedWrite` returns the cached
result on replay instead of re-performing — so a webhook fired twice yields exactly-once effect. A fence
(audited-write-required + **anti-fork**: the audit call may appear only inside the helper) makes hand-rolled
or unaudited writes fail the build. Long-running / fire-and-return work (the simulated e-sign) uses the
**transactional outbox** (ADR-0007) for at-least-once delivery; a real message broker with backpressure is
a scale-ladder item (ADR-0015). The app tier holds no session/mutation state (sessions are in the store),
so it is horizontally scalable by deployment.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Hand-roll audit per method (Meridian/early Iris) | Copy-paste class; the newest method always forgets it. Anti-fork fence forbids it. |
| No idempotency key | Timeout-replay double-applies writes (duplicate custodian/e-sign effects). |
| A real broker (Kafka/SQS) now | Over-scoped; the outbox covers foundation needs; broker is a scale trigger. |

## Trade-offs and Costs

- **Gained:** exactly-once external effects under replay; audit-by-construction; a stateless, scalable app tier.
- **Sacrificed:** every mutation routes through the helper; idempotency keys must be chosen deterministically.

## Consequences

The skeleton's e-sign webhook (Phase E) is replay-tested: fire twice → one effect (charter #16 proof).
Fences: audited-write-required, anti-fork, idempotency-exactly-once. Broker + backpressure = ADR-0015.

## Revisit When

Long-running work outgrows the outbox (throughput/backpressure), or a second external system needs an
atomic write target → adopt a real broker (scale-ladder trigger).
