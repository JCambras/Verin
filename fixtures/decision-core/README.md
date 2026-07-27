# Decision-core canonical-serialization fixtures (ADR-0029, D-040)

Synthetic test vectors - NOT product data (charter #3: labeled synthetic; never seeded, never
displayed, never fed to a compliance decision). The files contain one `DecisionInputBundle` and
three `DecisionRecord` values committed in canonical byte form (`canonicalJson` in
`src/contracts/decision-core/serialization.ts`, schema version 1.2.0 and serializer version
1.0.0): keys sorted at every depth, no insignificant whitespace, one trailing newline.

`src/__tests__/unit/decision-core.test.ts` proves each fixture parses through
its schema and re-serializes byte-identically. It also hashes the canonical, domain-separated
preimage bytes with SHA-256 and requires the digest to equal the fixture's stored `bundleHash` or
`decisionHash`.

Bundle preimage version `decision-input-bundle/1.2.0` excludes `id` and `bundleHash`, because
identity is not a material evaluation input, and sorts the instruction-version and
evidence-snapshot reference collections. Decision preimage version `decision-record/1.2.0`
excludes only `decisionHash`; the decision ID and all order-significant traces, stages, and plan
steps remain bound. The 1.2.0 shapes recursively replace bare decision-record citations and evidence
IDs with strict references carrying both `firmId` and the opaque branded ID. Both projections enumerate fields explicitly. Any
projection change requires its preimage version to change and a migration story for recorded hashes.

The three records mirror golden cases GC-01 (proceed), GC-05 (blocked), GC-07 (prohibited) -
`fixtures/golden/` remains the captain-signed truth set; these fixtures only lock the byte form of
the type system, they assert nothing about engine outcomes.
