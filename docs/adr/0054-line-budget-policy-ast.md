# ADR-0054: Contracts ceiling 6,650 and domain ceiling 4,350 for the policy AST and interpreter

**Status:** Accepted
**Date:** 2026-08-07
**Deciders:** Build agent (reversible, logged per the decision protocol; D-178)
**Relates to:** ADR-0018, ADR-0040, ADR-0051, ADR-0053, charter #1/#14
**Amends:** ADR-0051's contracts ceiling and ADR-0041's domain ceiling

## Context

ADR-0040 said it plainly: "Prompt 9's AST schemas will need their own measured amendment when
they land - that is the ADR-0018 discipline working." They landed (ADR-0053). The grammar module
and the schema-introspection helpers are contracts material; the loader, conflict prover, facts
plane, four-phase evaluator, temporal math, and trace are domain material - the first real growth
of the domain layer since the ledger projection, and the reason its ceiling moves furthest.

ADR-0018 is explicit: raising a platform ceiling is an ADR amendment with measured figures,
never a code change.

## Decision

Raise the contracts ceiling from 6,110 to 6,650 and the domain ceiling from 1,650 to 4,350.
Infrastructure stays 7,840 and presentation stays 6,000.

Measured with the fence's own algorithm on the tree AS IT LANDS - that is, after the prompt-9
module was split under the 500-line per-file ceiling AND after the three review rounds that
followed it (round one: the atomic Phase-0 unwind of a rejected parameter write, the brand-tight
canonical temporal byte forms, the constant-scoped string/temporal widening rule, the single-walk
primitive-key reads; round two: the cascaded unwind of every primitive a rejected rule
configured, per-parameter rejection attribution, the one shared context-key precedence, the
fail-closed future-observation freshness read, and the constant-binding assembly guard; round
three: the discriminated predicate union, the load-time structural nesting bound, fail-closed
rejection implication, the total evidence-requirement comparator, and the structural
context-key-collision refusal). The figures first recorded here were taken before round one and
went stale by 20 lines in contracts and 13 in domain, which is exactly what the line-budget fence
header calls a ceiling with a number nobody re-took. Each round since has re-taken them rather
than paying for the correction by deleting documentation or folding readable code onto fewer
lines (ADR-0050); round three left the domain ceiling with TWO lines of headroom, which is the
ADR-0033 failure mode itself, so both ceilings move to carry real correction room:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 6,567 | 6,650 | 83 |
| domain | 4,248 | 4,350 | 102 |
| infrastructure | 7,786 | 7,840 | 54 |

What the raises pay for: `src/contracts/decision-core/policy.ts` (433 lines - the ratified
grammar as strict versioned Zod schemas) plus the `parameterSchemaKeys` /
`parameterConstantAdmissible` helpers in `src/contracts/primitives/values.ts`; and the nine-file
`src/domain/policy/` module (2,667 lines: load 269, load-checks 494, conflict 384, facts 281,
evaluate 437, evaluate-primitives 377, registries 156, temporal 121, trace 148). The per-file
ceiling forced the load/load-checks and evaluate/evaluate-primitives splits, which cost two
module headers - the same trade D-175 recorded for the corpus intake module.

The headroom is bounded correction room for the review rounds ahead (the ADR-0033 lesson), not
growth room. Prompt 10's domain-configuration schema and prompt 16's evaluator completion will
need their own measured amendments - that is the discipline working, not a reason to
over-provision now.

## Revert path

Restore contracts 6,110 and domain 1,650 in `src/__tests__/fitness/line-budget.test.ts`
alongside ADR-0053's revert (the policy module is what the raises pay for).
