# ADR-0040: Contracts ceiling for complete tenant-boundary closure

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Build agent (reversible, logged per the decision protocol; D-108)
**Relates to:** ADR-0018, ADR-0029, ADR-0033, ADR-0039, charter #1/#4/#7/#14
**Amends:** ADR-0039's contracts ceiling only

## Context

The tenant-scope fence discovered only schemas containing a scoped-reference
collection or catchall, and recursive occurrence traversal stopped at the first
cycle. Direct multi-reference boundaries and recursive child references could
therefore remain outside behavioral mutation coverage.

Complete schema-derived coverage exposed runtime ownership gaps in direct,
composite, and recursive contracts. A prohibition could mix its source and scope,
a precedence step could compare sources from different tenants, a proceed result
could combine internally coherent recommendation, authority, and execution
subtrees from different tenants, a resolution state could combine ambiguity and
gap references from different tenants, and an explanation tree could contain an
internally coherent child from another tenant.

These constraints belong at each exported contract boundary rather than only in
the enclosing decision record.

## Decision

Raise the contracts ceiling from 4,100 to 4,150. Domain remains 1,350,
infrastructure remains 3,550, and presentation remains 6,000.

Measured with the fence's own algorithm after the review corrections:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,112 | 4,150 | 38 |
| domain | 1,298 | 1,350 | 52 |
| infrastructure | 3,484 | 3,550 | 66 |
| presentation | 918 | 6,000 | 5,082 |

This is the smallest rounded contracts envelope that leaves bounded correction
headroom. The other ceilings do not move.

## Scope limit

These ceilings remain branch-local to the prompt-6 line. This decision does not
reconcile the prompt-6 and prompt-7 branches or discharge the named pre-Wave-C
budget gate.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Keep collection-only discovery | Exported objects containing multiple direct tenant references would remain outside the registry. |
| Stop occurrence traversal at the first recursive edge | Every legal explanation probe could leave child nodes empty while the fence reported complete coverage. |
| Validate only enclosing records | Each exported nested schema is independently callable and must reject mixed-tenant assembly at its own boundary. |
| Mutate one reference at a time | An internally coherent foreign subtree could evade a parent boundary that validates only its immediate node. |
| Remove documentation or compress refinements to fit 4,100 | That would manufacture room without simplifying ownership. |
| Raise contracts above 4,150 | More than 38 lines of headroom is not justified by this correction. |

## Trade-offs

**Gained:** every direct and recursive tenant occurrence requires a legal probe,
coherent foreign subtrees are mutation-tested, and every affected exported
contract rejects mixed-tenant assembly independently.

**Sacrificed:** 50 additional contracts lines of branch-local capacity.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` carries the new contracts ceiling and
exact final measurement. The tenant-scope fence discovers direct references,
requires one recursive probe depth, and mutates both individual references and
coherent nested groups.

## Revisit When

At the next Wave A/C gate, re-measure and ratchet every layer to actual plus the
buffer required by the next ratified prompt, while reconciling the prompt-7 branch.
