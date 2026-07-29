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

**Tokenized (`tok:<16 lowercase hex>`).** Every identifier of a person, household, entity, account,
instruction, employee, or external party. Tokenization is deterministic within a delivery so relationships
survive, and carries no reversible mapping into this repository. The mapping, if one is retained at all,
stays with the accountable owner outside version control.

**May remain.** Instants in canonical UTC (`YYYY-MM-DDTHH:MM:SS.mmmZ`); integer counts and integer minor
units; and members of the declared closed vocabularies - defect class ids, evidence kinds, conflict
families, freshness, scrub methods, source-system classes, control rationales.

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

The validator walks every string in a delivered case and requires it to be a canonical instant, an opaque
token, a derived id whose variable components are opaque tokens and whose suffix is a member of the
appropriate closed vocabulary, a `RD-<16 hex>` case id, or a member of a declared closed vocabulary for
its key. **Anything else is rejected**, including a field nobody anticipated. A scrubbing miss therefore
has nowhere to live: it cannot arrive in a new key, because a new key with a string value fails by default.
Every evidence subject resolves to exactly one opaque subject, and evidence and conflict-key suffixes
must match their declared kind or family.

Adversarially proven in `corpus-provenance-split.test.ts`: a valid case is accepted; a free-text subject,
a free-text field under an unanticipated key, a missing attestation, a self-reviewed scrub, an inflated
record count, a dangling evidence subject, a mismatched derived-id suffix, and a mislabeled provenance
are each rejected.

---

## 5. Case shape

```
caseId          RD-<16 lowercase hex>       disjoint from CS- (corpus) and GC- (signed golden)
partition       "real-derived"
provenance      "real-derived-fixture"
label           {kind: "defect", defectClassId} | {kind: "clean-control", controlRationaleId}
occurredAt      canonical UTC instant
subjects        [tok:…]
evidence        [{id, evidenceKind, subjectRef, observedAt, retrievedAt, freshness}]
reservations    [{family, conflictKey}]
```

Clean controls carry a `controlRationaleId` from a closed list, not prose - the same rule that keeps free
text out of defect cases.

**Deliver labeled clean controls alongside defect cases.** Without them no false-positive rate is
computable, and a coverage figure without one is reported `interpretable: false`.

---

## 6. Delivery and review path

1. Extractor and scrubber produce candidate cases per §2 and §3.
2. Reviewer independently re-reads every field of every case and attests.
3. Lift the recorded deferral, then hand-place files in `fixtures/corpus/real-derived/`.
   **`pnpm corpus:generate` never writes there** - the generator can emit only into `synthetic/`, and a
   fence asserts it. Files delivered while the deferral is active fail validation.
4. `pnpm corpus:validate` must pass. It runs the whole contract over the delivered files.
5. The generated manifest inventories every real-derived case and binds its bytes into `corpusDigest`.
   The captain re-signs the corpus version: the digest changes, which invalidates the prior signature by
   design (see [`docs/corpus.md`](./corpus.md) §9).
6. Update `fixtures/corpus/real-derived/README.md`, the `corpus_deferral` record in
   `config/demo/scenarios.yaml`, and ADR-0034's status to record that the deferral has been lifted.

Only after step 5 does `pnpm corpus:report` emit a `detectionRate`, and even then it is reported beside
its false-positive rate and **never blended** with the synthetic figure.

---

## 7. If in doubt

Do not deliver the field. A corpus with fewer fields is worth more than one carrying a re-identification
risk, and a smaller honest denominator is worth more than a larger one nobody can defend.
