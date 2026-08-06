import type { RecordVM } from "./model";
import { buildRecord } from "./build-summary";
import { scenarioById } from "./data";
import { ACTIVATED_RESERVE_HORIZON } from "./provenance";
import type {
  SetupActivatedSnapshotVM,
  SetupFirmId,
  SetupProofFirmVM,
} from "./setup-model";
import { evaluateSetupPolicy, setupRuntimeFirm } from "./setup-policy";

export type SetupActivatedRecords = Readonly<
  Record<SetupFirmId, RecordVM>
>;

function materializeActivatedRecord(
  snapshot: SetupActivatedSnapshotVM,
  evaluated: SetupProofFirmVM,
): RecordVM {
  const firmId = evaluated.firmId;
  const policyEvaluation = evaluateSetupPolicy(
    snapshot.selections,
    firmId,
    snapshot.evidence,
  );
  const firm = setupRuntimeFirm(
    firmId,
    policyEvaluation,
    evaluated.policyVersion,
  );
  const reached = {
    authority: evaluated.authorityPlan.mode !== "not-reached",
    safety: evaluated.authorityPlan.mode !== "not-reached",
    execution: evaluated.authorityPlan.mode !== "not-reached",
  };
  const stopNote = evaluated.authorityPlan.mode !== "not-reached"
    ? null
    : "This journey stopped at Decision: the named conditions must be resolved before authority can be requested.";
  return buildRecord(
    scenarioById(evaluated.scenarioId),
    firm,
    reached,
    stopNote,
    {
      identity: {
        decisionId: evaluated.decisionId,
        inputHash: evaluated.inputHash,
        decisionHash: evaluated.decisionHash,
        bundleHash: evaluated.bundleHash,
      },
      disposition: evaluated.disposition,
      authority: evaluated.authorityPlan,
      activatedConfiguration: {
        snapshotVersion: snapshot.snapshotVersion,
        snapshotHash: snapshot.snapshotHash,
        configurationHash: evaluated.configurationHash,
        configurationPostureStatus:
          evaluated.configurationPostureStatus,
        configurationPostureLabel:
          evaluated.configurationPostureLabel,
        configurationProvenance: evaluated.configurationProvenance,
        standardApprovalRole: evaluated.standardApprovalRole,
        requesterParticipation:
          evaluated.requesterParticipation.mode,
        activationActorId:
          snapshot.activationAcknowledgment.actor.opaqueId,
        activationActorRole:
          snapshot.activationAcknowledgment.actor.role,
        attestationStatementVersion:
          snapshot.activationAcknowledgment.statementVersion,
        attestedDraftGeneration:
          snapshot.activationAcknowledgment.draftGeneration,
        attestedSelectionsHash:
          snapshot.activationAcknowledgment.selectionsHash,
        attestedSetupVersionDigest:
          snapshot.activationAcknowledgment.setupVersionDigest,
        attestationStatement:
          snapshot.activationAcknowledgment.statement,
      },
      reserveHorizon: ACTIVATED_RESERVE_HORIZON,
      reserveProjection: policyEvaluation.projection,
      evidence: snapshot.evidence,
    },
  );
}

export function materializeActivatedRecords(
  snapshot: SetupActivatedSnapshotVM,
): SetupActivatedRecords {
  const firmA = snapshot.firms.find((firm) => firm.firmId === "firm-a");
  const firmB = snapshot.firms.find((firm) => firm.firmId === "firm-b");
  if (!firmA || !firmB) {
    throw new Error("Activated setup snapshot is missing a firm projection");
  }
  return {
    "firm-a": materializeActivatedRecord(snapshot, firmA),
    "firm-b": materializeActivatedRecord(snapshot, firmB),
  };
}
