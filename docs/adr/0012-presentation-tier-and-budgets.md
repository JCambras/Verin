# ADR-0012: The presentation tier is a first-class product surface with its own budget; demo world deferred

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect; captain (D-005)
**Relates to:** Charter non-negotiable #10; deliverable D
**Informed by:** gap-s4 §2, §3-Structural (shell "scheduled for retirement"; shrink-only budget "punished richness"); retro-r7 do-again #36/#37 (line budgets), don't-again (shrink-only global budget)

## Context

Meridian's feel came from a rich presentation tier (tokens, micro-components, WhyBubble doctrine, a
populated world, tour/narration/recorder engines). Iris kept the CSS vocabulary but demoted the shell to
"scheduled for retirement," and its shrink-only line budget *penalized* adding richness. The charter makes
the presentation tier first-class and never "scheduled for retirement," lives it in `app/presentation/`
(app layer, so ports stay architecture-safe), and gives it its **own separate budget** — generous and
growable by an ADR bump — so richness is planned, not sprawling, while platform ceilings stay ratchet-down.

## Decision

- **Home:** `src/app/presentation/`. Port from Meridian: the OKLCH slate tokens + Geist fonts, the "Verin."
  wordmark (trailing period is brand), the micro-component vocabulary, and **WhyBubble as doctrine** — every
  automated decision explains itself and cites a regulation.
- **Port on first use only:** the skeleton ports just the components its screens render; everything else
  worth porting is catalogued in `PORT-LEDGER.md` (source `file:line`, what, why, when) and pulled when a
  real surface needs it (charter #5: no dead components).
- **Separate budget:** the presentation tier has its own line budget (ADR-0018), grown only by an ADR bump.
  Platform ceilings (contracts/domain/infrastructure) stay ratchet-down and are unaffected by presentation richness.
- **Demo-choreography engines (tour / narration / recorder):** *planned here by ADR now, ported at the first
  demo milestone* — never scaffolded empty on day one. Designs captured: an `AutopilotScene` engine driving
  the real UI with narration synced to audio `ended`; walkthrough overlays with an animated cursor + native-
  setter typing; a `MediaRecorder`-based ScreenRecorder.
- **The populated demo world is DEFERRED (captain D-005: "I want the feel, but no fake data yet").** The rich
  named-household/persona/computed-health world is NOT seeded now. **Un-defer trigger: the first demo
  milestone** — the same milestone that un-defers the engines above. Until then, only minimal, clearly-labeled
  functional seed exists (`source=verin-crm`, `asOf`, visible provenance) for the skeleton, its specs, the
  console, and the load gate. All deferred items are enumerated with `file:line` + trigger in `PORT-LEDGER.md`.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Retire the shell / neutral prod surface (Iris) | Neutrality reads as unfinished; the presentation tier wins rooms. |
| One shrink-only budget for everything (Iris ADR-0031) | Structurally punishes richness where users most want it. |
| Seed the full populated world now | Captain D-005 defers it; charter #3 forbids unlabeled synthetic data. |
| Scaffold tour/narration/recorder empty on day one | Charter #5/#10: no built-but-not-shipped; plan now, port at the demo milestone. |

## Trade-offs and Costs

- **Gained:** planned richness with an owned budget; the feel without the fake data; nothing dead scaffolded.
- **Sacrificed:** the marquee demo world waits for the demo milestone; PORT-LEDGER upkeep.

## Consequences

`PORT-LEDGER.md` names every deferred non-data capability (the debrief's 20 gaps) with `file:line` + trigger.
Budget fence (ADR-0018) gives presentation its own envelope. WhyBubble ships live in the skeleton.

## Revisit When

**The first demo milestone** (un-defers: the populated world, the tour/narration/recorder engines, and the
presenter tooling). Or the presentation budget needs raising (an explicit ADR bump — never a silent edit).
