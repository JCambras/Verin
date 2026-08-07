# ADR-0054: Contracts ceiling 6,600 and domain ceiling 4,250 for the policy AST and interpreter

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

Raise the contracts ceiling from 6,110 to 6,600 and the domain ceiling from 1,650 to 4,250.
Infrastructure stays 7,840 and presentation stays 6,000.

Measured with the fence's own algorithm on the tree AS IT LANDS - that is, after the prompt-9
module was split under the 500-line per-file ceiling AND after the two review rounds that
followed it (round one: the atomic Phase-0 unwind of a rejected parameter write, the brand-tight
canonical temporal byte forms, the constant-scoped string/temporal widening rule, the single-walk
primitive-key reads; round two: the cascaded unwind of every primitive a rejected rule
configured, per-parameter rejection attribution, the one shared context-key precedence, the
fail-closed future-observation freshness read, and the constant-binding assembly guard). The
figures first recorded here were taken before round one and went stale by 20 lines in contracts
and 13 in domain, which is exactly what the line-budget fence header calls a ceiling with a
number nobody re-took. Round two added 101 domain lines and passed the 4,150 the first amendment
set, so the domain ceiling moves again rather than being paid for by deleting documentation or
folding readable code onto fewer lines (ADR-0050):

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 6,555 | 6,600 | 45 |
| domain | 4,164 | 4,250 | 86 |
| infrastructure | 7,786 | 7,840 | 54 |

What the raises pay for: `src/contracts/decision-core/policy.ts` (421 lines - the ratified
grammar as strict versioned Zod schemas) plus the `parameterSchemaKeys` /
`parameterConstantAdmissible` helpers in `src/contracts/primitives/values.ts`; and the nine-file
`src/domain/policy/` module (2,583 lines: load 219, load-checks 494, conflict 384, facts 280,
evaluate 428, evaluate-primitives 363, registries 146, temporal 121, trace 148). The per-file
ceiling forced the load/load-checks and evaluate/evaluate-primitives splits, which cost two
module headers - the same trade D-175 recorded for the corpus intake module.

The headroom is bounded correction room for the review rounds ahead (the ADR-0033 lesson), not
growth room. Prompt 10's domain-configuration schema and prompt 16's evaluator completion will
need their own measured amendments - that is the discipline working, not a reason to
over-provision now.

## Revert path

Restore contracts 6,110 and domain 1,650 in `src/__tests__/fitness/line-budget.test.ts`
alongside ADR-0053's revert (the policy module is what the raises pay for).
