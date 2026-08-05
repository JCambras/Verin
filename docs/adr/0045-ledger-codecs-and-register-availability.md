# ADR-0045: Frozen ledger codecs and register availability

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Founding architect
**Amends:** ADR-0018, ADR-0039, and ADR-0044
**Relates to:** Charter non-negotiables #1, #2, #4, #7, #10, #13; v3 invariants 2, 4, 5, 23, 30

## Context

The immutable-table ownership fence recognized a literal `INSERT INTO` target but
missed legal PostgreSQL row-creation forms using `INSERT INTO ONLY`, `COPY FROM`, or
`MERGE INTO`. Event binding proved decision and bundle hashes but did not prove that
approval stages and execution steps belonged to the immutable decision. Recorded-byte
registries also derived their only key and schema from the current contracts, so a
routine version bump could remove the parser needed by retained history.

ADR-0044 correctly requires complete-chain request verification, but its transaction
held the tenant append lock while loading, hashing, and validating every retained row.
That converted an authenticated read into an append-availability risk. Bounded replay
also counted only in-window `DecisionRecorded` omissions, not recent decision-scoped
events whose recording fact had aged out of the displayed window.

## Decision

- The append-only fence resolves and classifies `INSERT INTO`, `INSERT INTO ONLY`,
  `COPY FROM`, and `MERGE INTO` targets. Unsupported or unresolved write SQL fails
  closed outside the exact reviewed driver and migration boundaries.
- The shared append and L2 source-binding authority parses the immutable decision and
  rejects approval stage, escalation step, or execution step identifiers absent from
  its recorded authority or execution plan.
- Recorded ledger 1.1.0 and decision-core 1.7.0 schemas are frozen as digest-pinned JSON
  Schema artifacts. Literal registry entries own their recorded parser, canonical
  serializer, hash preimage, chain preimage, and pure current upcast. New versions add
  entries and do not replace historical handlers.
- The operator register captures tenant existence, anchor state, and the complete
  append-only chain in one MVCC-consistent statement. L1-L4 and immutable-source checks
  run against that captured chain without holding the tenant append lock. Gate and
  rebuild operations retain their transaction lock because they authorize recovery
  mutations or examiner-grade verification.
- Bounded replay reports every decision-scoped identifier that cannot be materialized
  from the displayed window, including recent events whose recording fact is older than
  the window.
- ADR-0018's contracts ceiling rises from 4,600 to 4,650 and infrastructure rises
  from 7,250 to 7,700. The measured results are 4,598 and 7,652 lines, leaving 52
  and 48 lines of bounded correction headroom. Domain measures 1,584/1,600 and
  presentation 917/6,000.

## Alternatives Rejected

| Alternative | Why rejected |
|-------------|--------------|
| Continue matching only `INSERT INTO` | PostgreSQL provides other legal paths that create immutable rows. |
| Validate stage and step identifiers only in projections | Invalid bytes would already be permanent and L2 could disagree with rebuild. |
| Point historical keys at the current Zod objects | A current-version edit could strand retained immutable rows. |
| Keep the request transaction and tenant lock | Complete-chain verification time grows with retention and would block every append. |
| Verify only the bounded tail | Historical facts consumed by semantic verification would remain unauthenticated. |

## Consequences

Historical parsers and preimage handlers are explicit compatibility assets. Their
content digests fail tests on silent edits, and the two-version dispatcher companion
proves additive lookup behavior. Adding an encoding requires a new frozen schema,
codec entry, upcast, preimage handlers, and dispatch coverage.

Request verification remains linear in retained chain size, but it no longer holds the
append lock during that work. The single-statement capture is consistent because the
chain rows and anchor advance atomically and existing source and ledger rows are
append-only. A future authenticated checkpoint or skip-proof design can reduce read
cost without weakening full-chain authority.

## Revisit When

The next ledger or decision-core schema version is recorded, or measured request
latency requires an authenticated checkpoint topology.
