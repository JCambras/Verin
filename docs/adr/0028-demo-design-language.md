# ADR-0028: Demo design language - the established Verin design system is normative

**Status:** Accepted (decision record; `docs/demo-design-language.md` is authored in a parallel task under this ruling)
**Date:** 2026-07-26
**Deciders:** captain (design directive, 2026-07-26 - ruling), founding architect
**Relates to:** charter #9 (WCAG 2.2 AA), #10 (presentation tier as first-class surface; WhyBubble doctrine); ADR-0012 (presentation tier and budgets); ADR-0023 (v3 adoption); v3 §2.2 (required screens), prompt-sequence prompts 3/29 and standing rules ("read docs/demo-design-language.md before any UI work")
**Informed by:** `docs/v3/marriage-map.md` conflict C15 and the captain design directive recorded there

## Context

v3's prompt sequence hard-gates all UI work on a `docs/demo-design-language.md` that would define
tokens, the Decision Spine top rail, ledger-register styling, disposition treatments, and three
orchestrated motion moments. An external draft of that document existed - and the captain ruled against
its look: the demo's feel is the ESTABLISHED Verin design system, already built, chartered, and fenced:
Meridian's feel with Iris's discipline - OKLCH slate tokens, Geist, the "Verin." wordmark, calm
one-decision-at-a-time restraint, WhyBubble (every automated decision explains itself), FreshValue
(freshness-as-opacity), StatusBadge/ProgressSteps/StepInfoCard/EmptyState, WCAG 2.2 AA, reduced-motion
support (charter #9/#10, ADR-0012, `src/app/presentation/`).

At the same time, v3 contributes real UX SEMANTICS the established system does not yet express: the
Decision Spine as persistent orientation (where am I in shape → verify), disposition treatments with
teeth (blocked shows its resolving affordances; prohibited shows a terminal treatment and ZERO
affordances - blocked is not prohibited, v3 §10.2), and the approval-invalidation moment (approval
visibly voided when material evidence changes, v3 §11).

## Decision

1. **The established Verin design system is NORMATIVE for all demo UI.** Every v3 screen (§2.2) is
   rendered in the existing token system, type, components, and calm-restraint doctrine. v3's visual
   prescriptions (its look, motion styling, and any external design-language draft) are REJECTED.
2. **v3's UX semantics are ADOPTED** and re-expressed in the established visual language: the Decision
   Spine as persistent orientation; proceed/blocked/prohibited as structurally distinct treatments
   (blocked renders resolving affordances; prohibited renders zero affordances); the
   approval-invalidation moment as a first-class, legible state change. WhyBubble becomes the renderer
   of explanation-trace nodes (marriage-map §2); FreshValue renders evidence freshness.
3. **`docs/demo-design-language.md` is AUTHORED from the existing presentation tier** (not adopted from
   outside) in a parallel task; this ADR records the ruling it must implement. Until that document
   lands, UI prompts (3 and 29) remain BLOCKED per the prompt sequence's standing rule - the gate stands,
   only the document's source changed.
4. Accessibility and motion discipline are unchanged and non-negotiable: WCAG 2.2 AA on every primitive,
   axe in CI, reduced-motion honored for any orchestrated moment.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Adopt the external v3 demo-design-language draft | The captain's ruling is explicit ("hates the v3 demo look"); the established system is already built, fenced, budgeted (ADR-0012), and a11y-proven - replacing it buys nothing and reopens every settled visual decision. |
| Reject v3's UX semantics along with its visuals | The semantics carry decision-core meaning the demo must show (disposition distinctions, spine orientation, invalidation moment - v3 invariant 27). Discarding them would make the UI unable to express the product's own states. |
| Skip the design-language document and let UI prompts improvise | The prompt sequence's standing rule exists to stop token improvisation; removing the gate invites drift from the established system - the exact thing this ruling protects. |
| Two design systems (established for product, v3 for demo) | The demo IS the product surface (charter #10; v3 non-negotiable 12); a fork guarantees divergence and doubles the budgeted surface. |

## Trade-offs and Costs

- **Gained:** demo UI continuity with everything already built and proven; the captain's aesthetic
  ruling is durable and machine-findable; v3's genuinely new UX semantics arrive without a visual
  rebuild.
- **Sacrificed:** the parallel authoring task must translate v3's semantic requirements into the
  established language before any UI prompt can run (a real scheduling dependency); any v3 illustration
  or mock referencing its rejected look must be re-derived.

## Consequences

- UI prompts (3, 29) stay blocked until `docs/demo-design-language.md` exists and satisfies this ADR;
  `docs/v3/README.md` and the PR template's phase field make that dependency visible.
- The authored document must cover, at minimum: token mapping for the required screens (v3 §2.2),
  Decision Spine orientation, the three disposition treatments (with the affordance rules above),
  approval-invalidation, evidence freshness rendering, and the printable examiner-grade record - all
  within ADR-0012's presentation budget discipline.
- v3 invariant 27 ("the UI distinguishes blocked, prohibited, approved, submitted, and verified
  states") activates against THIS design language when the demo UI lands.

## Revisit When

- `docs/demo-design-language.md` lands: verify it implements this ruling (established system + v3
  semantics); gaps are fixed in that document, not by reopening this ADR.
- The captain re-rules on the demo look (only the captain can).
- Investor-demo rehearsal (prompt 29) shows a v3 semantic that cannot be expressed in the established
  language without breaking calm-restraint or a11y: raise as a contradiction; do not improvise a new
  visual idiom.
