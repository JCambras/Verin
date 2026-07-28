# ADR-0030: Line-budget amendment for prompt-6 review hardening

**Status:** Accepted
**Date:** 2026-07-27
**Deciders:** Build agent (reversible, logged per the decision protocol; D-047)
**Relates to:** ADR-0018, ADR-0032, charter #1/#7/#12/#14
**Amends:** ADR-0032 infrastructure ceiling

## Context

ADR-0032 raised the infrastructure ceiling to 3,000 lines for the initial
prompt-6 security boundaries. Eight adversarial review rounds then required
runtime-sealed authority, trusted LLM evidence schemas, safe observability
identifiers, and semantic fence analysis across callable forms. The resulting
infrastructure measures 3,067 lines. Compressing the security boundaries or
moving adapter behavior into the domain layer would reduce clarity and weaken
layer ownership.

## Decision

Raise the infrastructure ceiling from 3,000 to 3,200 lines. Contracts remain at
1,000, domain remains at 1,200, and presentation remains at 6,000.

The ratchet rule remains unchanged. The ceiling must be lowered to actual plus
buffer at the next wave gate.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Compress the security code below 3,000 | Dense boundary code is harder to audit and maintain. |
| Move LLM or observability adapters into domain | It would violate ownership and the inward dependency rule. |
| Raise every layer | Only infrastructure exceeded its reviewed envelope. |

## Trade-offs

**Gained:** readable boundary code and room for adversarial companion coverage.

**Sacrificed:** 200 additional lines of temporary infrastructure headroom.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` records the 3,200-line ceiling in
the same change. No other budget changes.

## Revisit When

At the next Wave A gate, lower infrastructure to actual plus the buffer required
by the next ratified prompt.
