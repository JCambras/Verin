/**
 * Fake-service builder for the printable examiner-grade decision record. The old
 * comparison and query-string policy activation builders were deleted when the
 * bounded setup-first replacement became the demo's primary journey.
 */
import type { RecordProvenance } from "@contracts/provenance";
import { DEMO_WATERMARK, isDemonstration } from "@contracts/provenance";
import type { ApprovalStageVM, DispositionVM, RecordVM } from "./model";
import { FIXTURE_RESERVE_HORIZON, prov, recordProvenance } from "./provenance";
import { buildEvidence, buildIntent } from "./build-context";
import {
  buildDisposition,
  buildPolicyTrace,
  buildStages,
  headroomMetric,
  reserveFloorMetric,
  reserveHorizonPhrase,
} from "./build-decision";
import { buildExecution, buildSafety, buildVerification } from "./build-outcome";
import {
  DEMO_NOW,
  IDS,
  OBSERVED_RECENT,
  decisionIdentityFor,
  type DecisionIdentity,
  type FirmData,
  type ScenarioData,
} from "./data";

export interface RecordBuildOptions {
  readonly identity?: DecisionIdentity;
  readonly disposition?: DispositionVM;
  readonly approvalStages?: readonly ApprovalStageVM[] | null;
  readonly activatedConfiguration?: RecordVM["activatedConfiguration"];
  /** Where the reserve horizon came from - a FIRMS fixture on the journey, the
   * administrator's activated choice after setup. It changes the ADR-0022 leaf
   * classes behind the printed floor and headroom, never the arithmetic. */
  readonly reserveHorizon?: RecordProvenance;
}

export function buildRecord(
  scenario: ScenarioData,
  firm: FirmData,
  reached: { authority: boolean; safety: boolean; execution: boolean },
  stopNote: string | null,
  options: RecordBuildOptions = {},
): RecordVM {
  const provenance = recordProvenance(
    [prov("synthetic-fixture", OBSERVED_RECENT), prov("user-entered-demo-input", DEMO_NOW)],
    DEMO_NOW,
  );
  const reserveHorizon = options.reserveHorizon ?? FIXTURE_RESERVE_HORIZON;
  const disposition =
    options.disposition ?? buildDisposition(scenario, firm, undefined, reserveHorizon);
  const identity =
    options.identity ??
    decisionIdentityFor(scenario, firm, {
      disposition: disposition.kind,
      explanation: disposition.why.reason,
    });
  return {
    identity: {
      scenario: { id: scenario.id, label: scenario.title },
      firm: { id: firm.id, label: firm.name },
      decisionId: identity.decisionId,
      inputHash: identity.inputHash,
      decisionHash: identity.decisionHash,
      bundleHash: identity.bundleHash,
    },
    header: {
      createdAt: "Jul 26, 2026, 14:05",
      watermark: isDemonstration(provenance) ? DEMO_WATERMARK : null,
    },
    hashes: {
      policyVersion: firm.policyVersion,
      instructionVersion: "HH-INSTR-SMITH v3",
      auditPosition: IDS.auditPosition,
    },
    activatedConfiguration: options.activatedConfiguration ?? null,
    intent: buildIntent(scenario),
    evidence: buildEvidence(scenario).rows,
    disposition,
    precedence: buildPolicyTrace(scenario, firm, disposition.kind).rows,
    // The two numbers an examiner looks for beside "preserves N months". Both come off
    // the SAME projection the setup and decision surfaces read - no second constant,
    // and never recomputed in a surface.
    reserve: {
      horizon: reserveHorizonPhrase(firm),
      floor: reserveFloorMetric(firm, reserveHorizon),
      headroom: headroomMetric(firm, reserveHorizon),
    },
    approvalStages:
      options.approvalStages !== undefined
        ? options.approvalStages
        : reached.authority
          ? buildStages(scenario, firm, "final")
          : null,
    safety: reached.safety ? buildSafety(scenario) : null,
    execution: reached.execution ? buildExecution(scenario).rows : null,
    verification: reached.execution ? buildVerification(scenario) : null,
    stopNote,
    provenanceAppendix: provenance.derivedFrom,
  };
}
