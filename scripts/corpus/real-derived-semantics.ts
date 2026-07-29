import { pendingActionLiquidityTreatment } from "./pending-actions";
import {
  realDerivedTopologyProblems as topologyProblems,
  selectedSources,
} from "./real-derived-topology";
import { loadRealDerivedSemanticContract } from "./semantic-contract";
import type { RealDerivedCase } from "./real-derived-types";

const contract = loadRealDerivedSemanticContract();
const evidenceKindByPlane = new Map(
  contract.evidencePlanes.map((entry) => [
    entry.plane,
    entry.evidenceKind,
  ]),
);
export function realDerivedTopologyProblems(
  item: RealDerivedCase,
): string[] {
  return topologyProblems(item, evidenceKindByPlane);
}

const intervalCollapse = (item: RealDerivedCase): boolean => {
  const authority = item.replayPayload.authority;
  return authority.validTo !== null && item.evidence.some((evidence) =>
    evidence.evidenceKind === "authority" &&
    evidence.subjectRef === authority.grantRef &&
    evidence.sourceRef === authority.evidenceSourceRef &&
    evidence.observedAt !== null &&
    evidence.observedAt < authority.validTo! &&
    authority.validTo! <= evidence.retrievedAt
  );
};

const pendingMiscount = (item: RealDerivedCase): boolean => {
  const action = item.replayPayload.liquidity.pendingAction;
  return action.actionRef !== null &&
    (["blocked", "cancelled", "rejected"].includes(action.actionState ?? "") ||
      ["unknown", "unclassified"].includes(action.actionKind ?? ""));
};

const deadlineInfeasible = (item: RealDerivedCase): boolean => {
  const request = item.replayPayload.request;
  return request.deadlineAt !== null &&
    (request.deadlineAt < item.evaluation.asOf ||
      (request.settlementEarliestAt !== null &&
        request.deadlineAt < request.settlementEarliestAt));
};

const retirementFundingSelected = (item: RealDerivedCase): boolean =>
  selectedSources(item).some(
    (source) => source.sourceTaxClass === "retirement",
  );

const CONTEXT_RULES: Readonly<Record<string, (item: RealDerivedCase) => boolean>> = {
  "identity-ambiguous": (item) =>
    item.replayPayload.identity.resolution === "ambiguous",
  "authority-not-effective": (item) =>
    item.replayPayload.authority.authorityState !== "effective",
  "destination-not-integral": (item) =>
    item.replayPayload.destination.ownership === "cross-household" ||
    item.replayPayload.destination.verificationState !== "verified" ||
    item.replayPayload.destination.discriminatorState !== "unique",
  "instruction-conflict-present": (item) =>
    item.replayPayload.instructionConflict.conflictState === "present",
  "reserve-not-scalar": (item) =>
    item.replayPayload.liquidity.reserveState !== "modeled-scalar",
  "stale-evidence-present": (item) =>
    item.evidence.some((evidence) => evidence.freshness === "stale"),
  "authority-lapses-during-evidence-interval": intervalCollapse,
  "restriction-not-in-force": (item) =>
    ["expired", "future"].includes(
      item.replayPayload.policy.restrictionState,
    ),
  "position-hold-present": (item) =>
    item.replayPayload.policy.legalHoldScope === "position",
  "nonreducing-pending-action-present": pendingMiscount,
  "time-zone-boundary": (item) =>
    item.replayPayload.temporal.transitionState === "boundary",
  "canonical-identity-collision": (item) =>
    item.replayPayload.identity.resolution === "canonical-collision",
  "threshold-equality": (item) =>
    item.replayPayload.policy.thresholdComparison === "equal",
  "deadline-infeasible": deadlineInfeasible,
  "resolved-conflict-multi-subject": (item) =>
    item.replayPayload.instructionConflict.conflictState === "resolved" &&
    item.replayPayload.instructionConflict.impactedSubjectRefs.length > 1,
  "selected-retirement-source": retirementFundingSelected,
};

function outcomeProblems(item: RealDerivedCase): string[] {
  const outcomes = new Map(
    item.replayPayload.outcomes.map((outcome) => [
      outcome.defectClassId,
      outcome,
    ]),
  );
  const configured = new Set(contract.defectRules.map((entry) => entry.id));
  const problems = outcomes.size === item.replayPayload.outcomes.length
    ? []
    : ["outcomes require exactly one expected-versus-observed treatment per defect class"];
  for (const entry of contract.defectRules) {
    const outcome = outcomes.get(entry.id);
    if (outcome === undefined) {
      problems.push(`outcomes missing defect class "${entry.id}"`);
      continue;
    }
    if (
      outcome.expectedTreatment !== entry.expectedTreatment ||
      ![entry.expectedTreatment, entry.defectTreatment].includes(
        outcome.observedTreatment,
      )
    ) {
      problems.push(
        `outcome "${entry.id}" is outside its closed treatment vocabulary`,
      );
    }
    if (
      outcome.observedTreatment === entry.defectTreatment &&
      CONTEXT_RULES[entry.contextRule]?.(item) !== true
    ) {
      problems.push(
        `outcome "${entry.id}" claims a defect treatment without its required context`,
      );
    }
  }
  for (const id of outcomes.keys()) {
    if (!configured.has(id)) {
      problems.push(`outcomes reference unknown defect class "${id}"`);
    }
  }
  return problems;
}

export function realDerivedSemanticDefects(
  item: RealDerivedCase,
): string[] {
  return contract.defectRules.flatMap((entry) => {
    const rule = CONTEXT_RULES[entry.contextRule];
    if (rule === undefined) {
      throw new Error(
        `semantic context rule "${entry.contextRule}" has no executable authority`,
      );
    }
    const outcome = item.replayPayload.outcomes.find(
      (candidate) => candidate.defectClassId === entry.id,
    );
    return rule(item) &&
        outcome?.expectedTreatment === entry.expectedTreatment &&
        outcome.observedTreatment !== outcome.expectedTreatment &&
        outcome.observedTreatment === entry.defectTreatment
      ? [entry.id]
      : [];
  });
}

export function realDerivedOutcomeProblems(
  item: RealDerivedCase,
): string[] {
  return outcomeProblems(item);
}

export function realDerivedSemanticContractProblems(
  defectClassIds: ReadonlySet<string>,
): string[] {
  const configuredIds = new Set(contract.defectRules.map((entry) => entry.id));
  const configuredRules = new Set(
    contract.defectRules.map((entry) => entry.contextRule),
  );
  const planes = new Set(
    contract.evidencePlanes.map((entry) => entry.plane),
  );
  return [
    ...(configuredIds.size === contract.defectRules.length
      ? []
      : ["real-derived semantic contract has duplicate defect ids"]),
    ...(configuredRules.size === contract.defectRules.length
      ? []
      : ["real-derived semantic contract has duplicate executable rules"]),
    ...(planes.size === contract.evidencePlanes.length
      ? []
      : ["real-derived semantic contract has duplicate evidence planes"]),
    ...[...defectClassIds]
      .filter((id) => !configuredIds.has(id))
      .map(
        (id) =>
          `real-derived replay semantics missing defect class "${id}"`,
      ),
    ...[...configuredIds]
      .filter((id) => !defectClassIds.has(id))
      .map(
        (id) =>
          `real-derived replay semantics reference unknown defect class "${id}"`,
      ),
    ...[...configuredRules]
      .filter((rule) => CONTEXT_RULES[rule] === undefined)
      .map(
        (rule) =>
          `real-derived semantic context rule "${rule}" has no executable authority`,
      ),
    ...contract.defectRules
      .filter(
        (entry) => entry.expectedTreatment === entry.defectTreatment,
      )
      .map(
        (entry) =>
          `real-derived semantic rule "${entry.id}" has no treatment mismatch`,
      ),
  ];
}

export function pendingActionProblems(item: RealDerivedCase): string[] {
  const action = item.replayPayload.liquidity.pendingAction;
  const values = [
    action.actionRef,
    action.actionKind,
    action.actionState,
    action.direction,
    action.liquidityClass,
    action.amountMinor,
    action.evidenceSourceRef,
  ];
  const absent = values.every((value) => value === null);
  if (absent) {
    return action.reducesEffectiveLiquidity ||
      action.increasesAvailableLiquidity
      ? ["liquidity.pendingAction absent treatment is inconsistent"]
      : [];
  }
  if (values.some((value) => value === null)) {
    return ["liquidity.pendingAction is only partially populated"];
  }
  const expected = pendingActionLiquidityTreatment(
    action.actionKind!,
    action.actionState!,
  );
  return action.direction !== expected.direction ||
    action.liquidityClass !== expected.liquidityClass ||
    action.reducesEffectiveLiquidity !== expected.reducesEffectiveLiquidity ||
    action.increasesAvailableLiquidity !== expected.increasesAvailableLiquidity
    ? ["liquidity.pendingAction treatment is inconsistent"]
    : [];
}
