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

Raise the contracts ceiling from 6,110 to 6,650 and the domain ceiling from 1,650 to 4,500.
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
context-key-collision refusal; round four: the load-time reservation of the synthesized
blocker-code namespaces, the fail-closed non-scalar guard on the evidence and instruction fact
arms, the per-version grammar-schema memoization, and the integer-depth nesting walk; round six:
the catalog's key-shaping parameter declaration, the load check that refuses a write to one, and
the `load-effects.ts` split the per-file ceiling forced to hold it). The
figures first recorded here were taken before round one and
went stale by 20 lines in contracts and 13 in domain, which is exactly what the line-budget fence
header calls a ceiling with a number nobody re-took. Each round since has re-taken them rather
than paying for the correction by deleting documentation or folding readable code onto fewer
lines (ADR-0050); round three left the domain ceiling with TWO lines of headroom, which is the
ADR-0033 failure mode itself, so both ceilings moved to carry real correction room. Round four
then went stale the same way - it added 80 domain and 17 contracts lines without re-taking either
number - so round five RE-MEASURED at 6,584 and 4,328 and left both ceilings alone, naming the
22 remaining domain lines rather than banking them.

The SIXTH review round spent them. Making key-shaping parameters non-writable
(ruling `p9-key-shaping-params`) added the catalog declaration in contracts and, in domain, the
load check plus the module the 500-line per-file ceiling forced: `load-checks.ts` sat at 495 with
the whole of `checkEffects` in it, so the new check had nowhere to land. `load-effects.ts` is the
seam D-183 predicted - every check that reads an effect, including check 2's reserved-namespace
half, which the per-file ceiling had stranded in `load.ts`. That costs one module header and one
import block, which is why the domain ceiling moves rather than the code shrinking to fit
(ADR-0050). Amended a fifth time: domain 4,500 against a re-measured 4,400, contracts unmoved at
6,650 against 6,602.

| Layer | Measured | Ceiling | Headroom |
|---|---:|---:|---:|
| contracts | 6,602 | 6,650 | 48 |
| domain | 4,400 | 4,500 | 100 |
| infrastructure | 7,786 | 7,840 | 54 |

What the raises pay for: `src/contracts/decision-core/policy.ts` (449 lines - the ratified
grammar as strict versioned Zod schemas) plus the `parameterSchemaKeys` /
`parameterConstantAdmissible` helpers and the `keyShapingParameters` declaration in
`src/contracts/primitives/values.ts` (262); and the ten-file `src/domain/policy/` module (2,809
lines: load 277, load-checks 377, load-effects 212, conflict 383, facts 292, evaluate 443,
evaluate-primitives 376, registries 155, temporal 120, trace 174). The per-file ceiling forced the
load/load-checks, load-checks/load-effects, and evaluate/evaluate-primitives splits, which cost
three module headers - the same trade D-175 recorded for the corpus intake module.

The headroom is bounded correction room for the review rounds ahead (the ADR-0033 lesson), not
growth room. Prompt 10's domain-configuration schema and prompt 16's evaluator completion will
need their own measured amendments - that is the discipline working, not a reason to
over-provision now.

## Revert path

Restore contracts 6,110 and domain 1,650 in `src/__tests__/fitness/line-budget.test.ts`
alongside ADR-0053's revert (the policy module is what the raises pay for).
