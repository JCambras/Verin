# ADR-0054: Contracts ceiling 6,600 and domain ceiling 4,050 for the policy AST and interpreter

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

Raise the contracts ceiling from 6,110 to 6,600 and the domain ceiling from 1,650 to 4,050.
Infrastructure stays 7,840 and presentation stays 6,000.

Measured with the fence's own algorithm after the prompt-9 module landed, split under the
500-line per-file ceiling, and hardened through its own test round:

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 6,526 | 6,600 | 74 |
| domain | 3,936 | 4,050 | 114 |
| infrastructure | 7,786 | 7,840 | 54 |

What the raises pay for: `src/contracts/decision-core/policy.ts` (391 lines - the ratified
grammar as strict versioned Zod schemas) plus the `parameterSchemaKeys` /
`parameterConstantAdmissible` helpers in `src/contracts/primitives/values.ts`; and the nine-file
`src/domain/policy/` module (2,346 lines: load 212, load-checks 476, conflict 383, facts 255,
evaluate 366, evaluate-primitives 284, registries 134, temporal 89, trace 147). The per-file
ceiling forced the load/load-checks and evaluate/evaluate-primitives splits, which cost two
module headers - the same trade D-175 recorded for the corpus intake module.

The headroom is bounded correction room for the review rounds ahead (the ADR-0033 lesson), not
growth room. Prompt 10's domain-configuration schema and prompt 16's evaluator completion will
need their own measured amendments - that is the discipline working, not a reason to
over-provision now.

## Revert path

Restore contracts 6,110 and domain 1,650 in `src/__tests__/fitness/line-budget.test.ts`
alongside ADR-0053's revert (the policy module is what the raises pay for).
