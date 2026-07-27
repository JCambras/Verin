# ADR-0029: Decision-core canonical contracts land in `contracts/` as Zod schemas; contracts ceiling re-baselined

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** Founding architect (executing the captain-ratified v3 direction, ADR-0023)
**Relates to:** Charter non-negotiables #1, #2; v3 invariants 2, 7, 8, 9; ADR-0018 (ceiling amendment), ADR-0026 (FirmId ≡ org_id)
**Informed by:** docs/v3/verin-core-contracts.ts (ratified shapes), docs/v3/verin-prompt-sequence-v3.md §5, docs/v3/marriage-map.md §5 (style-merge notes)

## Context

ADR-0023 ratified the v3 architecture; build-sequence prompt 5 lands its §5 canonical core type
system as real code. The ratified reference file is framework-free TypeScript; the prompt directs
implementing the contracts **as Zod schemas with derived types** so illegal states are rejected at
parse time, not by reviewer discipline. Three constraints meet here:

1. The marriage map places the contracts in `src/contracts/decision-core` beside
   `result.ts`/`errors.ts`/`roles.ts` - the dependency-free home every layer may import.
2. `contracts/` has never imported an external package, and the contracts line ceiling (ADR-0018)
   was 600 with 472 used - the ratified surface (~820 lines across seven <500-line files) cannot fit.
3. ADR-0018 is explicit: raising a platform ceiling is an ADR amendment, never a code change.

## Decision

- **Home:** `src/contracts/decision-core/` - `ids.ts` (branded IDs + temporal/integrity
  primitives), `actor.ts` (tenant scope, actor refs, tokenized shapes), `trigger.ts`,
  `evidence.ts`, `authority.ts`, `execution.ts`, `decision.ts`, `serialization.ts` (canonical
  serializer + versions). Zod schemas are the single source; TypeScript types are `z.infer` derived.
- **Structural invariants:** strict objects + discriminated unions make v3 invariants 7–9
  parse-level facts (proceed requires authority + non-empty plan; blocked/prohibited cannot carry
  either; a prohibition has no resolving-evidence channel and a prohibited record admits no
  revaluation conditions). Disposition and authority stay separate planes. Fence:
  `src/__tests__/fitness/decision-core-illegal-states.test.ts` (registered for invariants 7–9;
  proof PF-027). Canonical-serialization fixtures live in `fixtures/decision-core/` (synthetic test
  vectors, labeled in their README).
- **Hash preimages:** bundle and decision hashes use distinct domain-qualified version-1.1.0
  envelopes and explicitly enumerated projections. The bundle projection excludes its identity and
  stored hash, and sorts its set-like instruction/snapshot reference lists; the decision projection excludes
  only its stored hash. Exhaustive key lists are checked against the inferred schema keys so optional
  schema growth cannot evade a preimage-version bump. Version-keyed recursive schema fingerprints cover
  every nested projected object, array, union arm, and optional property. Explicit undefined optional
  properties normalize to omission, while sparse arrays are rejected. Fixture digests are SHA-256 over
  canonical UTF-8 bytes and must equal the stored hash. A projection change requires its own version bump
  and migration story.
- **Replay-input boundary:** `DecisionInputBundle` accepts only the implemented 1.1.0 schema and
  1.0.0 canonical serializer, rejects unsupported or non-canonical IANA time-zone identifiers,
  rejects duplicate instruction-version and evidence-snapshot references, and freezes the parsed bundle.
  Policy, instruction-version, evidence-snapshot, intent, and input-bundle links are strict structured
  references carrying `firmId` plus the opaque branded ID; enclosing-record refinements reject every
  cross-tenant link.
  Every parsed decision-core object and nested collection is recursively readonly and frozen, so a
  validated decision cannot be mutated into an illegal or hash-divergent state.
- **`contracts/` may import Zod** - and only Zod. The layer's discipline is restated as: no
  project-local imports from outer layers (unchanged, fenced), no I/O, no platform coupling; Zod is
  a pure validation library and is what makes the contracts self-enforcing at every boundary.
  The dependency fence enforces the external allowlist across static imports, re-exports, dynamic
  imports, `require`, TypeScript import types, import-equals declarations, and triple-slash type/path
  references.
  Any further external import into `contracts/` requires its own ADR.
- **Ceiling re-baseline (amends ADR-0018):** contracts 600 → **1550** (measured 1525 after replay-boundary
  review hardening + modest headroom). The ratchet-down doctrine resumes from 1550; later contract-layer prompts
  (8–9: primitives, policy AST) re-baseline by their own ADRs when their scope lands.
- **Scope (charter #2 - declared need only):** exactly the prompt-5 list plus transitive
  dependencies and the template/instance approval split the marriage map calls out. Deferred to
  their owning prompts: policy AST + PolicyRuleId (9), typed ledger events + LedgerEntryId +
  ExecutionHandleId + ObservedStatus (7/26), the three ports + their request/receipt shapes
  (14/24), instruction/config vocabularies (9–10). The Tokenized factory and its reachability
  fence are prompt 6 (parallel worker); only the SHAPE lands here.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Land in `domain/` to spare the contracts ceiling | The marriage map names `contracts/` as the home; domain would also need a bump; every layer (incl. future `llm/`) must import these without reaching into domain. |
| Pure types in `contracts/`, Zod wrappers in `infrastructure/` | Two sources of truth for one contract; the illegal-state guarantees would live apart from the types they guarantee and could drift. |
| Keep the 600 ceiling and land a trimmed surface | Trimming ratified shapes to fit a budget inverts the constitution: the ceiling exists to prevent sprawl, not to veto the captain-ratified architecture. |
| Hand-rolled validators instead of Zod | Re-implements a well-tested library, invites divergence between validator and type - the exact class of drift branded schemas eliminate. |

## Trade-offs and Costs

- **Gained:** illegal decision states are unrepresentable at every parse boundary; invariants 7–9
  flip active with a runnable mechanism; replay gets a versioned canonical serializer and
  non-self-referential hash projections with committed byte-form and digest fixtures.
- **Sacrificed:** `contracts/` is no longer import-free (Zod, by exception); the contracts ceiling
  grew 600 → 1550 (a real growth, honestly sized and ratcheted).

## Consequences

- `line-budget` fence: contracts ceiling 1550 (this ADR is the amendment ADR-0018 requires).
- `charter-map.json` #7 and `v3-invariants.json` invariant 2 execute
  `decision-core-tenant-scope`, which proves every immutable cross-record link named above matches
  its enclosing tenant.
- `v3-invariants.json`: 7, 8, 9 active → `decision-core-illegal-states` fence; ratchet extended
  to [2, 5, 7, 8, 9].
- Consumers (prompts 7, 9–19, 25–26) import from `@contracts/decision-core/*`; the store boundary
  keeps ISO-string timestamps both ways (Timestamp admits only canonical UTC `Z` instants).

## Revisit When

- Prompt 8/9 land primitives + policy AST (next contracts re-baseline ADR), or
- the canonical serializer or either hash projection must change form (matching version bump +
  migration story for recorded hashes), or
- a second external import is proposed for `contracts/` (needs its own ADR).
