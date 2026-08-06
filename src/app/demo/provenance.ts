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
import {
  DEMO_NOW,
  OBSERVED_RECENT,
  SETUP_SCENARIO_ID,
  scenarioById,
} from "./data";
import { decisionEvidenceSnapshotFor } from "./decision-evidence";

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

/** The leaves every reserve figure stands on. Named so a caller cannot quietly drop
 * one: an omitted leaf is exactly how a derived figure claims a narrower lineage than
 * the inputs it was computed from (ADR-0022's flattening rule). */
const SIGNED_EVIDENCE = decisionEvidenceSnapshotFor(
  scenarioById(SETUP_SCENARIO_ID),
);
const SIGNED_BALANCE = SIGNED_EVIDENCE.availableCash.provenance;
const SIGNED_PENDING =
  SIGNED_EVIDENCE.pendingApprovedActivity.provenance;
const SIGNED_SCHEDULE =
  SIGNED_EVIDENCE.plannedMonthlyWithdrawal.provenance;
const DEMO_REQUEST_AMOUNT = prov("user-entered-demo-input", DEMO_NOW);

/** Where the reserve HORIZON came from. It is a FIRMS fixture on the journey and an
 * administrator's closed choice after setup activation - the same arithmetic, a
 * genuinely different leaf, so it is passed in rather than assumed. */
export const FIXTURE_RESERVE_HORIZON: RecordProvenance = prov("synthetic-fixture", OBSERVED_RECENT);
export const ACTIVATED_RESERVE_HORIZON: RecordProvenance = prov("user-entered-demo-input", DEMO_NOW);

/** The reserve FLOOR is months x the signed monthly schedule. */
export function reserveFloorInputs(horizon: RecordProvenance): readonly RecordProvenance[] {
  return [SIGNED_SCHEDULE, horizon];
}

/** The post-reserve HEADROOM is the whole signed basis minus the floor, so it declares
 * every leaf the floor declares PLUS the pending term and the request being decided.
 * A headroom that traced narrower than its own reserve floor is the exact inversion
 * ADR-0022 exists to prevent. */
export function headroomInputs(horizon: RecordProvenance): readonly RecordProvenance[] {
  return [SIGNED_BALANCE, SIGNED_PENDING, SIGNED_SCHEDULE, DEMO_REQUEST_AMOUNT, horizon];
}

/**
 * The ONE derivation trace behind every displayed reserve floor the ADMINISTRATOR's
 * horizon produces (ADR-0022): the same $48,000 or $96,000 figure must never carry a
 * different trace depending on which step drew it, so the setup step and the activated
 * snapshot read this list instead of restating it.
 */
export const RESERVE_FLOOR_INPUTS: readonly RecordProvenance[] =
  reserveFloorInputs(ACTIVATED_RESERVE_HORIZON);

/** The demonstration provenance for the whole decision record (§9 watermark rules). */
export function recordProvenance(inputs: readonly RecordProvenance[], asOf: string): DerivedProvenance {
  return deriveArtifactProvenance(inputs, asOf);
}
