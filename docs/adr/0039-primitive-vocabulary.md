# ADR-0039: The decision-primitive vocabulary lands in `contracts/primitives` as a versioned, provisional, falsification-tested catalog

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Build agent executing the captain-ratified Wave B design (decision record `waveb-design-ratification`, 2026-07-26)
**Relates to:** ADR-0023 (v3 adoption), ADR-0029 (decision-core contracts), ADR-0018/ADR-0040 (ceiling amendment), charter #1/#2/#4
**Informed by:** docs/v3/verin-prompt-sequence-v3.md §8, docs/v3/verin-architecture-v3.md §6-§7, docs/v3/marriage-map.md C6, the sixteen captain-signed golden cases

## Context

Build-sequence prompt 8 requires the initial decision-primitive vocabulary: derived from money
movement, account opening, trading/rebalancing, life events, and client service; under fifteen
primitives; each with parameters, deterministic semantics, applicable evidence, possible effects,
and a falsification test; versioned and provisional; no domain branches. The Wave B design report
was ratified by the captain with eight open-question rulings; that ratification fixes the catalog
at exactly six primitives and makes the composability razor binding: the policy AST (prompt 9)
deliberately lacks aggregation, arithmetic, per-candidate quantification, and cross-snapshot
comparison, and a primitive exists exactly where one of those four capabilities is needed.

The v3 sequence names the deliverable `src/primitives/catalog.ts`. The repo's chartered
architecture is four fenced layers, and marriage-map C6 (adopted with ADR-0023) re-baselines v3
module paths into them - the same ruling that landed prompt 5 at `src/contracts/decision-core/`.

## Decision

- **Home:** `src/contracts/primitives/` - `catalog.ts` (the assembly: set version, provisional
  flag, the six-entry tuple), `values.ts` (shared vocabulary: plain calendar dates, deterministic
  month arithmetic, published-key descriptors, the catalog entry contract), `quantity.ts`
  (net-availability, horizon-projection, sufficiency-check), `selection.ts`
  (candidate-selection), `screening.ts` (restriction-screen, evidence-reconciliation). The
  catalog is pure types, Zod schemas, and pure functions - the contracts layer's exact
  definition - and the prompt-9 loader consumes it from there. `contracts/` stays knip-exempt
  vocabulary, so the catalog needs no dead-export escape while prompt 10 is still in flight.
- **Set 1.0.0 (provisional):** `candidate-selection`, `evidence-reconciliation`,
  `horizon-projection`, `net-availability`, `restriction-screen`, `sufficiency-check`. The
  registry `primitive-set-version.json` at the repo root mirrors the catalog and names the three
  declared future primitives (`allocation-vector`, `deviation-from-target`,
  `windowed-event-count`); the version is pinned into every
  `DecisionInputBundle.primitiveSetVersion` and versions independently of the AST grammar.
- **Every entry carries** a strict Zod parameter schema, a full input schema with cross-field and
  tenant-consistency refinements, published-key declarations with types and presence, closed
  strategy lists where applicable, falsification metadata naming the real operating case that
  would prove it wrong, and a total pure `evaluate` over parsed input.
- **Fences (same PR, charter #1/#4):** the `primitive-catalog` fence enforces registry/catalog
  agreement in both directions, rationale-doc coverage without phantoms, domain-neutral naming
  (identifiers and non-prose strings; falsification prose is the one exemption because the prompt
  requires it to name real cases), and purity (no clock, randomness, tz/locale machinery, or
  scheduling globals). Each check has companions proving the incomplete form cannot pass;
  adversarial injection proofs are logged as PF-188.
- **Falsification tests are executable:** each primitive's ratified kill criterion is asserted in
  unit tests as currently-unrepresentable (conditional claims, backward projections, ratio
  bounds, quantity allocation, aggregate restrictions, trust hierarchies all fail to parse), so
  absorbing a falsifying case by quiet schema growth fails the suite and forces the declared
  version-bump path.

## Consequences

- Prompt 9 derives the AST's closed context-key vocabulary from the catalog's published keys and
  validates `set_parameter`/`select_candidate` against parameter schemas and strategy lists.
- Prompt 10 binds primitives per domain as configuration; nothing in the catalog names a domain
  (fenced), so a new domain is configuration work by construction.
- The evaluation harness owns the single tz-data consultation (bundle asOf -> anchor date);
  primitive arithmetic stays pure integer math, which is what keeps replay byte-identical.
- `evidence-reconciliation` ships unexercised by the golden cases (captain OQ-3 ruling, labeled
  "activates at prompt 15"); `horizon-projection` carries a hard kill date at the trading wave
  (OQ-4). Both are recorded in the rationale doc and the catalog's falsification metadata.

## Revert path

Delete `src/contracts/primitives/`, `primitive-set-version.json`, `docs/primitive-rationale.md`,
the `primitive-catalog` fence, and the primitives unit suite; revert ADR-0040's ceiling. No other
code depends on the catalog until prompt 9 lands.
