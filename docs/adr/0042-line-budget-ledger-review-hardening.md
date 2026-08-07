# ADR-0042: Infrastructure line budget for ledger review hardening

**Status:** Accepted
**Date:** 2026-08-04
**Deciders:** Founding architect
**Amends:** ADR-0018 and ADR-0041
**Relates to:** Charter non-negotiables #1, #3, #4, #10

## Context

Review of the prompt-7 ledger found that transaction capability did not establish
tenant ownership, retained identifiers admitted human-shaped text, failed verification
still disclosed rows, and projection counts bypassed metric provenance. Correcting the
shared boundaries requires sealed authority at every ledger repository, type-level PII
markers for retained replay values, verified register disclosure, and adversarial tests.

After those corrections and file-cap cleanup, and composed with ADR-0040's prompt-8
primitive catalog, the infrastructure layer measures 6,507 lines. Contracts measure
5,951 and domain measures 1,584.

## Decision

Raise the infrastructure ceiling to 6,550 lines, contracts to 6,000, and domain to
1,650. Each is the smallest rounded envelope that contains the measured implementation
with bounded correction headroom. The 500-line default file cap remains unchanged.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Remove sealed authority checks or adversarial companions | Makes the budget green by restoring the defects under review. |
| Hide repository growth in app or domain helpers | Violates dependency ownership and moves SQL-bound validation out of infrastructure. |
| Raise the per-file cap | The affected files fit the existing cap after local cleanup. |

## Consequences

The line-budget fence records the measured baseline and retains 43 lines of infrastructure
headroom. Any further increase still requires a measured ADR amendment.
