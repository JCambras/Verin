# ADR-0043: Ledger history authority and bounded disclosure hardening

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Founding architect
**Amends:** ADR-0018 and ADR-0042
**Relates to:** Charter non-negotiables #1, #4, #7, #13; v3 invariants 2, 5, 6, 13, 30

## Context

Adversarial review found five connected authority gaps. L2 accepted a correctly
chained decision event before its `DecisionRecorded` fact. Reservation append
validation treated the mutable reservation projection as truth. Transaction
capabilities used a module-local runtime symbol even though the store is shared across
separately bundled Next.js modules. Raw ledger disclosure required only `pii.view` at
exported repository boundaries. Bounded replay derived trust from an origin edge outside
the verified window.

The ordering and source-trust defects shared one cause: immutable history was not the
single authority at every acceptance and disclosure boundary.

## Decision

- One set-based immutable-history check enforces prior decision recordings, unique
  decision-recording facts, and reservation generation order. Online append, rebuild,
  and L2 use the same authority. The reservation index remains a replaceable cache.
- SQL transaction authenticity is retained in a process-global `WeakSet`, so separately
  evaluated bundles recognize the same driver-issued transaction without exposing a
  copyable marker on the capability.
- Every exported raw ledger disclosure requires both `audit.export` and `pii.view`,
  proves the grants have identical tenant and actor scope, and returns an
  `audit.export`-marked output.
- Bounded replay identifies the global first recording sequence but derives provenance
  only when that edge is present in the verified row snapshot. A decision whose true
  evidence or bundle origin is outside the window is withheld.
- Raise the infrastructure ceiling from 7,050 to 7,250 lines. The corrected layer
  measures 7,174 lines, leaving 76 lines of bounded headroom. The 500-line file cap is
  unchanged.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Add another projection-cache guard | Deleting or corrupting the cache would recreate the immutable-history fork. |
| Keep a module-local transaction seal | A valid transaction from another Next.js bundle remains unusable. |
| Rely on the register route to hold both grants | A future request handler can call the exported repository boundary directly. |
| Trust provenance from an unverified origin row | A privileged edit outside the tail window can relabel synthetic inputs. |
| Compress the ordering queries to preserve the prior ceiling | Hides distinct fail-closed cases and makes the acceptance authority harder to audit. |

## Trade-offs and Costs

- **Gained:** one immutable ordering authority, cross-bundle transaction validity,
  repository-level dual authorization, and verified provenance ownership.
- **Sacrificed:** up to three fixed-category ordering queries and withheld bounded state
  when its true trust origin is older than the selected window.

## Consequences

A correctly chained but causally impossible decision or reservation event fails at L2.
Deleting derived reservation state cannot authorize a second active generation. Raw
ledger bytes cannot cross an exported boundary without both governed grants. Bounded
replay never consumes provenance bytes it did not verify.

## Revisit When

The register expands verified windows to include prerequisite source origins, or a
managed Postgres adapter provides a driver-native transaction capability shared across
runtime bundles.
