# ADR-0027: Demo-first Wave 0 on labeled fakes - charter #5 extension, no mock theater

**Status:** Accepted (charter #5 amendment - additive extension)
**Date:** 2026-07-26
**Deciders:** captain (v3 ratification, 2026-07-26), founding architect
**Relates to:** charter #5 (nothing built-but-not-shipped; no mock theater); charter #3 / ADR-0022 (labeling doctrine); DO-NOT-PORT #1 (demo shadow-world) and #3 (setTimeout fake "extraction"); ADR-0024 (Salesforce deferral); v3 orchestrator rules 5-6, prompt 3, §8.1, demo-contract §6
**Informed by:** `docs/v3/marriage-map.md` conflict C14

## Context

v3 orders the UI walking skeleton BEFORE the engine (orchestrator rule 5: "Phase 1 is a demonstrated
product, not an API collection"); prompt 3 builds the full screen sequence on static contract data and
fake service interfaces. Read naively, that collides with two of this repo's hardest-won rules:
charter #5 ("no mock theater: critical-path tests exercise the real engine, and no test may pass solely
because its mock always succeeds") and DO-NOT-PORT #1/#3 - the Meridian diseases of a client-side
shadow world and setTimeout fake "AI extraction" pretending to be product.

But v3's own text closes the gap. Demo-contract §6 requires EVERY visible data element to carry an
internal provenance label (`synthetic-fixture`, `real-derived-fixture`, `fake-adapter-response`,
`real-salesforce-sandbox-response`, `user-entered-demo-input`, `deterministic-engine-output`,
`llm-proposed-draft`); prompt 3 requires every fake-backed value to carry a visible development-only
provenance badge "removable only when the corresponding real path lands"; and orchestrator rule 6
forbids declaring Phase 1 complete on fakes. That IS this repo's charter #3 labeling doctrine
(ADR-0022's watermark discipline) applied to fakes (marriage-map C14).

## Decision

**Wave 0's clickable walking skeleton on fake data is charter-legal, under four conditions that make it
the opposite of mock theater - and charter #5 is extended (additively) to say so:**

1. **Every fake carries provenance.** Each fake-backed value or status is internally labeled per
   demo-contract §6 and renders a development-only provenance badge. The label is removable ONLY when
   the corresponding real path lands (prompt 28 removes badges solely for paths prompt 27 made real).
   This extends charter #3's labeling doctrine to fakes; it is an extension, never a weakening.
2. **Fakes are typed port implementations, not a shadow world.** A fake is an in-memory implementation
   of a real port contract (v3 §8.1) that later passes the SAME conformance suite as the real adapter
   (prompt 24). The banned pattern - client-side parallel state pretending to be the product
   (DO-NOT-PORT #1), setTimeout theater (#3) - has no port, no contract, no conformance suite, and no
   label. UI renders typed view models; no decision branches in components (prompt 3).
3. **Shipped-in-the-same-PR stands.** The Wave 0 screens are reachable from the UI in the PR that adds
   them (charter #5's reachability clause is satisfied, not exempted); knip stays green.
4. **Done is never declared on fakes.** Orchestrator rule 6 + ADR-0024: Phase 1 completion, and any
   "real" status claim (v3 invariant 28), require the real path. As the engine lands wave by wave,
   critical-path tests exercise the real engine (charter #5's test clause), and golden cases judge it
   against signed expected outcomes - a fake that "always succeeds" can never green a gate, because
   gates D-F run against the engine and conformance suite, not the demo skeleton.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Engine-first, UI last (no walking skeleton) | Violates v3 orchestrator rule 5 and non-negotiable 12 (the investor experience is a first-class deliverable); repeats the Iris failure mode - a technically correct engine with no product proof (v3 §0.6). |
| Unlabeled fakes ("it's just a demo") | The exact Meridian disease (DO-NOT-PORT #1/#3) and a charter #3 violation; also breaks v3 §20 risk 9 ("a polished UI can conceal fake mechanics. Every simulated element is labeled"). |
| Treat prompt 3 as a charter violation and skip Wave 0 | The marriage map shows the reconciliation is real, not rhetorical: labels + ports + conformance + rule 6 remove everything the charter banned about mock theater. Skipping Wave 0 would silently override ratified direction. |
| Waive charter #5 for demo code | Charter non-negotiables are never downgraded to make progress (charter mission text). An additive extension with conditions is the only legal shape. |

## Trade-offs and Costs

- **Gained:** the investor experience becomes tangible from Wave 0; screens and view models are built
  against the contracts the engine must satisfy (the skeleton is a consumer-driven contract test);
  fake-vs-real is mechanically visible at all times.
- **Sacrificed:** badge/provenance plumbing for data that is eventually replaced; the discipline cost of
  refusing "quick" unlabeled fixtures forever; some Wave 0 UI work will be reshaped when real view
  models arrive.

## Consequences

- `CHARTER.md` non-negotiable #5 gains an EXTENSION paragraph referencing this ADR (same PR, per the
  operating model), following the ADR-0022 precedent on #3.
- Wave 0 (prompts 1-3) may proceed once ADR-0028's gate is satisfied (`docs/demo-design-language.md`
  must exist before UI work).
- The fake-badge mechanism must reuse the existing provenance machinery (`RecordProvenance`,
  `<Metric>`/`DisplayMetric`, `deriveArtifactProvenance`) rather than inventing a parallel labeling
  system - demo-contract §6 labels become provenance sources in the data dictionary when Wave 0 lands,
  and the metric-provenance/derived-provenance fences apply to demo surfaces exactly as to real ones.
- Prompt 28's badge removal is auditable: removing a badge without a real path is a fence-visible
  provenance change, and the adversarial audit (prompt 30) hunts "fake data presented as real".

## Revisit When

- Prompt 27/28 land (ADR-0024 trigger fired): badges come off real-backed paths only; this ADR's
  condition 1 governs the removal review.
- Any demo, screenshot, or investor artifact presents a fake-backed status as real: that is a control
  failure, not a style issue - stop, record, and fix the mechanism that allowed it.
- Wave 0 concludes: if the skeleton's fake view models diverged materially from the landed engine
  contracts, record the delta so the consumer-driven-contract claim above stays honest.
