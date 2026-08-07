# `fixtures/corpus/` - the replay corpus (v3 prompt 11, ADR-0052)

Two ownership planes live here and must never be confused.

| Path | Owner | Rule |
|---|---|---|
| `spec/world.json`, `spec/cases.json`, `spec/defect-taxonomy.json` | **hand-owned** | Reviewable synthetic input. Edit these, then regenerate. |
| `spec/real-derived-semantic-contract.json` | **hand-owned** | Versioned replay rules bound into captain signoff. |
| `spec/real-derived-{case,replay}-schema.json` | **hand-owned** | Strict intake schemas bound into captain signoff. |
| `spec/SIGNOFF.md` | **hand-owned, captain-only** | Agents never write a signature. |
| `manifest.json`, `synthetic/*.json` | **generated** | `pnpm corpus:generate`. Never hand-edit: CI regenerates and byte-compares. |
| `real-derived/` | **captain-gated intake** | Ships empty. See its README. |
| `README.md` (this file) | **hand-owned documentation** | The ONLY corpus-root entry outside those buckets. |

That table is the complete inventory, and it is enforced: `pnpm corpus:validate` fails on any committed
entry under `fixtures/corpus/` that is neither `manifest.json`, nor under `spec/`, `synthetic/`, or
`real-derived/`, nor the allowlisted `README.md` - and equally if that README stops existing. A file
nothing generates, digests, or governs is checked by nothing, so it may not sit here quietly.

## Commands

```
pnpm corpus:generate   # spec + seed -> manifest.json + synthetic/**
pnpm corpus:validate   # regenerate, byte-compare, re-check every rule  (blocking CI job `corpus`)
pnpm corpus:report     # provenance-split measurement; refuses to blend
```

## Ownership is enforced, not requested

`pnpm corpus:validate` regenerates from the spec and compares bytes. A hand edit to any generated file
fails the build with the file name. The inventory is recursive, so hidden, nested, and non-JSON files are
also compared and cannot escape generated ownership. The `.gitattributes` `linguist-generated` marking
and this README are signposts; the byte comparison is the mechanism.

## Determinism

Values are derived path-keyed - `SHA-256(seed ‖ path ‖ field)` - not from a stream PRNG, so **adding one
household changes only that household's cases**. The `corpus-determinism` fence proves this directly, along
with byte-identity across runs and time zones, seed sensitivity, and the ban on clocks, randomness, and
locale APIs inside `scripts/corpus/`. Every cross-record reference is resolved by structured parse against
exact identifiers rather than substring, and anything read positionally out of the spec is sorted first, so
neither a prefix-colliding household key nor a neutral reorder can move a digest.

## Every record says when it was OBSERVED

`observedAt` on a spec record is when the evidence source observed it - never when the underlying fact
became true. The business dates (`effectiveFrom`, `changedAt`, `recordedAt`, `assignedAt`, `createdAt`)
live beside it and are carried into the emitted subgraph. A fact may be years old and freshly observed;
deriving one from the other makes every long-standing fact stale, which is a defect class in its own
right (D-078). A control that carries any defect signature fails validation.

Real-derived freshness uses the closed `verin-real-derived-freshness/1.0.0` per-kind policy. Its version
and semantic digest are part of the captain-signed corpus preimage. The same preimage binds the strict
schemas, `verin-real-derived-semantics/1.13.0` data, and the executable authorities that enforce replay
topology, evidence support, selected funding, and defect signatures: the corpus-owned semantic modules
plus the shipped surfaces the replay result depends on (the canonical serializer and its record
predicate, the recorded time-zone registry and its reader, the golden-case loader). General-purpose
shipped plumbing reached only through those modules is a DECLARED exclusion, not an omission - the bound
list and the exclusion list together are fenced equal to the complete runtime closure.

## Honesty

Every case in `synthetic/` is **author-invented** and labeled `synthetic-fixture`. Nothing here is evidence
that a defect has occurred in production. The corpus and the sixteen signed golden cases are disjoint by
construction, and the golden cases are never counted in a corpus denominator - they were authored to be
caught, so scoring against them would be circular.

Normative spec: [`docs/corpus.md`](../../docs/corpus.md).
