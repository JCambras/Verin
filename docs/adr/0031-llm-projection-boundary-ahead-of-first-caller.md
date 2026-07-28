# ADR-0031: The evidence-to-LLM projection boundary lands ahead of its first caller

**Status:** Accepted
**Date:** 2026-07-27
**Deciders:** Supervising authority (decision key `prompt6-askuser`, 2026-07-27); build agent records it
**Relates to:** charter #5, v3 §15.1, v3 invariant 1, ADR-0006, ADR-0032/0030, D-070

## Context

Charter #5 forbids anything built-but-not-shipped, and that rule already cost
this branch the `piiSafe` logger helper: a convenience wrapper with no consumer,
deleted so it can re-land with its first real caller at prompt 13.

`src/infrastructure/pii/llm-projection.ts` and its domain resolver
`src/domain/pii/projection-resolution.ts` look superficially similar — their
only current references are tests, because the model client deliberately does
not exist until prompt 13 — but they are not the same kind of thing.

The prompt-6 specification (v3 §15.1) names the projection layer explicitly:
"scrubbing lives only in the LLM adapter AND the evidence-to-LLM projection
layer." v3 invariant 1 ("no PII-bearing type is reachable from `llm/`") is a
CONTRACT about a boundary, and a boundary only exists once both of its sides
exist. Landing `contracts/tokenized.ts`, `infrastructure/pii/tokenize.ts`, and
`infrastructure/llm/request-schema.ts` without the projection layer would leave
the invariant provable only for a boundary nothing crosses; the first LLM
integration would then be free to invent its own masking path beside the fence
rather than through it.

## Decision

Keep the projection layer, and record it here as a DELIBERATE, reviewed
exception to charter #5's shipping rule rather than an accident of scope.

The distinction that governs future cases:

| | `piiSafe` (deleted) | the projection layer (kept) |
|---|---|---|
| What it was | a convenience helper wrapping an existing safe path | a boundary the ratified spec names |
| What its absence costs | nothing; callers use the underlying API | v3 invariant 1 becomes a property of an unused seam |
| Who requires it | no one | v3 §15.1 / prompt 6 acceptance |
| When it re-lands | with its first consumer | already landed; prompt 13 supplies the consumer |

A capability is exempt from "nothing built-but-not-shipped" only when a ratified
specification names it as a required BOUNDARY and a fence proves the boundary
holds in the same PR. Convenience code never qualifies.

## Enforcement in the same PR (charter #1)

- `src/__tests__/fitness/llm-pii-boundary.test.ts` proves no PIIBearing-marked
  module is import-reachable from `src/infrastructure/llm/`.
- `src/__tests__/fitness/tokenized-factory-only.test.ts` proves `Tokenized<T>`
  is constructible only inside `src/infrastructure/pii/tokenize.ts`.
- `src/__tests__/unit/llm-boundary.test.ts` exercises `projectForLlm`
  end-to-end in both directions (realistic prose accepted once its sensitive
  spans are tokenized; raw names, account numbers, and 9-18 digit runs refused).

## Scope: the projection is deliberately ONE-WAY in prompt 6

`projectForLlm` returns only the `MaskedLlmRequest`. The raw values it bound are
used for masking and then discarded: there is no un-masking API, and the caller
cannot learn which entity landed in which slot. That is intentional, not an
oversight. Prompt 6's contract is "nothing unmasked reaches a model"; the
inverse direction — binding a model's slot-shaped answer back to real records —
belongs to the consumer that will act on that answer, which arrives at prompt 13.

Designing the binding API now would mean designing it with no consumer to
constrain it, and any shape that returns the raw values (sealed or not) widens
the very surface this boundary narrows. Prompt 13 owns that API and the decision
of whether bindings travel back through this function, through a separate
resolver, or through caller-supplied candidate→slot pairs. Until then
`request-schema.ts`'s "binding to real records happens outside the model" means
exactly that: outside the model, and outside this layer.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Delete the projection layer, re-land at prompt 13 | v3 invariant 1 would be ACTIVE against a seam no code crosses, and prompt 13 could route around it. |
| Keep it but mark invariant 1 not-yet-active | The registry stores activation only; faking it not-active to match missing code is exactly the fake-green the charter forbids. |
| Add a throwaway caller so knip sees a consumer | Mock theater; a fake consumer proves less than an honest ADR. |
| Return the slot bindings now so prompt 13 finds them ready | Designs an un-masking API with no consumer to constrain it, and widens the surface this boundary exists to narrow. |

## Trade-offs

**Gained:** the zero-PII reachability and factory-only contracts exist and are
adversarially proven before any model integration begins.

**Sacrificed:** ~370 lines carried ahead of their first production caller, and
the corresponding share of the ADR-0032/0030 line-budget headroom.

## Revisit When

Prompt 13 lands the model client. At that point `projectForLlm` gains its
production caller, this exception expires, the binding/un-masking API is
designed against a real consumer, and the ratchet in ADR-0018 applies to
whatever the boundary actually costs.
