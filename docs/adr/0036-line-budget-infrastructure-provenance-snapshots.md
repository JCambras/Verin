# ADR-0036: Infrastructure ceiling raised to 3,450 for provenance and failure snapshots

**Status:** Accepted
**Date:** 2026-07-29
**Deciders:** Build agent (reversible, logged per the decision protocol; D-088)
**Relates to:** ADR-0018, ADR-0033, ADR-0034, ADR-0035, charter #1/#4/#7/#14
**Amends:** ADR-0034's infrastructure ceiling only

## Context

The infrastructure layer had 10 lines of headroom before this review. F038-F044
exposed shared defects in migration-ledger validation, module and SQL provenance,
multi-action authorization, stable authority reads, and unknown-error handling.

The corrections belong at the infrastructure boundaries that own migrations and
failure classification. They require exact ledger-prefix validation before
mutation and one guarded error-metadata classifier used by both audited writes
and account-opening duplicate classification. Raw captured fields remain local;
callers receive only a normalized AppError, validated SQLSTATE, boolean
PII-violation classification, and safe reason.

## Decision

Raise the infrastructure ceiling from 3,400 to 3,450. Contracts remains 4,050,
domain remains 1,250, and presentation remains 6,000.

Measured with the fence's own algorithm after all F038-F044 corrections:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 4,017 | 4,050 | 33 |
| domain | 1,250 | 1,250 | 0 |
| infrastructure | 3,437 | 3,450 | 13 |
| presentation | 918 | 6,000 | 5,082 |

This is the smallest rounded infrastructure envelope above the measured tree.
The other ceilings do not move.

## Scope limit

These ceilings remain branch-local to the prompt-6 line. This decision does not
reconcile the prompt-6 and prompt-7 branches or discharge the named pre-Wave-C
budget gate.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Keep migration rows as an unordered version set | A gapped or renamed restored ledger can skip tenant-isolation migrations. |
| Classify driver failures independently at each catch site | Multiple guarded-read implementations can drift and reread hostile accessors. |
| Remove validation or boundary documentation to fit 3,400 | That would weaken the correction and manufacture headroom rather than remove duplication. |
| Raise infrastructure above 3,450 | More than 13 lines of headroom is not justified by this correction. |
| Raise contracts or domain too | Their measurements do not require another amendment in this round. |

## Trade-offs

**Gained:** exact migration history validation and one read-once driver-metadata
boundary shared by audited writes, safe reasons, and duplicate-submit handling.

**Sacrificed:** 50 additional infrastructure lines of branch-local capacity.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` carries the new infrastructure ceiling
and exact final measurement. Migration-history and hostile-accessor regressions
enforce the added behavior.

## Revisit When

At the next Wave A/C gate, re-measure and ratchet every layer to actual plus the
buffer required by the next ratified prompt, while reconciling the prompt-7 branch.
