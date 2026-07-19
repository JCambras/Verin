# ADR-0022: Charter #3 extension — derived compliance artifacts are demonstrations

**Status:** Accepted (charter #3 amendment — derivation rule enforced now; artifact-class + examiner-export enforcement deferred with triggers)
**Date:** 2026-07-19
**Deciders:** captain (Verin POC strategy directive, 2026-07-19), founding architect
**Relates to:** charter non-negotiable #3 (no unlabeled synthetic; synthetic can never feed a compliance decision); charter #13 (examiner-export path); ADR-0005 (provenance), ADR-0007 (tamper-evident audit trail), ADR-0012 (demo world deferral, D-005)
**Informed by:** Verin post-foundation roadmap (s3) §7 ADR #1; FOUNDATION.md Vale V12 deferral (displayed-metric→source trace); the pre-mortem risk "a demo compliance figure leaks into a real examiner-export"

## Context

Charter #3 says every estimated/defaulted/fixture value renders with a source/asOf label and can never
feed a compliance decision, and mandates a CI trace `displayed metric → source`. The foundation enforced
this at two layers: the schema half (`no-unlabeled-synthetic` — a synthetic-sourced field may not feed
compliance) and the display half (FreshValue requires provenance). The CI `displayed-metric→source` trace
was explicitly deferred as Vale V12 (`FOUNDATION.md`), with the trigger "before any synthetic/estimated
value renders."

Wave 1 un-defers the **populated demo world** (captain D-005 / ADR-0012): a book of *labeled-synthetic*
households (`source=fixture`, visible provenance). That is exactly the trigger. But it exposes a hole the
charter's prose leaves open: charter #3 governs a *value's* source, not a value **derived** from other
values. The moment a compliance-scan or a health score is computed over a demo household, a synthetic input
feeds a compliance decision — through a derived artifact whose own `source` looks innocuous (`computed`),
even though its inputs were synthetic. Nothing in the foundation stops that derived artifact from being
treated as real, displayed without a demonstration label, written into the audit trail, or swept into an
examiner-export. This is precisely the pre-mortem failure ("a demo compliance number leaking into a real
record") that fails a SOC 2 Type II audit.

## Decision

**Extend charter #3 so the "synthetic can never feed a compliance decision" rule runs end-to-end through
DERIVED artifacts.** A value derived from one or more inputs is only as trustworthy as its
least-trustworthy input: **if any input is synthetic, the derived value is itself synthetic — a
"demonstration" artifact.** A demonstration artifact:

1. **is watermarked** `"Demonstration — not a compliance record"` wherever it renders (charter #3 display
   half, now via `<Metric>`);
2. **can never feed a real compliance decision** — `canFeedComplianceDecision` refuses it, even though its
   own `source` is `computed`;
3. **is written under a demo audit class** when persisted (so demo activity is separable from the real
   tamper-evident record); and
4. **is excluded from the real examiner-export** (charter #13), so a demonstration figure can never appear
   in an artifact handed to a regulator.

This is an **EXTENSION, never a weakening.** No value that was permitted before is now forbidden
differently; a *new class* of value (derived-from-synthetic) is brought under the rule the charter already
states. It closes the displayed-metric→source trace (Vale V12) so it runs through derived artifacts, not
just leaf fields.

**What ships in this PR (enforced now):**
- The derivation vocabulary in `contracts/provenance.ts`: `deriveArtifactProvenance(inputs, asOf)` returns
  `DerivedProvenance` with `demonstration = any input synthetic`, `source = "computed"`, and a
  `derivedFrom` trace; `isDemonstration`; the `DEMO_WATERMARK` constant.
- `canFeedComplianceDecision` extended to refuse demonstration artifacts (rule 2 above).
- The `DisplayMetric`/`<Metric>` surface (`contracts/metric.ts`, `app/presentation/metric.tsx`) renders the
  watermark whenever `isDemonstration` is true, so a metric derived from a demo household self-labels.
- Two build-failing fences under charter-map #3, both run in the `provenance-trace` CI job:
  `metric-provenance` (no metric-class field renders without provenance — Vale V12) and `derived-provenance`
  (the derivation law: synthetic input ⇒ demonstration ⇒ cannot feed compliance).

**What is deferred with a trigger (design contract):**
- Rule 3 (demo audit class on persisted artifacts) lands with the first flow that computes and persists a
  compliance artifact — **compliance-scan (Wave 1)** — fenced in that PR.
- Rule 4 (examiner-export exclusion) lands with the **examiner-export path (Wave 3)** — fenced in that PR.
  Building either now, with no compliance artifact yet computed or exported, would be speculative
  (charter #5 / DO-NOT-PORT). The vocabulary they consume (`isDemonstration`, the demo audit class) ships
  now in `contracts/` as forward vocabulary, like `canFeedComplianceDecision` before it.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Leave charter #3 as-is; rely on developers not to compute compliance over demo data | Prose-only invariant — the exact class the charter forbids. A single forgotten label leaks a demo figure into a real record. |
| Do not seed a labeled-synthetic world at all (keep D-005 deferred) | Contradicts the declared demo milestone; the roadmap's demo-anchored-depth path needs the populated world in Wave 1. |
| Mark the whole demo world non-compliance and stop there | Does not compose: derived artifacts (a scan over a demo household) still look real; the hole is in *derivation*, not in the leaf data, which was already labeled. |
| Weaken #3 to "synthetic may feed a *demonstration* compliance decision" | A weakening. The charter forbids downgrading a non-negotiable; this must be an extension that only adds constraints. |
| Watermark at render only, without refusing compliance use | A watermark is display; the real risk is a demo figure *feeding a decision* or an *export*. Refusal at `canFeedComplianceDecision` + export exclusion are the load-bearing controls. |

## Trade-offs and Costs

- **Gained:** the displayed-metric→source trace runs end-to-end through derived artifacts; a demo book can
  drive a live compliance-scan demo with zero risk of a synthetic figure being mistaken for, or exported
  as, a compliance record; the pre-mortem leak is closed by a machine-checked rule, not a convention.
- **Sacrificed:** a small amount of forward vocabulary in `contracts/` (the demo audit class) ships ahead of
  its first consumer; every future derivation of a compliance artifact must thread input provenance through
  `deriveArtifactProvenance` rather than hand-stamping `source: "computed"`.

## Consequences

- `CHARTER.md` non-negotiable #3 is amended (additively) to state the derived-artifact extension and
  reference this ADR; the PR references ADR-0022 in its charter-amendment section (charter operating model).
- `charter-map.json` #3 now maps to this ADR plus the `metric-provenance` and `derived-provenance` fences;
  the charter-drift fence fails the build if any goes missing or is disabled.
- The `provenance-trace` CI gate now proves the display half and the derived half, not only the schema half.
- **Out of scope / does not do:** it does not build compliance-scan, health scores, the demo audit-class
  column, or the examiner-export path — those land in their own waves under this contract, each fenced in
  its PR. It does not change how *real* (non-synthetic) data flows: an all-real derivation is not a
  demonstration and may feed compliance and be exported normally.

## Revisit When

- **A consenting real design partner supplies real (non-synthetic) data.** Compliance artifacts computed
  over that real book are no longer demonstrations: the watermark, the demo audit class, and the
  export-exclusion no longer apply to them. Revisit this ADR to scope "demonstration" strictly to
  labeled-synthetic-derived artifacts and to define the consent record that flips a tenant from demo to real.
- **The first compliance-scan / health-score flow lands (Wave 1):** implement rule 3 (demo audit class) and
  fence it in that PR.
- **The first examiner-export path lands (Wave 3):** implement rule 4 (exclude demonstration artifacts) and
  fence it in that PR.
