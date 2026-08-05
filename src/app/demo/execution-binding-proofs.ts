import { signedApprovalPlanSatisfied } from "./build-approval-stages";
import { decisionBindingFor } from "./decision-bindings";
import type { FirmData, JourneyPass, ScenarioData } from "./data";
import {
  eventInstant,
  eventLabel,
  fieldGap,
  proof,
  sameStrings,
  type DecisionProof,
  type ProofResult,
} from "./execution-proof-shared";
import type {
  SignedCaseVariant,
  SignedEvidenceData,
} from "./signed-case-types";

const HASH = /^[a-f0-9]{64}$/;

export function activeDecisionProof(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): DecisionProof {
  const binding = decisionBindingFor(scenario, firm, pass);
  const candidates = sourceCase.ledgerEvents.filter(
    (event) =>
      event.type === "DecisionRecorded" &&
      (event.lifecyclePass === pass || event.lifecyclePass === null),
  );
  const gaps: string[] = [];
  const exact = candidates.filter((event) => {
    const eventGaps = [
      ...fieldGap(sourceCase, event, `lifecyclePass=${pass}`, event.lifecyclePass === pass),
      ...fieldGap(sourceCase, event, "recordedAt", eventInstant(event) !== null),
      ...fieldGap(
        sourceCase,
        event,
        "decisionHash",
        HASH.test(event.decisionHash ?? "") && event.decisionHash === binding.decisionHash,
      ),
      ...fieldGap(
        sourceCase,
        event,
        "inputBundleHash",
        HASH.test(event.inputBundleHash ?? "") && event.inputBundleHash === binding.bundleHash,
      ),
    ];
    gaps.push(...eventGaps);
    return eventGaps.length === 0;
  });
  if (candidates.length === 0) {
    gaps.push(`No DecisionRecorded event carries structured lifecyclePass=${pass}`);
  }
  if (exact.length > 1) {
    gaps.push(`Multiple DecisionRecorded events carry the active ${pass} binding`);
  }
  const unique = [...new Set(gaps)];
  const unambiguous = exact.length === 1 && unique.length === 0;
  return {
    ok: unambiguous,
    gaps: unambiguous ? [] : unique,
    event: unambiguous ? exact[0]! : null,
  };
}

export function approvalProofResult(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): ProofResult {
  if (sourceCase.authority.stages.length === 0) {
    return sourceCase.authority.mode === "automatic"
      ? proof(activeDecisionProof(scenario, firm, sourceCase, pass).gaps)
      : proof(["Signed authority has no stages and is not structured as automatic"]);
  }
  const decision = activeDecisionProof(scenario, firm, sourceCase, pass);
  const binding = decisionBindingFor(scenario, firm, pass);
  const decisionAt = decision.event ? eventInstant(decision.event) : null;
  const gaps = [...decision.gaps];
  const approvals = sourceCase.ledgerEvents.filter(
    (event) =>
      event.type === "ApprovalRecorded" &&
      (event.lifecyclePass === pass || event.lifecyclePass === null),
  );
  for (const stage of sourceCase.authority.stages) {
    const stageEvents = approvals.filter(
      (event) => event.stageId === stage.stageId || event.stageId === null,
    );
    if (stageEvents.length !== stage.approvalsRequired) {
      gaps.push(
        `ApprovalRecorded events for ${pass}/${stage.stageId} total ${stageEvents.length}, expected ${stage.approvalsRequired}`,
      );
    }
    for (const event of stageEvents) {
      const recordedAt = eventInstant(event);
      gaps.push(
        ...fieldGap(sourceCase, event, `stageId=${stage.stageId}`, event.stageId === stage.stageId),
        ...fieldGap(sourceCase, event, `lifecyclePass=${pass}`, event.lifecyclePass === pass),
        ...fieldGap(sourceCase, event, "actorId", Boolean(event.actorId)),
        ...fieldGap(
          sourceCase,
          event,
          "eligible roleId",
          Boolean(event.roleId && stage.eligibleRoleIds.includes(event.roleId)),
        ),
        ...fieldGap(sourceCase, event, "requesterId", Boolean(event.requesterId)),
        ...fieldGap(
          sourceCase,
          event,
          "requester exclusion",
          Boolean(
            event.actorId &&
            event.requesterId &&
            (stage.requesterMayApprove || event.actorId !== event.requesterId),
          ),
        ),
        ...fieldGap(sourceCase, event, "recordedAt", recordedAt !== null),
        ...fieldGap(sourceCase, event, "decisionHash", event.decisionHash === binding.decisionHash),
        ...fieldGap(sourceCase, event, "inputBundleHash", event.inputBundleHash === binding.bundleHash),
      );
      if (recordedAt !== null && decisionAt !== null && recordedAt <= decisionAt) {
        gaps.push(`${eventLabel(sourceCase, event)} recordedAt does not follow its bound decision`);
      }
    }
  }
  if (!signedApprovalPlanSatisfied(sourceCase, pass)) {
    gaps.push(`Structured approval plan for lifecyclePass=${pass} is not satisfied`);
  }
  return proof(gaps);
}

export function preExecutionEvidence(
  sourceCase: SignedCaseVariant,
  requiredEvidence: readonly string[],
): SignedEvidenceData[] {
  return sourceCase.evidence.filter(
    (entry) =>
      requiredEvidence.includes(entry.subjectRef) &&
      entry.liquidityPhase === "pre-execution-revalidation" &&
      entry.freshness === "fresh",
  );
}

export function evidenceProofResult(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
  requiredEvidence: readonly string[],
): ProofResult {
  if (requiredEvidence.length === 0) {
    return proof(["Must-hold evidence precondition has no required evidence references"]);
  }
  const decision = activeDecisionProof(scenario, firm, sourceCase, pass);
  const binding = decisionBindingFor(scenario, firm, pass);
  const selected = preExecutionEvidence(sourceCase, requiredEvidence);
  const gaps = [...decision.gaps];
  for (const requiredRef of requiredEvidence) {
    const matches = selected.filter((entry) => entry.subjectRef === requiredRef);
    if (matches.length === 0) {
      gaps.push(`${requiredRef} has no fresh pre-execution evidence row with a structured snapshotId`);
    }
    for (const entry of matches) {
      if (!entry.snapshotId) {
        gaps.push(`${requiredRef} pre-execution evidence row lacks structured snapshotId`);
      }
    }
  }
  const snapshotIds = selected.flatMap((entry) => entry.snapshotId ? [entry.snapshotId] : []);
  if (new Set(snapshotIds).size !== snapshotIds.length) {
    gaps.push("Pre-execution evidence rows reuse a structured snapshotId");
  }
  const candidates = sourceCase.ledgerEvents.filter(
    (event) =>
      event.type === "EvidenceSnapshotRecorded" &&
      (event.lifecyclePass === pass || event.lifecyclePass === null) &&
      (event.evidencePhase === "pre-execution-revalidation" || event.evidencePhase === undefined),
  );
  const exact = candidates.filter((event) => {
    const recordedAt = eventInstant(event);
    const eventGaps = [
      ...fieldGap(sourceCase, event, `lifecyclePass=${pass}`, event.lifecyclePass === pass),
      ...fieldGap(sourceCase, event, "evidencePhase=pre-execution-revalidation", event.evidencePhase === "pre-execution-revalidation"),
      ...fieldGap(sourceCase, event, "recordedAt", recordedAt !== null),
      ...fieldGap(sourceCase, event, "evidenceSnapshotIds", snapshotIds.length > 0 && sameStrings(event.evidenceSnapshotIds, snapshotIds)),
      ...fieldGap(sourceCase, event, "decisionHash", event.decisionHash === binding.decisionHash),
      ...fieldGap(sourceCase, event, "inputBundleHash", event.inputBundleHash === binding.bundleHash),
    ];
    if (recordedAt !== null && !selected.every((entry) => recordedAt >= Date.parse(entry.retrievedAt))) {
      eventGaps.push(`${eventLabel(sourceCase, event)} recordedAt precedes bound evidence retrieval`);
    }
    gaps.push(...eventGaps);
    return eventGaps.length === 0;
  });
  if (candidates.length === 0) {
    gaps.push(`No EvidenceSnapshotRecorded event carries structured ${pass} pre-execution evidence bindings`);
  }
  if (exact.length > 1) {
    gaps.push(`Multiple EvidenceSnapshotRecorded events carry the ${pass} pre-execution binding`);
  }
  if (exact.length === 0 && candidates.length > 0) {
    gaps.push(`No EvidenceSnapshotRecorded event exactly binds the ${pass} pre-execution evidence`);
  }
  return proof(gaps);
}
