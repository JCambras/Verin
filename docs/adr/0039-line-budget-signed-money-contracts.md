# ADR-0039: Contracts ceiling for signed money authorities

**Status:** Accepted
**Date:** 2026-08-04
**Deciders:** Build agent (reversible, logged per the decision protocol; D-125)
**Relates to:** ADR-0018, ADR-0033, ADR-0035, D-102, D-103, charter #1/#3/#4
**Amends:** ADR-0035's contracts ceiling only

## Context

The signed-money correction added three contract-owned authorities: exact money arithmetic and
units, canonical execution-status planes, and metric formatting through the shared money unit. The
contracts layer measures 4,111 lines against its 4,050 ceiling. The default test command therefore
fails even though each authority is shipped and used.

These contracts prevent the demo, fixtures, status vocabulary, and renderer from carrying separate
truth sources. Moving them outward would violate ownership. Compressing their validation and
rationale would manufacture room without reducing responsibility.

## Decision

Raise the contracts ceiling from 4,050 to 4,150. Domain remains 1,350, infrastructure remains
3,550, and presentation remains 6,000.

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,111 | 4,150 | 39 |
| domain | 1,298 | 1,350 | 52 |
| infrastructure | 3,484 | 3,550 | 66 |
| presentation | 984 | 6,000 | 5,016 |

This is the smallest rounded contracts envelope above the measured tree. No other ceiling moves.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Keep the 4,050 ceiling | The shipped tree remains red and the fence's real-baseline companion fails. |
| Duplicate arithmetic or status values outside contracts | That restores the truth drift these authorities close. |
| Compress validation and documentation below the ceiling | Line count falls without simplifying ownership or behavior. |
| Raise contracts above 4,150 | More headroom is not justified by the measured correction. |

## Consequences

`src/__tests__/fitness/line-budget.test.ts` carries the amended ceiling and exact measurements. Its
synthetic overage and empty-bucket companions remain unchanged. The ratchet-down obligation at the
next wave gate still applies.

## Revisit When

At the next Wave A/C gate, re-measure every layer and ratchet each ceiling to the approved scope and
required correction buffer.
