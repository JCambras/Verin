# ADR-0038: Domain and infrastructure ceilings for observability identifier provenance

**Status:** Accepted
**Date:** 2026-07-29
**Deciders:** Build agent (reversible, logged per the decision protocol; D-093)
**Relates to:** ADR-0013, ADR-0018, ADR-0033, ADR-0036, ADR-0037, charter #1/#3/#4/#7/#14
**Amends:** ADR-0033's domain ceiling and ADR-0036's infrastructure ceiling only

## Context

The observability identifier boundary treated canonical UUID shape as sufficient
trust to emit a value verbatim. Client-controlled household and execution IDs
could therefore carry account-shaped digits through logs and traces while the
observability vocabulary fence remained green.

The correction requires explicit runtime provenance for generated identifiers,
a tenant- and field-scoped keyed digest boundary for client-supplied identifiers,
and a fitness companion that rejects record identifiers minted outside those
reviewed paths. This responsibility belongs across the domain observability
contract and the infrastructure secret consumer.

## Decision

Raise the domain ceiling from 1,300 to 1,350 and the infrastructure ceiling from
3,450 to 3,550. Contracts remains 4,050 and presentation remains 6,000.

Measured with the fence's own algorithm after all review corrections:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,021 | 4,050 | 29 |
| domain | 1,298 | 1,350 | 52 |
| infrastructure | 3,484 | 3,550 | 66 |
| presentation | 918 | 6,000 | 5,082 |

These are the smallest rounded envelopes that leave bounded correction
headroom in both affected layers. The other ceilings do not move.

## Scope limit

These ceilings remain branch-local to the prompt-6 line. This decision does not
reconcile the prompt-6 and prompt-7 branches or discharge the named pre-Wave-C
budget gate.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Keep the UUID shape fast path | Shape is classification, not provenance, so request data could still be emitted verbatim. |
| Redact every client identifier | Failure audits would remain safe, but operators would lose stable tenant-scoped correlation. |
| Use an unkeyed digest | Low-entropy or known identifiers could become a recovery oracle. |
| Keep domain at 1,300 or raise infrastructure only to 3,500 | Two and sixteen lines of headroom would recreate pressure to compress the next legitimate correction. |
| Remove documentation or combine statements to fit the prior ceilings | That would manufacture room without simplifying ownership. |

## Trade-offs

**Gained:** generated identifiers retain useful observability, request-derived
identifiers gain stable non-reversible tenant-scoped correlation, and mint
provenance is structurally fenced.

**Sacrificed:** 50 additional domain lines and 100 additional infrastructure
lines of branch-local capacity.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` carries both new ceilings and the
exact final measurements. The observability vocabulary fence refuses generated
or keyed record identifier mints outside their reviewed provenance boundaries.
Integration regressions prove that request-derived identifiers are never
emitted verbatim and failure auditing continues with the original record ID in
the tamper-evident audit chain.

## Revisit When

At the next Wave A/C gate, re-measure and ratchet every layer to actual plus the
buffer required by the next ratified prompt, while reconciling the prompt-7 branch.
