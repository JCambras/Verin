# ADR-0040: Infrastructure ceiling for ledger parameter retention

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Build agent (reversible, logged per the decision protocol; D-125)
**Relates to:** ADR-0018, ADR-0033, ADR-0039, charter #1/#3/#4/#13
**Amends:** ADR-0039's infrastructure ceiling only

## Context

The immutable decision boundary classified string values by structural path but
did not inspect recommendation parameter keys or numeric values. The retained
decision schema deliberately admits a record of scalar parameters, so a raw PII
key or an account-shaped number could pass schema parsing and enter append-only
storage. Correcting the boundary requires an exact parameter registry and
value-specific validation before any source or ledger row is inserted.

The branch measured 9,898 infrastructure lines against the 9,900 ceiling before
the correction. The smallest structural fix adds a dedicated 21-line registry;
deleting existing validation or documentation to recover that space would weaken
the boundary and falsify the budget's purpose.

## Decision

Raise the infrastructure ceiling from 9,900 to 10,000 lines. Contracts remains
5,500, domain remains 1,600, and presentation remains 6,000.

Measured with the fence's own algorithm after the correction:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 5,456 | 5,500 | 44 |
| domain | 1,587 | 1,600 | 13 |
| infrastructure | 9,919 | 10,000 | 81 |
| presentation | 918 | 6,000 | 5,082 |

## Alternatives Rejected

- Delete existing ledger validation or documentation to stay below 9,900. This
  manufactures room by weakening auditability.
- Accept arbitrary parameter keys and scan only string values. Numeric account
  identifiers and PII-bearing keys remain persistable.
- Raise every layer ceiling. Only infrastructure changed and only that envelope
  has a measured need.

## Trade-offs

**Gained:** an exact immutable parameter boundary with permanent end-to-end
companions and bounded correction headroom.

**Sacrificed:** 100 lines of additional infrastructure envelope until the next
ratchet.

## Consequences

The line-budget fence carries the new infrastructure ceiling. The other layer
ceilings and the 500-line file limit do not move.

## Revisit When

At the next ratchet gate, reduce the infrastructure ceiling to measured size plus
the bounded correction buffer required by the next ratified prompt.
