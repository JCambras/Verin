# Decision-core canonical-serialization fixtures (ADR-0029, D-040)

Synthetic test vectors - NOT product data (charter #3: labeled synthetic; never seeded, never
displayed, never fed to a compliance decision). The files contain one `DecisionInputBundle` and
three `DecisionRecord` values committed in canonical byte form (`canonicalJson` in
`src/contracts/decision-core/serialization.ts`, schema version 1.7.0 and serializer version
1.0.0): keys sorted at every depth, no insignificant whitespace, one trailing newline.

`src/__tests__/unit/decision-core.test.ts` proves each fixture parses through
its schema and re-serializes byte-identically. It also hashes the canonical, domain-separated
preimage bytes with SHA-256 and requires the digest to equal the fixture's stored `bundleHash` or
`decisionHash`.

Bundle preimage version `decision-input-bundle/1.7.0` excludes `id` and `bundleHash`, because
identity is not a material evaluation input, and sorts the instruction-version and
evidence-snapshot reference collections by firm then opaque id - the SAME comparator the schema
canonicalizes with, so the preimage cannot order a list differently from the record it hashes.
Decision preimage version `decision-record/1.7.0`
excludes only `decisionHash`; the decision ID and all order-significant traces, stages, and plan
steps remain bound.

Both preimages defensively normalize semantic sets through the same pure ordering authorities their
schemas use, without reparsing shaped values. That keeps caller-order permutations from changing a
hash while preserving canonical JSON's refusal of `Date`, `Map`, and class instances. The decision
normalizer covers role and evidence-supplier sets, approval stages by explicit order, recursive
explanation evidence/source references, and each execution action's preconditions, conflict keys,
reservations, precondition evidence, and dependency edges. `decision-core.test.ts` reverses each set
in turn and requires `decisionHash` to remain byte-identical, with a material explanation edit and
the ordered `steps` list as controls that must change it. The 1.7.0 shapes tenant-scope every named configuration, evidence, subject, scope,
approval, execution, reservation, verification, and secure-storage reference, require retry-safe
compensation, canonicalize set-like evaluator inputs, validate each bundle's `timeZone` against the
registry its own recorded `timeZoneDataVersion` names while a standalone `TimeZone` spans every supported
registry (so a recorded bundle stays replayable against the release it names even after a later release
reclassifies one of that release's Zones - while NEW configuration is held to the current release alone,
so it fails closed at boot rather than at every later parse), require one tenant throughout every
external action and plan, refuse an evidence snapshot retrieved before the observation it records,
tenant-scope and canonicalize role sets,
normalize authority stages by their explicit order, and reject stale initial approval stages.
Both projections enumerate fields explicitly. Any
projection change requires its preimage version to change and a migration story for recorded hashes -
except a Zod upgrade that changes only the JSON Schema emitter's representation, which re-pins
`HASH_PROJECTION_SCHEMA_FINGERPRINTS` alone, leaving every recorded digest here untouched (ADR-0029).

The three records mirror golden cases GC-01 (proceed), GC-05 (blocked), GC-07 (prohibited) -
`fixtures/golden/` remains the captain-signed truth set; these fixtures only lock the byte form of
the type system, they assert nothing about engine outcomes.
