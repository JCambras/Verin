# ADR-0020: Sacrificial-component discipline with a written register

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiable #5
**Informed by:** retro-r7 do-again #35; don't-again #42 (HubSpot stub cost ~2 days + left doc drift for two review cycles)

## Context

Some components are deliberately temporary (a dev/demo seed, a simulated adapter). Without a written
deletion trigger, a sacrificial component becomes permanent by accident, and its doc references drift after
it is removed (Iris chased HubSpot-stub drift across review cycles).

## Decision

`docs/sacrificial-components.md` is a register: for each deliberately-temporary component it records the
**role**, the **replacement-or-deletion trigger**, and the **guardrails** (e.g. must not run in production).
Foundation entries include: the **simulated e-sign provider/webhook** (replaced when a real e-sign adapter
is wired), the **minimal labeled seed** (replaced/expanded at the first demo milestone per D-005/ADR-0012),
and the **PGlite dev/CI store adapter** (production swaps to managed Postgres — durable role, sacrificial in
posture). No sacrificial component may be built unless it is reachable and used now (charter #5); nothing is
scaffolded empty.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| No register | Temporary components become permanent by accident; doc drift after removal (retro #42). |
| Never allow temporary components | The simulated e-sign is required to prove suspend/resume without a real vendor. |

## Trade-offs and Costs

- **Gained:** every temporary component has an owner and a deletion trigger; clean removal, no drift.
- **Sacrificed:** register upkeep.

## Consequences

Charter #5 (nothing built-but-not-shipped): the register's components are all reachable and used now; the
knip dead-export gate backs this mechanically. Demo-mode isolation (a fence, Phase E) ensures sacrificial
demo affordances cannot run in production.

## Revisit When

A sacrificial component's trigger fires (delete it and prune its doc references in the same PR), or a new
temporary component is introduced (add a register entry with its trigger).
