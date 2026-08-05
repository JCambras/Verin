# ADR-0039: Infrastructure ceiling for ledger review integrity

**Status:** Accepted
**Date:** 2026-08-04
**Deciders:** Build agent (reversible, logged per the decision protocol; D-123)
**Relates to:** ADR-0018, ADR-0033, charter #1/#4/#7/#13/#14
**Amends:** ADR-0033's infrastructure ceiling only

## Context

Review of the sibling decision ledger found that tenant authority stopped at raw
organization identifiers, the bounded L4 total trusted its anchor, retained
computed provenance used live parsing behavior, and confidence claims were not
checked against verified ancestry. Correcting these controls adds sealed authority
guards, an independently maintained tenant-total witness, a frozen retained parser,
and adversarial companions.

## Decision

Raise the infrastructure ceiling from 9,400 to 9,900 lines. Contracts remains
5,500, domain remains 1,600, and presentation remains 6,000.

Measured with the fence's own algorithm after the review corrections:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 5,344 | 5,500 | 156 |
| domain | 1,581 | 1,600 | 19 |
| infrastructure | 9,663 | 9,900 | 237 |
| presentation | 918 | 6,000 | 5,082 |

## Consequences

The line-budget fence carries the new infrastructure ceiling. The other layer
ceilings and the 500-line file limit do not move.

## Revisit When

At foundation close, ratchet each platform layer to measured size plus the bounded
correction buffer required by the next ratified prompt.
