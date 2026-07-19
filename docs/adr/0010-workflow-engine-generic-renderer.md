# ADR-0010: A generic workflow engine + generic renderer, not bespoke screens

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiables #5, #10; deliverable E
**Informed by:** retro-r7 do-again #29 (generic engine ~177 lines/flow vs 700-1,370-line god components); don't-again #10, #33 (per-screen bespoke code; the flagship becomes a bespoke screen inside the clean architecture); gap-s4 §2.4

## Context

Meridian hand-built ~30 bespoke 469-1,202-line screens; at 40 workflows that is 80K+ lines of screen code.
Iris replaced this with a generic engine interpreting declarative flow definitions ("a workflow costs
~200 lines"), but its flagship (fact-find) still ballooned into a 16K-line bespoke sub-product. Lesson: the
hardest workflow will try to become a bespoke screen — budget and fence it from day one.

## Decision

A `FlowDefinition` (declarative: id, steps, inputs, view, compliance mapping, allowed roles) is executed by
a generic engine (`domain/workflow`) and rendered by a **generic renderer** driven by a display-component
registry (adding a display is a file drop + one registry line). The walking skeleton's ACCOUNT OPENING is a
flow definition, not a bespoke screen. Flow steps support suspend/resume (ADR-0011). Per-file and per-layer
line ceilings (ADR-0018, ratchet-down) keep any one flow from becoming a god component; if a flow genuinely
needs bespoke richness, it gets an explicit, ADR-fenced budget (as Iris did for fact-find) — never a silent
exception.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Bespoke screen per flow (Meridian) | 80K+ lines at scale; every trivial bug fixed N times (no shared primitives). |
| Generic engine with no budget on the flagship (early Iris) | The flagship silently became a 16K-line bespoke screen, falsifying the bet. |

## Trade-offs and Costs

- **Gained:** a flow costs ~hundreds of lines; the shell/renderer improvements multiply across every flow.
- **Sacrificed:** the engine must be expressive enough; genuinely bespoke needs an explicit fenced budget.

## Consequences

The generic renderer + shared shell primitives get accessibility + provenance once and multiply everywhere
(charter #9, #3). Registry completeness is fenced (every flow's view components exist). Presentation-tier
budget is separate (ADR-0012).

## Revisit When

A workflow cannot be expressed as a `FlowDefinition` without hacks — extend the engine, do not bypass it
(and if a surface needs bespoke richness, give it an ADR-fenced budget, ADR-0018).
