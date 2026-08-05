# ADR-0039: Contracts ceiling for decision-result tenant closure

**Status:** Accepted
**Date:** 2026-08-04
**Deciders:** Build agent (reversible, logged per the decision protocol; D-107)
**Relates to:** ADR-0018, ADR-0029, ADR-0033, ADR-0035, charter #1/#4/#7/#14
**Amends:** ADR-0035's contracts ceiling only

## Context

The decision-core tenant fence sampled only scoped references present in one legal
fixture. Schema-derived occurrence coverage exposed two real gaps at the standalone
`DecisionResultSchema` boundary: a blocked result could mix resolving-evidence
tenants, and a prohibited result could mix its governing source and scope tenant.

The correction requires one shared result-level refinement that closes each union
arm over the tenant anchors already validated inside its nested contracts. This is
runtime contract ownership, not fence-only growth.

## Decision

Raise the contracts ceiling from 4,050 to 4,100. Domain remains 1,350,
infrastructure remains 3,550, and presentation remains 6,000.

Measured with the fence's own algorithm after the review corrections:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,062 | 4,100 | 38 |
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
| Keep fixture-derived coverage | Optional and unselected union paths could remain untested while the fence reported complete coverage. |
| Add only synthetic probes | The stronger fence proved that the shipped standalone result schema accepted real mixed-tenant states. |
| Rely on `DecisionRecordSchema` | Callers may parse and persist a `DecisionResult` before a record exists, so its exported boundary must be safe independently. |
| Remove documentation or compress the refinement to fit 4,050 | That would manufacture room without simplifying ownership. |
| Raise contracts above 4,100 | More than 38 lines of headroom is not justified by this correction. |

## Trade-offs

**Gained:** every scoped-reference occurrence must have a legal behavioral probe,
and every standalone decision-result union arm rejects mixed-tenant assembly.

**Sacrificed:** 50 additional contracts lines of branch-local capacity.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` carries the new contracts ceiling and
exact final measurement. The tenant-scope fence derives occurrences from schema
structure, including optional and union paths, and fails when its probe matrix does
not exercise one.

## Revisit When

At the next Wave A/C gate, re-measure and ratchet every layer to actual plus the
buffer required by the next ratified prompt, while reconciling the prompt-7 branch.
