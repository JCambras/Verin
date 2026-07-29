# Real-derived partition - deliberately EMPTY

`provenance: real-derived-fixture` · status `deferred-pending-authorized-source`

This directory holds **anonymized real defect history**: NIGO returns, custodian rejections, and
operational exceptions that actually happened, scrubbed of PII before entering fixtures. It contains **zero
cases today, and that is the honest state**, not an oversight.

Any delivered filesystem entry fails validation while this deferral remains active, including hidden,
nested, non-JSON, and unsupported entries. After the deferral is explicitly lifted, every case must use
its canonical top-level `RD-<16 hex>.json` filename, a collection-unique case id, and the active corpus
version before it is inventoried in `manifest.json`, included in `corpusDigest`, and supplied to the
real-derived measurement path.

## Why it is empty

There is no authorized scrubbed source of real defect history in this repository, no accountable owner for
extraction and de-identification, and no agreed delivery date. Writing cases here from imagination would be
inventing defect history - forbidden, and exactly the circularity the provenance split exists to prevent
(architecture v3 §2.4; demo contract §7).

Captain ruling `corpus-real-derived-provenance` (2026-07-28) formally defers population, recorded through
the same ADR mechanism the Salesforce deferral uses (ADR-0024 → ADR-0034).

## What is blocked while it is empty

- **`detectionRate` is never emitted.** `pnpm corpus:report` returns `null` with
  `reasonCode: "real-derived-corpus-absent"` and refuses to substitute the synthetic figure. The synthetic
  partition's figure is called `syntheticDefectCoverage` - a different word, deliberately.
- **Phase 1 is not complete.** Synthetic coverage cannot stand in for real-derived performance.
- **No investor-facing detection-rate claim is permitted.**

## Un-defer trigger

The captain supplies:

1. an authorized scrubbed source of real NIGO returns, custodian rejections, or operational exceptions;
2. an accountable owner for extraction and de-identification;
3. an agreed delivery date and review path.

## What a case here must satisfy

The intake pipeline is already shipped and already runs over this (empty) directory in the `corpus` CI job -
see `docs/corpus-scrub-procedure.md` for the procedure and `scripts/corpus/scrub-contract.ts` for the
enforced contract. In short, every case must carry:

- a complete **`scrubAttestation`** (source-system class, opaque extractor/scrubber/reviewer identities
  and their chronological instants, records before and after, scrubbing method), with review by someone
  other than the scrubber;
- **closed-vocabulary values only**. No free text at all: every string is a canonical instant, an opaque
  `tok:<16 hex>` token, a derived id built from tokens, or a member of a declared vocabulary. An
  unanticipated string is REJECTED, so a scrubbing miss has nowhere to live;
- canonical JSON bytes with unique object keys, canonical key order, and exactly one trailing newline;
- a `caseId` of the form `RD-<16 hex>`, disjoint from `CS-` corpus ids and `GC-` signed golden ids.
- the strict `verin-real-derived-replay/1.6.0` payload: entity-kind-scoped destination, ownership,
  liquidity, pending-action direction, authority, threshold and policy, tax review, instruction conflict,
  temporal state, reservations, and execution preconditions. The explicit funding set must resolve once,
  stay within the request household and source-account ownership, and cover the request, reserve, and
  reducing pending actions in aggregate. Every supported class records typed expected and observed
  treatment. Extra, absent, ambiguous, or incompatible inputs are rejected;
- one exact opaque `firmRef` shared by the case, request, and every reservation, with reservation
  identity defined by `(firmRef, conflictKey)`;
- exactly one matching evidence record by kind, subject, source, and permitted observation state for
  every material replay plane. Missing evidence supports only an explicit absence or unavailable payload;
- typed instruction terms bound to the exact request action, source, destination, tenant, household, and
  instruction identity. Every supplied instruction requires exact observed evidence;
- `evaluation.asOf` plus freshness policy `verin-real-derived-freshness/1.0.0`; observed evidence must
  satisfy `observedAt <= retrievedAt <= evaluation.asOf` and match the derived per-kind freshness.
  `unknown` is legal only for the typed missing-observation state. The policy version and semantic digest
  are bound into captain signoff through `corpusDigest`;
- semantic contract `verin-real-derived-semantics/1.7.0`; its declarative bytes and the complete
  repository-local runtime dependency closure of its executable cross-field authorities are bound into
  `corpusDigest`.

Rejected values and unrecognized keys are never copied into validation output. Diagnostics contain only
bounded safe field paths and redacted descriptions.

Files here are **hand-delivered under the procedure, never generated**. `pnpm corpus:generate` does not
write to this directory.
