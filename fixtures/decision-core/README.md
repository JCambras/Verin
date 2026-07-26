# Decision-core canonical-serialization fixtures (ADR-0029, D-036)

Synthetic test vectors - NOT product data (charter #3: labeled synthetic; never seeded, never
displayed, never fed to a compliance decision). Each file is one `DecisionRecord` committed in its
CANONICAL byte form (`canonicalJson` in `src/contracts/decision-core/serialization.ts`, serializer
version 1.0.0): keys sorted at every depth, no insignificant whitespace, one trailing newline.

`src/__tests__/unit/decision-core.test.ts` proves each fixture parses through
`DecisionRecordSchema` and re-serializes byte-identically. A byte difference means the canonical
form drifted - that is a serializer VERSION BUMP with a migration story (recorded bundle/decision
hashes bind to the old form), never a fixture edit to green the build.

The three records mirror golden cases GC-01 (proceed), GC-05 (blocked), GC-07 (prohibited) -
`fixtures/golden/` remains the captain-signed truth set; these fixtures only lock the byte form of
the type system, they assert nothing about engine outcomes.
