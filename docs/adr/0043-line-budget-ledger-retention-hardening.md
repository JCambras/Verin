# ADR-0043: Infrastructure line budget for ledger retention hardening

**Status:** Accepted
**Date:** 2026-08-05
**Deciders:** Founding architect
**Amends:** ADR-0018 and ADR-0042
**Relates to:** Charter non-negotiables #1, #4, #7, #10, #13

## Context

Adversarial review found that unresolved SQL values could bypass immutable-table insert
ownership, sensitive-length numeric values and human-shaped namespaced references could
enter retained replay bytes, and bounded register replay selected an evidence snapshot's
earliest recording even when a later verified recording was inside the window.

Closing those shared boundaries adds semantic SQL resolution, a fail-closed dynamic-SQL
registry, exact retained machine identifiers, numeric account-reference refusal, and
window-qualified evidence selection. The corrected infrastructure layer measures 6,608
lines against the 6,550-line ceiling.

## Decision

Raise the infrastructure ceiling from 6,550 to 6,650 lines. This is the smallest rounded
envelope that contains the measured implementation with bounded correction headroom. The
500-line default file cap remains unchanged.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Leave unresolved SQL unclassified | Makes the immutable-table ownership fence fail open. |
| Retain broad namespaced identifiers | Human names remain representable inside immutable reference bytes. |
| Suppress decisions with any pre-window evidence recording | Discards a decision whose complete replay facts are verified inside the selected window. |
| Compress or delete boundary documentation | Manufactures budget room without reducing runtime complexity. |

## Trade-offs and Costs

- **Gained:** fail-closed immutable insert ownership, safer replay retention, and correct bounded replay.
- **Sacrificed:** 58 infrastructure lines above the prior ceiling and another measured amendment.

## Consequences

The line-budget fence records 42 lines of infrastructure headroom. Any further increase
still requires a measured ADR amendment.

## Revisit When

The ledger boundary is consolidated after later-prompt producers land, or the next measured
infrastructure correction exhausts this bounded headroom.
