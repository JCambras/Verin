/**
 * Provenance helpers for the demo skeleton. Bridges the demo's FakeClass taxonomy
 * (model.ts) to the repo's real provenance vocabulary (@contracts/provenance) so the
 * fake service builds honest FreshValue / Metric provenance and every fake value is
 * labeled (charter #3; design §11.1). No new source system, format, or token is
 * introduced here - only compositions of the shipped contracts.
 */
import { metric, type DisplayMetric, type MetricFormat } from "@contracts/metric";
import {
  type RecordProvenance,
  type DerivedProvenance,
  type SourceSystem,
  type Confidence,
  deriveArtifactProvenance,
} from "@contracts/provenance";
import type { FactVM, FakeClass } from "./model";

/** The SourceSystem a fake class renders under (drives the FreshValue "source · as of"
 * label). The precise fake class is always ALSO carried by a DevProvenanceBadge. */
const SOURCE_FOR_CLASS: Record<FakeClass, SourceSystem> = {
  "synthetic-fixture": "fixture",
  "real-derived-fixture": "fixture",
  "fake-adapter-response": "fixture",
  "user-entered-demo-input": "user-input",
  "deterministic-engine-output": "computed",
  "llm-proposed-draft": "user-input",
};

/** A record-level provenance for a raw sourced value in the given fake class. */
export function prov(fakeClass: FakeClass, asOf: string, confidence: Confidence = "high"): RecordProvenance {
  return { source: SOURCE_FOR_CLASS[fakeClass], asOf, confidence };
}

/** A sourced fact (observed=asOf, plus retrieved metadata) - the EvidenceRow shape. */
export function fact(display: string, fakeClass: FakeClass, observedAt: string, retrievedAt: string, confidence: Confidence = "high"): FactVM {
  return { display, provenance: prov(fakeClass, observedAt, confidence), retrievedAt };
}

/** A raw metric-class value (a balance, a count) labeled with its fixture provenance. */
export function fixtureMetric(value: number, format: MetricFormat, fakeClass: FakeClass, asOf: string): DisplayMetric {
  return metric(value, format, prov(fakeClass, asOf));
}

/**
 * A DERIVED metric - a figure the engine computes from evidence. In the skeleton the
 * inputs are all synthetic, so `deriveArtifactProvenance` marks it a demonstration and
 * `<Metric>` renders the "Demonstration - not a compliance record" watermark (ADR-0022).
 */
export function derivedMetric(value: number, format: MetricFormat, inputs: readonly RecordProvenance[], asOf: string): DisplayMetric {
  return metric(value, format, deriveArtifactProvenance(inputs, asOf));
}

/** The demonstration provenance for the whole decision record (§9 watermark rules). */
export function recordProvenance(inputs: readonly RecordProvenance[], asOf: string): DerivedProvenance {
  return deriveArtifactProvenance(inputs, asOf);
}
