# ADR-0040: Contracts ceiling raised to 5,460 for the decision-primitive catalog

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Build agent (reversible, logged per the decision protocol; D-102)
**Relates to:** ADR-0018, ADR-0029, ADR-0035, ADR-0039, charter #1/#14
**Amends:** ADR-0035's contracts ceiling only

## Context

ADR-0029 landed the prompt-5 decision-core contracts and anticipated that prompts 8-9 would
re-baseline the contracts envelope again. Prompt 8's primitive catalog (ADR-0039) is contracts
material by definition - pure Zod schemas, published-key declarations, and total pure evaluate
functions - and its ratified content (six primitives with strict parameter/input schemas,
tenant-consistency refinements, falsification metadata, and deterministic calendar arithmetic)
does not fit the 4,050-line ceiling ADR-0035 set.

ADR-0018 is explicit: raising a platform ceiling is an ADR amendment with measured figures,
never a code change.

## Decision

Raise the contracts ceiling from 4,050 to 5,460. Domain remains 1,350, infrastructure remains
3,550, and presentation remains 6,000.

Measured with the fence's own algorithm after the prompt-8 catalog and its review hardening
landed:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 5,433 | 5,460 | 27 |
| domain | 1,298 | 1,350 | 52 |
| infrastructure | 3,484 | 3,550 | 66 |

The figure this ADR is amended to covers the catalog AS REVIEWED, not the first draft of it:
review of the shipped primitives added the horizon bound with its saturation contract, the
own-property slot lookup, the restriction-list uniqueness refinement, the precomputed ranking
positions, the exclusion trace `candidate-selection` now publishes on every outcome, and the
second rejection reason code that tells a real preference rank from a canonical tiebreak. Those
are the corrections the headroom exists to absorb, so they are inside the measured baseline
rather than a reason to shrink documentation - the first amendment (5,400 on a 5,353 baseline)
was measured before them and went red the moment they landed.

The headroom is bounded correction room (the ADR-0033 lesson: a zero-headroom ceiling converts
review findings into documentation deletions), not growth room. Prompt 9's AST schemas will need
their own measured amendment when they land - that is the ADR-0018 discipline working, not a
reason to over-provision now. Any FURTHER increase is likewise a measured ADR amendment, never a
code change.

## Revert path

Restore the 4,050 ceiling in `src/__tests__/fitness/line-budget.test.ts` alongside ADR-0039's
revert (the catalog is what the raise pays for).
