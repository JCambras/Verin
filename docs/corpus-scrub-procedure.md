# Real-derived corpus intake procedure (scrub and attest)

**Normative.** Governs how anonymized real defect history enters
[`fixtures/corpus/real-derived/`](../fixtures/corpus/real-derived/). Enforced by
`scripts/corpus/scrub-contract.ts` and the `corpus-provenance-split` fence; run in CI by the blocking
`corpus` job. Adopted by [`ADR-0034`](./adr/0034-synthetic-corpus-and-provenance-split.md) under captain
ruling `corpus-real-derived-provenance` (2026-07-28).

**The partition is empty today and this procedure has never been executed.** It ships now so that the
capability is real and adversarially exercised (charter #5) rather than promised. Nothing in this
document describes a defect that has occurred.

---

## 0. Precondition - the un-defer trigger

No case may be delivered until the captain has supplied **all three**:

1. an authorized scrubbed source of real NIGO returns, custodian rejections, or operational exceptions;
2. an accountable owner for extraction and de-identification;
3. an agreed delivery date and review path.

Until then the partition stays empty, `detectionRate` stays `null`, Phase 1 is not complete, and no
investor-facing detection-rate claim is permitted.

---

## 1. Roles - three, never fewer

| Role | Responsibility | Constraint |
|---|---|---|
| **Extractor** | Pulls the raw exception records from the authorized source. | Named in the attestation; records the extraction instant. |
| **Scrubber** | De-identifies: suppress, tokenize, generalize. | Records method, instant, and record counts before/after. |
| **Reviewer** | Independently re-reads every field of every case before delivery. | **Must not be the scrubber.** Enforced: a self-reviewed case is rejected. |

---

## 2. What is removed, what is tokenized, what may remain

**Removed outright (suppression).** Any free-text field, in full. Narrative descriptions, advisor notes,
memo lines, reason text, correspondence, subject lines, ticket bodies. A real-derived case carries **no
free text at all** - there is no "cleaned prose" tier, because reviewing prose for residual identifiers
is exactly the control that fails silently.

**Tokenized.** Attestation identities use `tok:<16 lowercase hex>`. Replay identities use
entity-kind-scoped forms such as `request:tok:...`, `household:tok:...`, `account:tok:...`,
`instruction:tok:...`, `owner:tok:...`, `actor:tok:...`, `grant:tok:...`, and `policy:tok:...`.
Evidence sources use `evidence-source:tok:...`. Tokenization is deterministic within a delivery so
relationships survive, and carries no reversible mapping into this repository. The mapping, if one is
retained at all, stays with the accountable owner outside version control.

**May remain.** Instants in canonical UTC (`YYYY-MM-DDTHH:MM:SS.mmmZ`); integer counts and integer minor
units; and members of the declared closed vocabularies - defect class ids, evidence kinds, conflict
families, freshness, observation states, the current freshness-policy version, scrub methods,
source-system classes, control rationales.

**Generalized.** Anything that is a quantity but identifies by precision (an exact balance that is
effectively a fingerprint) is rounded or bucketed, with `method: "generalization"` attested.

---

## 3. The required attestation

Every case carries a complete `scrubAttestation`:

```json
{
  "sourceSystemClass": "custodian-exception-feed | crm-case-history | operations-exception-log",
  "extractedAt":  "<canonical UTC instant>",
  "extractedBy":  "tok:<16 hex>",
  "scrubbedBy":   "tok:<16 hex>",
  "scrubbedAt":   "<canonical UTC instant>",
  "reviewedBy":   "tok:<16 hex>",
  "reviewedAt":   "<canonical UTC instant>",
  "recordsBefore": <int>,
  "recordsAfter":  <int>,
  "method": "deterministic-tokenization | field-suppression | generalization"
}
```

Mechanically enforced: attestation present and complete; `reviewedBy ≠ scrubbedBy`;
`recordsAfter ≤ recordsBefore` (scrubbing cannot add records); the source-system class and method drawn
from the closed vocabulary; and `occurredAt ≤ extractedAt ≤ scrubbedAt ≤ reviewedAt`. **Source system is
recorded as a CLASS, never a named institution** - the institution is itself identifying.

---

## 4. Fail-closed, by construction

The hand-owned `real-derived-case-schema.json` and `real-derived-replay-schema.json` are strict at every
object boundary: every field is required or explicitly nullable, additional fields are forbidden, ids use
opaque token components and closed suffixes, and every categorical value comes from a closed vocabulary.
**Anything else is rejected**, including a field nobody anticipated. A scrubbing miss therefore has
nowhere to live. Every evidence subject resolves to exactly one opaque subject, and evidence and
conflict-key suffixes must match their declared kind or family.

Delivery bytes must already be canonical JSON with one trailing newline. Parsing and canonical
re-serialization must reproduce the exact bytes, so duplicate object keys, alternate key order,
noncanonical whitespace, and hidden earlier values are rejected before a parsed value can enter inventory.
Schema diagnostics include only bounded safe field paths and redacted descriptions. Rejected field values
and unrecognized key text are never printed to CLI or CI output.

The filesystem boundary is recursive and exact. While deferral is active, hidden, nested, non-JSON, and
unsupported entries all count as delivery and are rejected. After un-deferral, a case must be a top-level
`RD-<16 hex>.json` file whose filename matches its case id; case ids are unique across the collection and
every case names the active corpus version before any case enters manifest inventory. A delivery path is
printed only after it passes that canonical filename check. Invalid names are represented by a bounded
delivery ordinal, never their raw filesystem text.

Adversarially proven in `corpus-provenance-split.test.ts`: a valid case is accepted; duplicate JSON keys,
a free-text subject, a free-text field or key, a missing attestation, a self-reviewed scrub, an inflated
record count, a dangling evidence subject, a mismatched derived-id suffix, a mislabeled provenance, a
hidden or nested delivery, a duplicate case id, a stale corpus version, an unknown freshness policy,
inverted chronology, and inconsistent freshness are each rejected without echoing rejected prose.

---

## 5. Case shape

```
caseId          RD-<16 lowercase hex>       disjoint from CS- (corpus) and GC- (signed golden)
firmRef         firm:tok:<16 lowercase hex> one opaque tenant scope for the complete case
partition       "real-derived"
provenance      "real-derived-fixture"
label           {kind: "defect", defectClassId} | {kind: "clean-control", controlRationaleId}
occurredAt      canonical UTC instant
evaluation      {asOf, freshnessPolicyVersion: "verin-real-derived-freshness/1.0.0"}
subjects        [entity-kind:tok:…]
replayPayload   verin-real-derived-replay/1.8.0 closed payload
evidence        [{id, evidenceKind, subjectRef, sourceRef, observationState, observedAt, retrievedAt, freshness}]
reservations    [{firmRef, family, conflictKey}]
```

The replay payload contains only the typed inputs needed by the supported defect classes:

- request, destination, ownership, discriminator, and identity-resolution state;
- source liquidity, an explicit selected funding set, reserve shape, typed pending-action direction and
  treatment, and source tax class;
- approval grant, scope, lifecycle, policy version, threshold comparison, restriction, and legal-hold state;
- tax-review and instruction-conflict state;
- event time and pinned time-zone-rule identity;
- one typed expected and observed treatment for every supported defect class;
- exact evidence references, reservation keys, and execution preconditions.

Absent, additional, ambiguous, or mutually incompatible fields fail. Request and destination identity,
ownership, source-account resolution, selected-funding ownership and aggregate sufficiency, threshold
comparison, pending-action treatment, authority lifecycle, evidence inventory, reservation inventory,
and subject inventory are cross-checked rather than trusted. The payload carries no raw names, account
numbers, institution names, unrelated balances, or unrelated household records.

Every material replay plane has exactly one matching evidence kind, entity-kind-scoped subject, and
opaque evidence-source reference with an allowed observation state. Missing evidence supports only an
explicit absence or unavailable payload of the same typed plane. Every concrete material value requires
observed evidence. Evidence that supports no material plane is rejected. An authority
interval must cite the payload's grant, destination evidence must cite its instruction, and balance
evidence must cite the corresponding liquidity source. The selected funding set is explicit, unique,
same-household, source-owner-aligned, and sufficient in aggregate for the request, reserve, and one
availability adjustment for any cited action not already reflected in `availableMinor`. Every action
states `availableMinorIncludesAction`; omitting it is invalid. Settled incoming credits use
`preserve-settled-incoming-availability` when already included and
`credit-settled-incoming-availability` otherwise, so a replay cannot omit or double-count settled value.
An instruction-conflict witness must name the exact request and household, every referenced instruction
must belong to that household, and impacted subjects must intersect the request source account or
destination instruction.

The top-level case, replay request, and every reservation carry one exact opaque `firmRef`. A missing or
mismatched scope fails intake, and reservation identity is the pair `(firmRef, conflictKey)`. Household
and display values never supply tenant scope. Generic subjects, evidence subjects, and impacted-subject
inventories reject firm references.

Every money field is a safe integer minor-unit value. Aggregate funding sufficiency uses exact integer
arithmetic and rejects an unsafe conversion boundary before summation.

Observed evidence uses `observationState: "observed"`, a canonical `observedAt`, and a derived
`fresh | stale` value. Missing source observation uses `observationState: "missing"`,
`observedAt: null`, and exactly `freshness: "unknown"`. The validator derives freshness from
`evaluation.asOf` and the closed per-kind policy, enforces
`observedAt <= retrievedAt <= evaluation.asOf`, and rejects unknown policy versions, unsupported kinds,
impossible chronology, or inconsistent freshness before inventory. The policy's version and semantic
digest are included in the captain-signed corpus preimage.

Clean controls carry a `controlRationaleId` from a closed list, not prose - the same rule that keeps free
text out of defect cases.

Each supported defect class has one closed context rule, expected treatment, and defective treatment.
Awkward context alone is not a defect. The declared defect label must match a typed
expected-versus-observed mismatch for that class, and a clean control must record the expected treatment
for every supported class. Missing, duplicate, unknown, contradictory, or context-free mismatches fail
closed. The semantic registry must exactly equal the signed taxonomy.

**Deliver labeled clean controls alongside defect cases.** After the deferral is lifted, the collection
must contain at least one valid defect and at least one valid clean control. A one-sided collection is
incomplete, cannot enter inventory, cannot be signed, and cannot be measured.

---

## 6. Delivery and review path

1. Extractor and scrubber produce canonical candidate cases per §2 through §5.
2. Reviewer independently re-reads every field of every case and attests.
3. Lift the recorded deferral, then hand-place canonical top-level files in
   `fixtures/corpus/real-derived/`.
   **`pnpm corpus:generate` never writes there** - the generator can emit only into `synthetic/`, and a
   fence asserts it. Files delivered while the deferral is active fail validation.
4. `pnpm corpus:validate` must pass. It runs the whole contract over the delivered files.
5. The generated manifest inventories every real-derived case and binds its bytes into `corpusDigest`.
   It also binds the exact bytes and semantic projections of both versioned intake schemas, plus the
   declarative semantic contract and exact executable-authority digests. The captain re-signs the corpus
   version: the digest changes, which invalidates the prior signature by design
   (see [`docs/corpus.md`](./corpus.md) §9).
6. Update `fixtures/corpus/real-derived/README.md`, the `corpus_deferral` record in
   `config/demo/scenarios.yaml`, and ADR-0034's status to record that the deferral has been lifted.

Only after step 5 does `pnpm corpus:report` emit a `detectionRate`, and even then it is reported beside
its false-positive rate and **never blended** with the synthetic figure.

---

## 7. If in doubt

Do not deliver the field. A corpus with fewer fields is worth more than one carrying a re-identification
risk, and a smaller honest denominator is worth more than a larger one nobody can defend.
