/**
 * Fake-service builder for the printable examiner-grade decision record. The old
 * comparison and query-string policy activation builders were deleted when the
 * bounded setup-first replacement became the demo's primary journey.
 */
import type { RecordProvenance } from "@contracts/provenance";
import { DEMO_WATERMARK, isDemonstration } from "@contracts/provenance";
import type {
  AuthorityPlanVM,
  DispositionVM,
  RecordReserveVM,
  RecordVM,
} from "./model";
import { FIXTURE_RESERVE_HORIZON, prov, recordProvenance } from "./provenance";
import { buildEvidence, buildIntent } from "./build-context";
import {
  buildAuthorityPlan,
  buildDisposition,
  buildPolicyTrace,
  headroomMetric,
  reserveFloorMetric,
  reserveHorizonPhrase,
} from "./build-decision";
import { buildDecisionAuthorityPlan } from "./decision-authority";
import { buildExecution, buildSafety, buildVerification } from "./build-outcome";
import {
  DEMO_NOW,
  DEMO_RECORD_CREATED_AT,
  IDS,
  decisionConfigurationFor,
  type DecisionIdentity,
  type FirmData,
  type ScenarioData,
} from "./data";
import {
  decisionEvidenceSnapshotFor,
  type DecisionEvidenceSnapshot,
} from "./decision-evidence";
import {
  approvalReceiptHashFor,
  decisionAuthorityClaimFor,
  decisionIdentityFor,
} from "./decision-identity";

export interface RecordBuildOptions {
  readonly identity?: DecisionIdentity;
  readonly disposition?: DispositionVM;
  readonly authority?: AuthorityPlanVM;
  readonly activatedConfiguration?: RecordVM["activatedConfiguration"];
  /** Where the reserve horizon came from - a FIRMS fixture on the journey, the
   * administrator's activated choice after setup. It changes the ADR-0022 leaf
   * classes behind the printed floor and headroom, never the arithmetic. */
  readonly reserveHorizon?: RecordProvenance;
  readonly evidence?: DecisionEvidenceSnapshot;
}

function buildRecordReserve(
  scenario: ScenarioData,
  firm: FirmData,
  disposition: DispositionVM,
  reserveHorizon: RecordProvenance,
): RecordReserveVM {
  if (disposition.kind === "prohibited") {
    return {
      kind: "not-applicable",
      reason:
        "The household destination prohibition stopped precedence before reserve evaluation.",
    };
  }
  if (scenario.spec.stalePlannedWithdrawals) {
    return {
      kind: "not-evaluated",
      reason:
        "Planned-withdrawal evidence is outside the active freshness window, so no reserve floor or headroom was calculated.",
    };
  }
  return {
    kind: "evaluated",
    horizon: reserveHorizonPhrase(firm),
    floor: reserveFloorMetric(firm, reserveHorizon),
    headroom: headroomMetric(firm, reserveHorizon),
  };
}

export function buildRecord(
  scenario: ScenarioData,
  firm: FirmData,
  reached: { authority: boolean; safety: boolean; execution: boolean },
  stopNote: string | null,
  options: RecordBuildOptions = {},
): RecordVM {
  const evidence =
    options.evidence ?? decisionEvidenceSnapshotFor(scenario);
  const provenance = recordProvenance(
    [
      evidence.availableCash.provenance,
      evidence.pendingApprovedActivity.provenance,
      evidence.plannedMonthlyWithdrawal.provenance,
      prov("user-entered-demo-input", DEMO_NOW),
    ],
    DEMO_NOW,
  );
  const reserveHorizon = options.reserveHorizon ?? FIXTURE_RESERVE_HORIZON;
  const disposition =
    options.disposition ?? buildDisposition(scenario, firm, undefined, reserveHorizon);
  const precedence = buildPolicyTrace(
    scenario,
    firm,
    disposition.kind,
  ).rows;
  const authority =
    options.authority ??
    (reached.authority
      ? buildAuthorityPlan(scenario, firm, "final")
      : buildDecisionAuthorityPlan(scenario, firm));
  const recordAuthority =
    authority.mode === "not-reached" ? null : authority;
  const identity =
    options.identity ??
    decisionIdentityFor(
      scenario,
      firm,
      decisionConfigurationFor(firm),
      {
        disposition,
        precedence,
        authority: decisionAuthorityClaimFor(
          buildDecisionAuthorityPlan(scenario, firm),
        ),
      },
      evidence,
    );
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
      createdAt: DEMO_RECORD_CREATED_AT,
      watermark: isDemonstration(provenance) ? DEMO_WATERMARK : null,
    },
    hashes: {
      policyVersion: firm.policyVersion,
      instructionVersion: "HH-INSTR-SMITH v3",
      auditPosition: IDS.auditPosition,
      approvalReceiptHash: approvalReceiptHashFor(
        identity.decisionHash,
        authority,
      ),
    },
    activatedConfiguration: options.activatedConfiguration ?? null,
    intent: buildIntent(scenario),
    evidence: buildEvidence(scenario, evidence).rows,
    disposition,
    precedence,
    reserve: buildRecordReserve(
      scenario,
      firm,
      disposition,
      reserveHorizon,
    ),
    authority: recordAuthority,
    safety: reached.safety ? buildSafety(scenario) : null,
    execution: reached.execution ? buildExecution(scenario).rows : null,
    verification: reached.execution ? buildVerification(scenario) : null,
    stopNote,
    provenanceAppendix: provenance.derivedFrom,
  };
}
