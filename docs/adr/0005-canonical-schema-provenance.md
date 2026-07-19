# ADR-0005: Canonical schema + provenance dictionary, scoped to declared need

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #2, #3
**Informed by:** retro-r7 missing-prompt #1, don't-again #7 (no golden-record layer, no field-level provenance); gap-s4 §2.1 (health computed from seeded breakdowns)

## Context

Neither prior build modeled a canonical schema with provenance up front; Meridian smuggled structured data
through free-text fields and re-modeled the same household (Shakespeare) three incompatible ways, and had
"no conflict detection, no field-level provenance." That is the highest-risk data gap.

## Decision

Model **only** the entities the walking skeleton + declared day-one flows require — no speculative fields;
extend flow-by-flow under the same fence. Foundation entities: `Org`, `User`, `Session`, `Household`,
`Contact`, `FinancialAccount`, `AccountOpeningApplication`, `Task`, `AuditEntry`. Every modeled field
carries: **type, nullability, unit, and provenance** — `source` (system), `asOf` (timestamp), `confidence`,
and a `survivorship` rule for when two sources disagree. A **provenance-required fence** (Phase C) fails the
build on any modeled entity field lacking a provenance annotation. Derived values (e.g. a household health
score) render with their formula and `asOf`, never as a bare number. A **golden-record conflict policy**
(field-level provenance + survivorship precedence) anticipates a future second source so connecting one
never corrupts the record. A **Salesforce object-graph mapping** declares read-vs-write ownership per
*modeled* field (documentation; grows flow-by-flow).

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Model the full RIA domain up front | Speculative fields the charter forbids; unused schema rots. |
| Passthrough with no provenance (Meridian) | Produces incorrect compliance decisions; no conflict detection. |
| Free-text blobs for structure | The Meridian smell (structured data in a `description` field). |

## Trade-offs and Costs

- **Gained:** every field's origin is known and enforced; synthetic/estimated values are labeled and cannot
  feed a compliance decision (charter #3); a second source can join without corrupting the golden record.
- **Sacrificed:** every new field must declare provenance (a deliberate tax).

## Consequences

Pairs with ADR-0004 (`source=verin-crm` on house-CRM rows) and the no-unlabeled-synthetic-data fence +
the displayed-metric→source CI trace (charter #3). The schema grows only flow-by-flow under the fence.

## Revisit When

A second data source is connected (activate survivorship end-to-end), or a modeled entity needs fields no
day-one flow uses (that is a new flow's PR, with its provenance annotations).
