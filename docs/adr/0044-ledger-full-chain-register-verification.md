# ADR-0044: Full-chain register verification with bounded disclosure

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Founding architect
**Amends:** ADR-0039 and ADR-0043
**Amended by:** ADR-0045
**Relates to:** Charter non-negotiables #1, #2, #4, #7, #13; v3 invariants 2, 4, 5, 23, 30

## Context

The bounded register verifier authenticated a tail and its predecessor hash, then
used promoted facts from older rows to validate decision and reservation order. A
tail hash proves continuity from an older stored value, but it cannot prove that
the older value or its promoted columns are authentic. Correctly chained tail rows
could therefore receive an L1-L4 verdict from tampered prerequisites outside the
verified snapshot.

Replay-source corruption also escaped the structured integrity response, and
decisions whose required source origins were outside the displayed event window
were omitted without a visible count. The history queries added by prompt 7 did
not have access-path indexes, while savepoint-protected batches still updated the
anchor and projection checkpoint after every event.

## Decision

- The request-path register authenticates the complete tenant ledger through L1-L4
  from one MVCC-consistent snapshot without retaining the tenant append lock. The
  event rows returned to the route and the decision replay window remain bounded.
- Replay-source validation failures become a static L2 integrity failure. The
  register withholds all rows and derived state instead of returning a generic
  server error or disclosing failed bytes.
- Bounded replay reports how many DecisionRecorded facts were withheld because
  their immutable source-origin facts fall outside the displayed event window.
  The UI renders that count as a provenance-bound metric.
- Exact UUIDs, hashes, and registered machine references pass the identifier
  boundary after the complete grammar and general PII checks succeed. Partial
  account-reference scanning remains active for unclassified numeric values.
- Migration version 6 adds partial indexes for evidence origins, bundle origins,
  reservation creations, and reservation releases. Shipped migrations remain
  unchanged.
- A successful savepoint-protected append batch advances the chain anchor and
  projection checkpoint once with the batch head and entry count. Any failed
  batch rolls back before either derived integrity record becomes visible.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Trust arbitrary historical prerequisite rows | A stored predecessor hash does not authenticate sparse promoted facts outside the verified tail. |
| Add sparse hash proofs to the current schema | The chain has no authenticated skip structure, so this would require a new proof topology and retained history format. |
| Expand replay to every old source origin | Operator latency and disclosure would grow with retention even when only recent state is requested. |
| Return replay-source exceptions as HTTP failures | Integrity incidents need the same fail-closed, entries-withheld response as ledger corruption. |
| Keep per-event anchor updates | The transaction and savepoint already make every public batch atomic. |

## Trade-offs and Costs

- **Gained:** every ordering prerequisite consumed by L2 is authenticated, source
  corruption fails closed in the register, bounded omissions are visible, and
  history lookups use targeted indexes.
- **Sacrificed:** request-path verification is linear in retained ledger entries
  even though returned rows and replay remain bounded. The verification no longer
  blocks an append while hashing and validating the captured rows.

## Consequences

The operator register and the unbounded gate now share full-chain L1-L4 authority.
They differ in disclosure and replay-source scope, not in whether old chain bytes
are authenticated. The register remains distinct from the deferred examiner export
because it still omits retained payloads and sources and caps returned events.

Migration version 6 is forward-only and contains indexes only. The implementation
measures infrastructure at 7,231 of the existing 7,250-line ceiling, so ADR-0018
does not require another ceiling amendment.

## Revisit When

Measured request latency requires an authenticated checkpoint or skip-proof design,
or the first examiner export requires unbounded source disclosure.
