# ADR-0033: Sibling append-only decision ledger and replay storage

**Status:** Accepted (amends ADR-0007, ADR-0018, and ADR-0019)
**Date:** 2026-07-28
**Deciders:** Founding architect (executing v3 prompt 7 and its accepted design report)
**Relates to:** Charter non-negotiables #1, #2, #7, #13; v3 invariants 2, 4, 5, 23, 30
**Informed by:** `docs/v3/verin-architecture-v3.md` §§5, 12, 15, 16, 18; prompt 7; `verin-ledgerdesign-l7/report.md`

## Context

The existing `audit_log` is an operational audit plane. Its fixed ten-field hash
preimage and asynchronous at-least-once outbox delivery are already recorded
history. Decision events are the source for projections and future replay. They
must commit synchronously with the immutable decision record and must hash the
complete typed event bytes.

Putting both fact classes in one table would either change old audit preimages,
leave typed fields outside the hash, or make authoritative decision state lag its
business transaction. Splitting an overloaded hash chain later would require
rewriting retained history, so topology is the irreversible choice prompt 7 must
settle now.

## Decision

- Add `decision_ledger` as a sibling to `audit_log`. It owns an independent,
  GENESIS-rooted, per-organization sequence and hash chain. Its hash preimage is
  exactly `canonicalJson(full typed event)`, followed by the prior hash.
- Freeze the prompt-7 vocabulary at 16 discriminated event types, including
  `ApprovalStageExpired` and `ApprovalStageEscalated`. Each event records ledger
  schema and canonical serializer versions. Old bytes are never rewritten.
- Persist immutable `evidence_snapshots`, `decision_input_bundles`, ordered bundle
  evidence membership, and `decision_records`. Full canonical bytes and the
  schema, serializer, engine, primitive-set, and time-zone registry versions
  needed for later replay are retained. This prompt stores replay inputs but does
  not evaluate or re-evaluate a decision.
- `recordDecision` writes evidence, bundle, immutable decision, its recording
  events, the chain anchor, and derived projection state in one transaction.
  Later facts use `appendDecisionEvents`. Both lock the tenant row before reading
  the chain head, which serializes sequence assignment on Postgres and PGlite
  without a failed-transaction retry fork. No decision-ledger outbox exists.
- Composite `(org_id, id)` foreign keys make decision, evidence, membership, and
  causation links structurally same-tenant. Repository boundaries validate the
  canonical source hashes named by recording and approval events.
- All immutable source tables reject UPDATE, DELETE, and TRUNCATE through database
  triggers. A ts-morph anti-fork fence permits raw ledger INSERT text only in the
  sole repository and forward migration. Repository exports expose no immutable
  update or delete operation.
- Projection state is a cache. Online append and rebuild call the same pure,
  sequence-driven fold. The fold records stated facts only. It does not infer
  quorum, eligibility, execution readiness, or any later-prompt decision.
- Verification is layered: L1 checks gaps, links, and hashes over stored bytes; L2
  dispatches recorded schema/serializer versions and proves canonical round-trip;
  L3 re-derives promoted columns from the typed payload; L4 compares count,
  sequence, and head hash with the anchor. The existing CI chain gate verifies
  both audit-class stores and refuses a zero-entry pass for either.
- The seeded `/app/ledger` register is read-only and uses typed view models. Seed
  rows visibly say `Synthetic fixture`. No fake decision, status, or execution
  history is presented as real.
- Extend ADR-0019's six-year audit-class retention to the ledger, evidence,
  bundles, membership, and decision records. External anchor witnessing or HMAC
  now applies to both chains.
- Amend ADR-0018 ceilings from contracts 3500 to 3900 and infrastructure 2500 to
  3400. Measured prompt-7 state is contracts 3831 and infrastructure 3352. Domain
  remains below its 1200 ceiling and the per-file 500-line limit is unchanged.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Extend `audit_log` | Breaks its frozen hash form or leaves typed data unhashed; asynchronous delivery cannot be authoritative decision state. |
| A second orchestration engine | Prompt 7 is persistence and replay foundation only; the existing workflow engine remains the orchestration substrate. |
| Projection rows as source of truth | Mutable caches cannot provide replay or examiner-grade history; rebuild equality is the stronger contract. |
| Repository-only immutability | Any bypass with ordinary database write access could silently edit history; practical database triggers close that class. |
| Recompute old payload bytes during verification | Serializer evolution could change old bytes; L1 must hash the exact stored preimage forever. |

## Trade-offs and Costs

- **Gained:** atomic decision history, byte-stable replay inputs, structural
  tenancy, independent verification, deterministic rebuild, and an inspectable
  real source of truth without disturbing operational audit history.
- **Sacrificed:** two chains and anchors to operate, more retained storage, and a
  version registry that must remain backward-readable.

## Consequences

Migration version 3 is additive. Existing audit DDL, rows, preimages, outbox, and
verification remain byte-compatible. Future event schema versions add dispatch
entries and pure upcasts for projection use. They never rewrite an old row or
hash. Prompt 19 owns decision re-evaluation, and prompts 18/23/25 own authority,
reservation, execution, and status behavior.

The demo's fake `auditPosition`, fake status arrivals, and fake execution history
are deletion or switchover candidates once their producers append real events.
They are not deleted here because prompt 7 has no decision or execution producer;
replacing them now would make the walking skeleton empty or falsely real.

## Revisit When

Production deployment triggers external anchor witnessing/HMAC; a new ledger
schema or serializer version needs a registry/upcast entry; or write volume makes
one-row tenant locking a measured bottleneck.
