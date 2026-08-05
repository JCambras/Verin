# ADR-0041: Sibling append-only decision ledger and replay storage

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
  GENESIS-rooted, per-organization sequence and hash chain. Its versioned hash
  preimage binds the exact canonical typed-event bytes and the producer provenance,
  followed by the prior hash.
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
  without a failed-transaction retry fork. Later appends require a nominal
  transaction capability and use a savepoint, so a caller that catches an append
  error cannot commit a prefix. No decision-ledger outbox exists.
- Composite `(org_id, id)` foreign keys make decision, evidence, membership,
  causation, and exception-triggering links structurally same-tenant. Every
  reference an event can name is a promoted column L3 re-derives from the payload.
  Repository boundaries validate the canonical source hashes named by recording and
  approval events.
- Retained free text is a PII-free projection: attribution is an opaque retained-text
  reference, decision explanations and summaries repeat only closed-registry codes,
  and external statuses and structured reasons are registered codes or opaque
  references. The storage boundary rejects unclassified text and never rewrites
  submitted immutable bytes.
- Every ledger row stores the provenance of the producer that appended it
  (`prov_source`/`prov_asof`/`prov_confidence`, charter #4). Both write paths refuse
  an unregistered source, the chain binds all three fields, and surfaces classify a
  row from the stored value - never from an actor name.
- Evidence snapshots and input bundles are content-addressed and reusable: a later
  decision over the same immutable inputs links the stored bytes. Reuse demands byte
  equality, so an id collision with different bytes is refused, never overwritten.
  Each evidence-recording event binds a digest of the complete canonical snapshot
  metadata in addition to the encrypted content hash.
- All immutable source tables reject UPDATE, DELETE, and TRUNCATE through database
  triggers. A ts-morph anti-fork fence assigns each table to one exact insert-owning
  module. Repository exports expose no immutable update or delete operation.
- Projection state is a cache. Online append and rebuild call the same pure,
  sequence-driven fold. The fold records stated facts only. It does not infer
  quorum, eligibility, execution readiness, or any later-prompt decision. Derived
  state is never located by physical row order. A reservation generation is keyed by
  reservation reference, owning decision reference, and its creation ledger-entry
  identity. A release cites that exact generation. Reuse is allowed after release
  only through a new creation identity, and a delayed old-generation release cannot
  affect the new generation. Projection rows persist derived provenance for repair and
  operator reads, but the register never trusts them: it replays the exact verified
  event window and verifies the immutable sources needed by every state it displays.
- Verification is layered: L1 checks gaps, links, and hashes over stored bytes; L2
  dispatches recorded schema/serializer versions and proves canonical round-trip;
  L3 re-derives promoted columns from the typed payload; L4 compares count,
  sequence, and head hash with the anchor. The existing CI chain gate verifies
  both audit-class stores unbounded, dispatches immutable evidence, bundle, and
  decision rows through recorded source codecs, and refuses a zero-entry pass.
- A request path may verify a bounded window: the most recent entries, anchored to
  the stored hash of the row preceding them, with L4 still compared against tenant
  totals. The register verifies, reads, and replays that window under one tenant-locked
  transaction and displays only decisions whose complete replay sources fall inside
  it. Only the gate's unbounded run is examiner-grade.
- The seeded `/app/ledger` register is read-only, uses typed view models, and shows
  both the raw event register and replayed decision state, so the projection fold is
  reachable in the PR that lands it. Rows produced by a synthetic source carry the
  shared `synthetic fixture` badge, derived from stored provenance. No fake decision,
  status, or execution history is presented as real.
- Extend ADR-0019's six-year audit-class retention to the ledger, evidence,
  bundles, membership, and decision records. External anchor witnessing or HMAC
  now applies to both chains.
- Amend the ADR-0018 ceilings, re-measured on the composed tree that already
  carries ADR-0040's prompt-8 primitive catalog: contracts 5,460 to 6,000,
  domain 1,350 to 1,650, and infrastructure 3,550 to 6,650. Measured state is
  contracts 5,954 (46 headroom), domain 1,584 (66), and infrastructure 6,608 (42) -
  bounded correction room, per the ADR-0033 rule that a zero-headroom ceiling just
  converts review findings into documentation deletions. The presentation envelope and
  the per-file 500-line limit are unchanged: the repository is split into the chain
  writer (`ledger-store.ts`), the immutable content-addressed source rows
  (`ledger-sources.ts`), and derived projection and reservation state
  (`ledger-projection-store.ts`), with replay orchestration in `ledger-rebuild.ts`. Verified request replay lives in `ledger-register.ts`.

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
