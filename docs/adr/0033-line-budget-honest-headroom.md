# ADR-0033: Line-budget ceilings carry bounded, measured headroom

**Status:** Accepted
**Date:** 2026-07-28
**Deciders:** Build agent (reversible, logged per the decision protocol; D-078)
**Relates to:** ADR-0018, ADR-0029, ADR-0030, ADR-0032, charter #1/#4/#7/#14
**Amends:** ADR-0030 and ADR-0032 ceiling values

## Context

The per-layer ceilings in effect after the prompt-6 review rounds were contracts
3,900, domain 1,200, infrastructure 3,200. Measured with the fence's own
algorithm (`shippedSourceFiles()` and `split("\n").length`) at the close of those
rounds, the layers stood at:

| Layer | Measured | Ceiling | Headroom |
|---|---|---|---|
| contracts | 3,892 | 3,900 | 8 |
| domain | 1,200 | 1,200 | **0** |
| infrastructure | 3,200 | 3,200 | **0** |

Two layers sat at exactly zero headroom. `budgetViolations` fails on `> ceiling`,
so a single added line in either layer failed `pnpm test` on a ceiling unrelated
to the change being made, and the only remedy was an ADR amendment rather than a
code change.

That is not the discipline ADR-0018 intended, and it had a measurable cost: it is
what compressed the doc comments in `contracts/metric.ts` and
`contracts/provenance.ts` and deleted the `migrations.ts` header holding the
timestamptz/ISO-boundary rationale that `AGENTS.md` still points readers at. A
ceiling that cannot absorb a correction does not constrain scope; it converts
review findings into documentation deletions.

ADR-0030 additionally justified its 3,000 to 3,200 raise with "the resulting
infrastructure measures 3,067 lines", 133 lines below what actually shipped. Its
stated basis did not match the tree.

## Decision

Set the ceilings to the smallest rounded envelopes that leave bounded room for
correction:

| Layer | Baseline | New ceiling | Headroom |
|---|---|---|---|
| contracts | 3,892 | 4,000 | 108 |
| domain | 1,200 | 1,250 | 50 |
| infrastructure | 3,200 | 3,300 | 100 |

Presentation is unchanged at 6,000 (ADR-0012).

### What this change itself consumed

The corrections landing in the same PR as this amendment are themselves subject to
it, and the record has to say so rather than leave the headroom column above
reading as though it still applies. Measured after those corrections:

| Layer | Measured now | Ceiling | Headroom remaining |
|---|---|---|---|
| contracts | 3,935 | 4,000 | 65 |
| domain | 1,221 | 1,250 | 29 |
| infrastructure | 3,295 | 3,300 | 5 |

Infrastructure spent 95 of its 100 new lines immediately, on two changes this
same review round REQUIRED: the migration virginity proof
(`assertManagedSchemaEmpty`, which refuses a restored dump whose ledger is
missing before any mutation) and the restored `migrations.ts` timestamptz/ISO
boundary header. Both are load-bearing. Neither is scope creep.

The consequence is that infrastructure is nearly back where it started and the
next infrastructure correction will need another measured amendment. That is the
honest state, recorded here deliberately rather than discovered later: this ADR
sets the ceilings the supervising ruling named, and does not pretend the tree has
room it does not have.

Everything else about the rule is unchanged and deliberately so:

- The fence stays fail-closed, including the zero-measured-bucket check that
  fails a renamed layer path rather than passing vacuously.
- Any FURTHER increase remains a measured ADR amendment, never a code change.
- The ratchet-down obligation at the next wave gate stands.

ADR-0030's Context is corrected in the same change to state what actually
shipped.

## Scope limit

These ceilings are BRANCH-LOCAL to the prompt-6 line. They are measured against
this tree only and make no claim about the combined prompt-6 and prompt-7 union.
Reconciling the two branches' budgets is a named pre-Wave-C gate and is not
discharged here.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Keep the zero-headroom ceilings | Every subsequent review correction would have to either delete documentation or amend an ADR. That is what already happened. |
| Compress code to manufacture headroom | The compression already done for this reason is being reversed, not extended. Deleting rationale to fit a number makes the tree less auditable, not smaller. |
| Raise to a large round number (5,000 / 2,000 / 4,000) | Headroom that large stops being a budget. The point is bounded room for correction, not room for a wave of new scope. |
| Drop the per-layer split for one aggregate | Charter #1 says per-layer; an aggregate lets one layer balloon under another's slack. |

## Trade-offs

**Gained:** review corrections can land without an ADR round-trip; documentation
deleted under budget pressure can be restored.

**Sacrificed:** 258 lines of total platform headroom across three layers, and the
ratchet-down at the next gate has further to travel.

## Consequences

`src/__tests__/fitness/line-budget.test.ts` records the new ceilings and the
measured baseline in the same change. The `migrations.ts` timestamptz/ISO-boundary
header is restored in the same change, since budget pressure was the reason it
was removed.

## Revisit When

At the next Wave A/C gate: re-measure and ratchet every layer down to actual plus
the buffer the next ratified prompt requires, and reconcile against the prompt-7
branch as part of the named pre-Wave-C gate.
