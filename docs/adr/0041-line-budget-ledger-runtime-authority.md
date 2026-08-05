# ADR-0041: Line budgets for ledger runtime authority

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Build agent (reversible, logged per the decision protocol; D-126)
**Relates to:** ADR-0018, ADR-0033, ADR-0040, charter #1/#3/#4/#7/#13
**Amends:** ADR-0033's domain ceiling and ADR-0040's infrastructure ceiling only

## Context

Ledger review found that transaction authority remained reusable and forgeable at
runtime, approval validation ignored recorded escalation state, execution handles
could identify more than one step, generic identifiers admitted firm-shaped PII,
and store diagnostics emitted values outside the closed observability vocabulary.

The correction requires one shared domain authority reducer, bounded and indexed
structural-history lookups, live runtime transaction membership, path-specific
identifier admission, and closed driver-error classification. Keeping the validator
below the 500-line file ceiling also requires separating versioned structural rules
from history ownership and orchestration.

## Decision

Raise the domain ceiling from 1,600 to 1,700 lines and the infrastructure ceiling
from 10,000 to 10,350 lines. Contracts remains 5,500 and presentation remains 6,000.

Measured with the fence's own algorithm after the correction:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 5,456 | 5,500 | 44 |
| domain | 1,641 | 1,700 | 59 |
| infrastructure | 10,244 | 10,350 | 106 |
| presentation | 918 | 6,000 | 5,082 |

## Alternatives Rejected

- Keep projection and validation authority separate. That preserves the semantic
  drift that admitted removed roles and stale expiry timestamps.
- Scan complete tenant history. Approval reads are bounded by the immutable
  escalation path, and execution ownership reads at most two indexed witnesses.
- Compress the validator or delete existing validation to fit the prior ceilings.
  That would manufacture room without simplifying ownership.
- Raise every layer ceiling. Only domain and infrastructure have a measured need.

## Trade-offs

**Gained:** one authority state model, one-to-one execution handles, live transaction
capabilities, bounded structural reads, and closed operational diagnostics.

**Sacrificed:** 100 additional domain lines and 350 additional infrastructure lines
of envelope until the next ratchet.

## Consequences

The line-budget fence carries the two new ceilings. The contracts and presentation
ceilings and the 500-line file limit do not move. Migration 12 adds only the two
tenant-scoped expression indexes required by the bounded structural lookups.

## Revisit When

At the next ratchet gate, reduce both ceilings to measured size plus the bounded
correction buffer required by the next ratified prompt.
