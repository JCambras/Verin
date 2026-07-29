# ADR-0037: Domain ceiling raised to 1,300 for pre-load resume validation

**Status:** Accepted
**Date:** 2026-07-29
**Deciders:** Build agent (reversible, logged per the decision protocol; D-090)
**Relates to:** ADR-0018, ADR-0033, ADR-0035, ADR-0036, charter #1/#3/#4/#7
**Amends:** ADR-0033's domain ceiling only

## Context

The domain layer was exactly at its 1,250-line ceiling before this review. F050
exposed an ordering defect in `resumeFlow`: the capability-keyed execution load
occurred before the runtime `TenantContext` seal was validated. A forged context
with a matching organization could therefore load and return PII-bearing state
or start workflow work before a later persistence boundary rejected it.

The correction belongs at the domain workflow boundary that owns the unscoped
capability load. It validates the sealed context before loading the continuation,
returning state data, starting a step, or performing a write.

## Decision

Raise the domain ceiling from 1,250 to 1,300. Contracts remains 4,050,
infrastructure remains 3,450, and presentation remains 6,000.

Measured with the fence's own algorithm after all F050-F055 corrections:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,017 | 4,050 | 33 |
| domain | 1,251 | 1,300 | 49 |
| infrastructure | 3,437 | 3,450 | 13 |
| presentation | 918 | 6,000 | 5,082 |

This is the smallest rounded domain envelope above the measured tree. The other
ceilings do not move.

## Scope limit

These ceilings remain branch-local to the prompt-6 line. This decision does not
reconcile the prompt-6 and prompt-7 branches or discharge the named pre-Wave-C
budget gate.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Validate after `loadByToken` | The forged context could still expose foreign state or start work before refusal. |
| Scope `loadByToken` by organization | The signed token is the capability, and changing that port contract is broader than the runtime-seal defect. |
| Remove domain documentation or combine statements to fit 1,250 | That would manufacture headroom without simplifying ownership. |
| Raise domain above 1,300 | More than 49 lines of headroom is not justified by this correction. |
| Raise contracts or infrastructure too | Their measurements do not require another amendment in this round. |

## Trade-offs

**Gained:** the runtime tenant seal is proven before an unscoped continuation
load can expose PII or begin workflow work.

**Sacrificed:** 50 additional domain lines of branch-local capacity.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` carries the new domain ceiling and
the exact final measurement. The real PGlite tenant-isolation regression proves
that a forged matching-organization context performs no load, step, or write and
exposes no sentinel state.

## Revisit When

At the next Wave A/C gate, re-measure and ratchet every layer to actual plus the
buffer required by the next ratified prompt, while reconciling the prompt-7 branch.
