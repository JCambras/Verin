/**
 * Fake-service builder for the printable examiner-grade decision record. The old
 * comparison and query-string policy activation builders were deleted when the
 * bounded setup-first replacement became the demo's primary journey.
 */
import { DEMO_WATERMARK, isDemonstration } from "@contracts/provenance";
import type { RecordVM } from "./model";
import { prov, recordProvenance } from "./provenance";
import { buildEvidence, buildIntent } from "./build-context";
import {
  buildDisposition,
  buildPolicyTrace,
  buildStages,
} from "./build-decision";
import { buildExecution, buildSafety, buildVerification } from "./build-outcome";
import { DEMO_NOW, IDS, OBSERVED_RECENT, type FirmData, type ScenarioData } from "./data";

export function buildRecord(scenario: ScenarioData, firm: FirmData, reached: { authority: boolean; safety: boolean; execution: boolean }, stopNote: string | null): RecordVM {
  const provenance = recordProvenance(
    [prov("synthetic-fixture", OBSERVED_RECENT), prov("user-entered-demo-input", DEMO_NOW)],
    DEMO_NOW,
  );
  return {
    header: {
      decisionId: "dec-smiths-renovation-2026-0726",
      createdAt: "Jul 26, 2026, 14:05",
      provenance,
      watermark: isDemonstration(provenance) ? DEMO_WATERMARK : null,
    },
    hashes: {
      decisionHash: IDS.decisionHash,
      bundleHash: IDS.bundleHash,
      policyVersion: firm.policyVersion,
      instructionVersion: "HH-INSTR-SMITH v3",
      auditPosition: IDS.auditPosition,
    },
    intent: buildIntent(scenario),
    evidence: buildEvidence(scenario).rows,
    disposition: buildDisposition(scenario, firm),
    precedence: buildPolicyTrace(scenario, firm).rows,
    approvalStages: reached.authority ? buildStages(scenario, firm, "final") : null,
    safety: reached.safety ? buildSafety(scenario) : null,
    execution: reached.execution ? buildExecution(scenario).rows : null,
    verification: reached.execution ? buildVerification(scenario) : null,
    stopNote,
    provenanceAppendix: provenance.derivedFrom,
  };
}
