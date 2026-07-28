# ADR-0034: Infrastructure ceiling raised to 3,400 on a re-measured baseline

**Status:** Accepted
**Date:** 2026-07-28
**Deciders:** Build agent (reversible, logged per the decision protocol; D-079)
**Relates to:** ADR-0018, ADR-0030, ADR-0032, ADR-0033, charter #1/#4/#7/#14
**Amends:** ADR-0033's infrastructure ceiling only

## Context

ADR-0033 set contracts 4,000 / domain 1,250 / infrastructure 3,300 and recorded,
honestly, that the corrections landing alongside it spent 95 of infrastructure's
100 new lines immediately - leaving 5. It said in as many words that "the next
infrastructure correction will need another measured amendment."

That correction arrived in the very next review round. Two of its findings land in
`src/infrastructure/`:

- the managed-object probe in `store/migrations.ts` must qualify its `pg_trigger`
  clause to `current_schema()`, or a Verin schema sharing a managed Postgres with a
  neighbour that happens to own a same-named trigger refuses to bootstrap and tells
  the operator to restore a ledger that never existed;
- the rationale for why that qualification is load-bearing has to be written down
  next to it, or the next reader removes it.

Separately, the enforcing code itself was not telling the truth. The comment above
`CEILINGS` in `src/__tests__/fitness/line-budget.test.ts` stated "Headroom is
108 / 50 / 100 and no more" - the PRE-change baseline from ADR-0033's decision
table, not the post-change figures in the same ADR's own follow-up table. A reader
of the fence was told there were 100 infrastructure lines of room where there were
5.

## Decision

Raise the infrastructure ceiling from 3,300 to 3,400. Contracts stays at 4,000 and
domain stays at 1,250. Presentation is unchanged at 6,000 (ADR-0012).

Measured with the fence's own algorithm (`shippedSourceFiles()` and
`split("\n").length`) at this commit, after the corrections this round:

| Layer | Measured | Ceiling | Headroom |
|---|---|---|---|
| contracts | 3,944 | 4,000 | 56 |
| domain | 1,231 | 1,250 | 19 |
| infrastructure | 3,298 | 3,400 | 102 |
| presentation | 918 | 6,000 | 5,082 |

Infrastructure sits within one line of ADR-0033's 3,300 with the round's own
corrections applied and `store/migrations.ts` already trimmed to the per-file
ceiling. That is the same zero-headroom position ADR-0033 was written to end, one
layer over: the next correction has nowhere to go.

The in-code comment above `CEILINGS` is corrected in the same change to state these
measured figures rather than a stale table, and the ADR reference there is updated
to point here.

Domain is the layer to watch next: 19 lines. It is left at 1,250 deliberately - the
supervising ruling raised infrastructure only, and manufacturing domain headroom
speculatively is the opposite of the measured discipline ADR-0033 restored. When
domain needs room, it gets its own measured amendment, on its own evidence.

Everything else about the rule is unchanged and deliberately so:

- The fence stays fail-closed, including the zero-measured-bucket check that fails
  a renamed layer path rather than passing vacuously.
- Any FURTHER increase remains a measured ADR amendment, never a code change.
- The ratchet-down obligation at the next wave gate stands.

## Scope limit

These ceilings remain BRANCH-LOCAL to the prompt-6 line, measured against this tree
only. They make no claim about the combined prompt-6 and prompt-7 union;
reconciling the two branches' budgets remains a named pre-Wave-C gate and is not
discharged here.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Delete the probe's rationale comment to fit 3,300 | Exactly the pathology ADR-0033 was written to end: converting review findings into documentation deletions. |
| Raise every layer "while we are here" | Headroom without evidence is not a budget. Each layer moves on its own measurement. |
| Raise infrastructure to 3,500+ | 96 lines is bounded room for correction; more is room for a wave of new scope. |
| Leave the stale "108 / 50 / 100" comment | The enforcing code is what a reader trusts. A ceiling comment that misreports headroom by 20x is worse than none. |

## Trade-offs

**Gained:** this round's required infrastructure corrections land, and the fence's
own comment now matches the tree it enforces.

**Sacrificed:** 100 more lines of platform headroom, and the ratchet-down at the
next gate has that much further to travel.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` carries the new infrastructure ceiling
and the corrected measured baseline in the same change.

## Revisit When

At the next Wave A/C gate: re-measure and ratchet every layer down to actual plus
the buffer the next ratified prompt requires, and reconcile against the prompt-7
branch as part of the named pre-Wave-C gate.
