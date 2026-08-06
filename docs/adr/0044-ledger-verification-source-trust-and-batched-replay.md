# ADR-0044: Ledger verification, source trust, and batched replay

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Founding architect
**Amends:** ADR-0018, ADR-0041, and ADR-0043
**Relates to:** Charter non-negotiables #1, #3, #4, #7, #13; v3 invariants 5, 6, 13, 30

## Context

Adversarial review found three connected replay-boundary gaps. A privileged writer
could insert correctly chained event bytes that violated the append path's PII,
immutable-source, or causal-order checks and still receive L1-L4 verification. A bundle
first recorded by a fixture producer could later be reused by a real producer and lose
its demonstration classification. The bounded register verified sources through serial
queries inside its tenant lock, issuing 65 statements for a 14-decision test window.

The source-provenance question is architectural. Trust can belong to mutable caller
claims, to source-table columns, or to a specific immutable recording edge. Only the
last option already has append-only, tenant-scoped, hash-bound storage.

## Decision

- L2 reuses the append path's retained-PII and immutable-source binding authorities and
  adds a set-based causal-order check before it can pass. Schema-valid canonical bytes
  are necessary but no longer sufficient.
- Replay-source trust belongs to the source's first immutable recording edge. Evidence
  uses the first `EvidenceSnapshotRecorded` provenance, while a bundle uses the first
  `DecisionRecorded` edge for any decision linked to it. Every later use keeps its own
  producer provenance. Decision projection provenance derives from both the retained
  source origins and the current use, so neither a later real producer nor a later
  synthetic producer can erase a less-trusted input.
- The first-edge provenance is already persisted and bound into the ledger chain. No
  source-table migration or rewrite of prior canonical bytes is required.
- Verified register replay batch-loads decision records with bundles, bundle membership,
  evidence rows, and first recording edges before folding. Query count is bounded by
  source categories rather than event count, and verification returns the rows it
  already read instead of selecting the window twice.
- Correct ADR-0041's migration history: version 4 creates the ledger foundation and
  version 5 adds replay-source schema identity and reservation-generation ownership.
- Raise the infrastructure ceiling from 6,650 to 7,050 lines. The corrected layer
  measures 6,927 lines, leaving 123 lines of bounded headroom. The 500-line file cap is
  unchanged.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Trust each reuse edge independently | A real-labeled reuse can upgrade fixture-derived bytes into a compliance-eligible artifact. |
| Add mutable provenance columns to source rows | The new trust data would not be chain-bound and would require rewriting existing immutable metadata. |
| Extend L2 with only a PII call | Correctly chained source-hash and causal-order violations would still verify. |
| Keep per-event replay queries | Request latency and tenant-lock duration grow linearly with the verified window. |
| Compress the existing ledger boundaries | Hides the measured complexity without reducing it or closing the shared failure class. |

## Trade-offs and Costs

- **Gained:** verification equivalent to append acceptance, non-upgradable source trust,
  bounded register I/O, and accurate migration guidance.
- **Sacrificed:** a larger replay loader and two source-origin queries per verified
  window.

## Consequences

Correctly chained but repository-invalid event bytes fail at L2. Reused input bundles
retain the least-trusted origin through online projection, bounded register replay, and
full rebuild. Register query count remains constant as decision events grow within the
selected window.

## Revisit When

A future ledger schema embeds source provenance directly into canonical source envelopes,
or measured query plans justify materialized source-origin indexes.
