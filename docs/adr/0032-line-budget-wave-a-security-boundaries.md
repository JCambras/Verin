# ADR-0032: Line-budget amendment for the Wave A security boundaries (prompt 6)

**Status:** Accepted
**Date:** 2026-07-26
**Deciders:** Build agent (reversible, logged per the decision protocol; D-036)
**Relates to:** ADR-0018 (line budgets), ADR-0023 (v3 ratification), charter #1/#7/#12
**Amends:** ADR-0018 platform ceilings

## Context

ADR-0018 set ratchet-down platform ceilings sized for the walking-skeleton foundation
(contracts 600, domain 1200, infrastructure 2500) and made raising any ceiling an ADR
amendment, never a silent code edit. ADR-0023 then ratified the v3 direction: the 30-prompt
build sequence grows the decision core INSIDE these layers (docs/v3/marriage-map.md §6).
Prompt 6 (tenant, actor, PII, and secret boundaries — v3 §15) adds to `contracts/` the sealed
TenantContext, the governed-action authorization registry, the ratified Tokenized<T> shape,
the SecretValue wrapper, and the PIIBearing marker; and to `infrastructure/` the Tokenized
scrubber factory and the llm/ boundary (masked request schema + evidence-to-LLM projection).
`contracts/` measures 695 lines against its 600 ceiling; `infrastructure/` will land near its
2500 ceiling once the llm/ boundary files exist.

## Decision

Raise two platform ceilings, explicitly and by this ADR only:

- **contracts: 600 → 1000** (security-boundary contracts now; headroom for the ratified
  decision-core vocabulary that prompt 5 lands as `src/contracts/decision-core`)
- **infrastructure: 2500 → 3000** (scrubber factory + llm/ boundary now; the three-port
  split arrives in Wave F, prompt 24)
- domain stays 1200; the presentation envelope is untouched (it grows only by its own
  ADR bump, ADR-0012).

The ratchet-down rule is unchanged: at each wave gate the ceilings are re-lowered to
actual + buffer, and the foundation-close ratchet (ADR-0018) still applies. This is growth
scheduled by the ratified sequence, not budget drift.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Squeeze prompt 6 under 600 | The mandated seams (sealed tenant, 7-action authz registry, Tokenized factory rules, secret containment) would lose their documentation or their runtime seals — weakening a security boundary to satisfy a size gate inverts the charter's priorities. |
| Raise ceilings silently in the fence | The exact anti-pattern ADR-0018 names. |
| One big pre-emptive bump for all 30 prompts | Ceilings would stop exerting pressure; each wave should justify its own growth. |

## Consequences

`src/__tests__/fitness/line-budget.test.ts` CEILINGS updates to {contracts: 1000,
infrastructure: 3000} in the same PR as this ADR. DECISIONS.md logs this as D-036 with the
revert path (restore the old numbers once the security-boundary code is trimmed or moved).
