# ADR-0058: Prompt 11c ratifies the tooling budget and records Gate B without claiming readiness

**Status:** Accepted (amends ADR-0018 and ADR-0055)
**Date:** 2026-08-12
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #1, #4, and #10; ADR-0023; ADR-0052; ADR-0055; v3 Prompt 11
**Informed by:** `docs/v3/verin-prompt-sequence-v3.md` Prompt 11 and Gate B; the Prompt 11 design report section 10.3; the Gate B honesty contract in that report section 6.2

## Context

The Prompt 11 design separated corpus generation, signed-case materialization, and budget plus registry
honesty into PR-11a, PR-11b, and PR-11c. The integrated tree no longer matches the design report's old
file and identifier proposals exactly:

- ADR-0052 and Prompt 11a already placed the generator under `scripts/**`, added a `tooling` aggregate
  to the existing line-budget fence, and extended the existing physical per-file fence to the same tree.
- ADR-0055 already registered Gate B in the current typed gate schema and pinned its complete requirement
  set. Its Prompt 11 requirement still said no corpus mechanism existed, even though the blocking
  `corpus` job now regenerates and byte-compares the merged corpus.
- Prompt 10 is not on the default branch, and Prompt 11b has not materialized the captain-signed golden
  cases as immutable replay fixtures with deterministic seeds, expected hashes, byte-identical
  regeneration, and validated domain-configuration and policy-version references. Gate B therefore
  cannot honestly read green.
- The charter map listed both budget fences under charter #10, but charter #1 is the obligation that
  explicitly requires per-layer and per-file ceilings. The extended tooling enforcement was live but
  not mapped to every obligation it governs.

The old proposed ADR and decision identifiers are not reusable. This is the next identity on the
current default branch and records the Prompt 11c slice against the tree that actually exists.

## Decision

### 1. `scripts/**` is one measured tooling envelope

The line-budget fence keeps one `tooling` bucket over the recursive executable-source walk rooted at
`scripts/`. The walk accepts the repository's closed executable extension set: TypeScript and
JavaScript in plain, JSX, ESM, and CommonJS forms. It is the same `toolingSourceFiles` discovery used by
the per-file fence, so the aggregate and physical limits cannot disagree about which script files exist.

The aggregate retains the same zero-total staleness rule as every platform bucket. An empty tooling
measurement is a failure, not a zero-line pass. Its companion now measures multiple individually
sub-500-line scripts whose combined total exceeds the tooling ceiling through the real file discovery
and line counter, and separately proves an actually empty tooling root reaches the staleness failure.

Measured on the complete Prompt 11c tree with the fence's own algorithm:

| Bucket | Measured | Ceiling | Named correction room |
|---|---:|---:|---:|
| `tooling` (`scripts/**`) | 14,317 | 14,350 | 33 |

The ceiling does not move. Thirty-three lines are narrow correction room, not speculative capacity.
No code is moved into another layer, and no platform or presentation ceiling changes.

### 2. The existing physical file ceiling covers the same tooling tree

`max-file-size` continues to enforce the repository-wide default 500-line physical ceiling over shipped
source plus `scripts/**`. There is no tooling-only parallel checker and no script exception map. The
largest current script measures 468 lines by the fence's newline-counting algorithm, so no new pin or
headroom is introduced. A planted 502-line script is discovered and rejected by the same function the
enforcement test calls.

### 3. Gate B credits delivered corpus proof and remains non-green

ADR-0055 owns the current gate schema and ratchets. Gate B already exists, so this amendment updates that
entry rather than creating a duplicate or reviving the design report's obsolete shape:

- Prompt 11a's delivered corpus stability proof is a typed `ci-gate` requirement for job `corpus` and
  exact command `pnpm exec tsx scripts/corpus-validate.ts`.
- Prompt 11b remains a typed `evidence` requirement: the captain-signed golden cases must be materialized
  as immutable replay fixtures with deterministic seeds and expected hashes, the same seed must reproduce
  a byte-identical case bundle, and every reference must validate against the Prompt 10 domain
  configuration and policy versions. No current mechanism decides that clause, so it cannot read green.
- Prompt 10's two domain artifacts, shared-engine binding evidence, and invariant 3 remain unchanged and
  unmet. Gate A also remains a structural predecessor.

This slice activates **zero invariants**. No invariant has Prompt 11 in `activationPrompts`, no status
changes, and the shipped active-invariant ratchet remains exactly `{1, 2, 5, 7, 8, 9, 16}`. The focused
companion mutates invariant 3 to `active` and proves registry validation rejects the false activation.
Another companion removes Prompt 11b's requirement, demonstrates why that would manufacture local Gate B
readiness once the other requirements are supplied, and proves the complete-requirement ratchet rejects
the mutation.

### 4. Charter ownership is explicit

`charter-map.json` maps ADR-0058, `line-budget`, and `max-file-size` to charter #1, which requires the
ceilings, and maps ADR-0058 beside the same fences under charter #10, which owns the separate presentation
budget. Charter drift ratchets those exact tuples. The extension is therefore both enforced and mapped to
the obligations it answers.

## Alternatives Rejected

| Alternative | Why Rejected |
|---|---|
| Add a second tooling-only budget script | Two discovery and counting implementations would drift. The existing repository-wide fences already provide the correct extension points. |
| Move corpus tooling under `src/domain` to consume an existing bucket | Build-time fixture generation is not runtime domain behavior. Moving it would hide the ownership problem rather than solve it. |
| Raise the tooling ceiling for future Prompt 11 work | Prompt 11b does not exist on this branch, so capacity for it would be speculative headroom. Its eventual tree must be measured when it lands. |
| Mark the stable-corpus outcome fully met from Prompt 11a | Prompt 11b has not materialized the signed cases against Prompt 10 configuration. That would claim Prompt 11 and Gate B complete on half the required subject. |
| Activate invariant 3 because Gate B is now registered | Registration is not implementation. Invariant 3 depends on Prompt 10 artifacts and the pinned domain-configuration fence. |
| Keep the stale Prompt 11 evidence note | It falsely says the merged corpus and its blocking job do not exist. Governance text must describe the current tree. |

## Trade-offs and Costs

- **Gained:** build-time tooling cannot escape either aggregate or physical limits; both charter owners
  point at the live mechanisms; Gate B now distinguishes delivered Prompt 11a proof from the missing
  Prompt 11b subject; false activation and false readiness are companion-proven.
- **Sacrificed:** Gate B keeps an undecidable evidence requirement until Prompt 11b lands. That is the
  honest state, not a governance inconvenience to optimize away.

## Consequences

- Prompt 11c is complete as a budget and registry slice. Prompt 11 as a whole is not complete.
- Prompt 10 still owns domain configuration and invariant 3 activation.
- Prompt 11b still owns immutable signed-case materialization, deterministic seeds, expected hashes,
  byte-identical regeneration, and reference validation against domain configuration and policy versions.
  It may replace its `evidence` requirement only with the exact artifact or fitness mechanism that proves
  the whole clause.
- No captain-signed golden fixture, generated corpus file, demo behavior, runtime contract, or invariant
  status changes in this decision.
- The `src/__tests__/**` budget gap remains deferred under `fu-corpus-test-tree-budget`; this slice does
  not silently broaden itself into Prompt 11b or unrelated test-tree governance.

## Revisit When

- Prompt 11b lands: replace its complete Gate B stability evidence with the exact mechanized requirement
  and amend the complete requirement ratchet in the same PR.
- Prompt 10 lands: follow ADR-0055's invariant 3 activation procedure and evaluate Gate B against the
  real domain configuration and shared engine.
- A change to `scripts/**` would exceed 14,350 lines: re-measure the complete landing tree, explain the
  ownership boundary that needs the growth, and amend ADR-0018. Do not pre-allocate the increase.
- A script legitimately needs more than 500 physical lines: split at a real responsibility seam or add
  a measured, architecture-reviewed pin under the existing max-file-size mechanism.
