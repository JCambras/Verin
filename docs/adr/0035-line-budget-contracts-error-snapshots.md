# ADR-0035: Contracts ceiling raised to 4,050 for normalized error snapshots

**Status:** Accepted
**Date:** 2026-07-29
**Deciders:** Build agent (reversible, logged per the decision protocol; D-087)
**Relates to:** ADR-0018, ADR-0033, ADR-0034, charter #1/#4/#7/#14
**Amends:** ADR-0033's contracts ceiling only

## Context

The contracts layer was at its 4,000-line ceiling before this review. F037 exposed
a failure-boundary flaw in `isAppError`: it validated one accessor read and
returned the original object, allowing downstream response and audit paths to read
stateful or throwing `code` and `message` accessors again.

The correction belongs in `src/contracts/errors.ts`, which owns `AppError` and
the HTTP response mapping. It replaces recognition with a guarded snapshot that
reads `code`, `message`, and optional context once, validates them, and returns a
new frozen value. Every downstream path consumes that snapshot.

## Decision

Raise the contracts ceiling from 4,000 to 4,050. Domain remains 1,250,
infrastructure remains 3,400, and presentation remains 6,000.

Measured with the fence's own algorithm after all F032-F037 corrections:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,017 | 4,050 | 33 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,390 | 3,400 | 10 |
| presentation | 918 | 6,000 | 5,082 |

This is the smallest rounded contracts envelope above the measured tree.
The other ceilings do not move.

## Scope limit

These ceilings remain branch-local to the prompt-6 line. This decision does not
reconcile the prompt-6 and prompt-7 branches or discharge the named pre-Wave-C
budget gate.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Keep the original accessor-backed object | Validation would still race later reads and could leak or throw. |
| Move normalization to each infrastructure caller | Multiple implementations would drift and could reread the hostile object. |
| Remove validation or contract documentation to fit 4,000 | That would weaken the boundary and manufacture headroom rather than reduce duplication. |
| Raise contracts above 4,050 | More than 33 lines of headroom is not justified by this correction. |
| Raise domain or infrastructure too | Their measurements do not require another amendment in this round. |

## Trade-offs

**Gained:** one closed, read-once error boundary shared by response, audit, store,
identity, workflow, and wiring paths.

**Sacrificed:** 50 additional contracts lines of branch-local capacity.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` carries the new contracts ceiling and
the exact final measurement. Stateful and throwing accessor regressions enforce
the snapshot behavior.

## Revisit When

At the next Wave A/C gate, re-measure and ratchet every layer to actual plus the
buffer required by the next ratified prompt, while reconciling the prompt-7 branch.
