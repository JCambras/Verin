import { epochMs } from "./clock";
import { pendingActionLiquidityTreatment } from "./pending-actions";
import {
  loadRealDerivedSemanticContract,
  semanticTreatment,
  type SemanticDefectRule,
} from "./semantic-contract";
import { selectedFundingHasTaxClass } from "./selected-funding";
import { selectedCitedPendingActions, syntheticPendingContext } from "./synthetic-pending";
import {
  syntheticIdentityContext,
  type SyntheticIdentityInput,
} from "./synthetic-identity";
import { syntheticInstructionConflictAnalysis } from "./synthetic-instruction-topology";
import {
  syntheticSharedInstructionBlastRadius,
  syntheticTimeZoneBoundary,
} from "./synthetic-structural-context";

export interface EmittedEvidence {
  id: string;
  kind: string;
  subjectRef: string;
  recordChangedAt: string;
  recordChangedAtLocal: string;
  observedAt: string;
  retrievedAt: string;
  observedAtLocal: string;
  retrievedAtLocal: string;
  retrievalLagSeconds: number;
  freshness: string;
  withinRecentChangeWindow: boolean;
  localZone?: {
    timeZone: string;
    timeZoneDataVersion: string;
  };
}

export interface EmittedRecords {
  household: { id: string; advisorRef: string; memberRefs: string[] };
  referencedHouseholds: Array<{
    id: string;
    relationshipReasons: string[];
  }>;
  parties: Array<{ id: string }>;
  referencedOwners: Array<{ id: string }>;
  accounts: Array<{
    id: string;
    householdRef: string;
    ownerRefs: string[];
    taxClass: "taxable" | "retirement" | "trust" | "entity";
  }>;
  referencedAccounts: Array<{ id: string; householdRef: string }>;
  beneficiaries: Array<{ accountRef: string; partyRef: string }>;
  authorizedSigners: Array<{
    id: string;
    accountRef: string;
    partyRef: string;
    authorityScope: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
  bankInstructions: Array<{
    id: string;
    householdRef: string;
    titledTo: string;
    accountRefs: string[];
    bank: string;
    lastFour: string;
    verifiedAt: string | null;
    changedAt: string | null;
  }>;
  referencedBankInstructions: Array<{
    id: string;
    householdRef: string;
    titledTo: string;
    accountRefs: string[];
  }>;
  plannedWithdrawals: Array<{
    id: string;
    householdRef: string;
    segments: Array<{ monthlyMinor: number }>;
  }>;
  restrictions: Array<{
    id: string;
    firmRef: string;
    householdRef: string;
    subjectRef: string;
    inForceAtAsOf: boolean;
    term: {
      governedAction: "distribution";
      sourceAccountRef: string;
      targetKind:
        | "source-account"
        | "destination-instruction"
        | "destination-subject";
      targetRef: string;
      polarity: "required" | "forbidden";
    } | null;
  }>;
  modelAssignments: Array<{
    id: string;
    accountRef: string;
    pendingRebalance: boolean;
  }>;
  pendingActions: Array<{
    id: string;
    householdRef: string;
    accountRef: string;
    kind: Parameters<typeof pendingActionLiquidityTreatment>[0];
    state: Parameters<typeof pendingActionLiquidityTreatment>[1];
    direction: "outgoing" | "incoming" | "unknown";
    liquidityClass: "distribution" | "debit" | "credit" | "unclassified";
    reducesEffectiveLiquidity: boolean;
    increasesAvailableLiquidity: boolean;
  }>;
  legalHolds: Array<{
    id: string;
    subjectRef: string;
    scope: "account" | "position";
  }>;
  recentChanges: Array<{
    id: string;
    subjectRef: string;
    changedAt: string;
  }>;
}

export interface EmittedCase {
  caseId: string;
  provenance: string;
  partition: string;
  label: { kind: string; defectClassId?: string };
  assumptions: Array<{ id: string }>;
  trigger: {
    asOf: string;
    timeZone: string;
    timeZoneDataVersion: string;
    asOfLocal: string;
    timeZoneTransitions?: Array<{
      at: string;
      offsetMinutes: number;
    }>;
  };
  request: {
    firmRef: string;
    requestRef: string;
    householdRef: string;
    action: "distribution";
    sourceAccountRef: string;
    selectedFundingRefs: string[];
    destinationRef: string;
    amountMinor: number;
    settlementEarliest: string;
    deadline: string;
    deadlineFeasible: boolean;
    idempotencyKey: string;
  };
  identityInput?: SyntheticIdentityInput;
  thresholdPolicy: {
    thresholdMinor: number;
    comparator: "strict" | "inclusive";
  } | null;
  taxReviewState:
    | "not-required"
    | "required-pending"
    | "completed"
    | "unavailable";
  outcomes: Array<{
    defectClassId: string;
    expectedTreatment: string;
    observedTreatment: string;
  }>;
  reservations: Array<{
    family: string;
    conflictKey: string;
    firmId: string;
    reservationId: string;
  }>;
  records: EmittedRecords;
  evidence: EmittedEvidence[];
}

const contract = loadRealDerivedSemanticContract();
const evidenceSubjects = (
  item: EmittedCase,
  kind: string,
): Set<string> =>
  new Set(
    item.evidence
      .filter((evidence) => evidence.kind === kind)
      .map((evidence) => evidence.subjectRef),
  );
const assumption = (item: EmittedCase, id: string): boolean =>
  item.assumptions.some((entry) => entry.id === id);
type ReserveState = "modeled-scalar" | "modeled-segmented" | "missing" | "inactive";
const reserveState = (item: EmittedCase): ReserveState => {
  if (item.records.plannedWithdrawals.length === 0) return "missing";
  const cited = evidenceSubjects(item, "planned-withdrawals");
  const schedules = item.records.plannedWithdrawals.filter((row) => cited.has(row.id));
  if (schedules.length === 0) return "inactive";
  return schedules.some((row) => row.segments.length > 1)
    ? "modeled-segmented"
    : "modeled-scalar";
};
const authorityEffective = (item: EmittedCase): boolean => {
  const cited = evidenceSubjects(item, "authority");
  const signer = item.records.authorizedSigners.find((row) =>
    cited.has(row.id)
  );
  return signer !== undefined &&
    signer.accountRef === item.request.sourceAccountRef &&
    ["full", "distribution-request"].includes(signer.authorityScope) &&
    epochMs(signer.effectiveFrom) <= epochMs(item.trigger.asOf) &&
    (signer.effectiveTo === null ||
      epochMs(signer.effectiveTo) > epochMs(item.trigger.asOf));
};
const pendingContext = (item: EmittedCase): boolean =>
  syntheticPendingContext(
    item,
    evidenceSubjects(item, "pending-actions"),
    evidenceSubjects(item, "model-assignment"),
  );

const selectedFundingProblems = (item: EmittedCase): string[] => {
  const selected = item.request.selectedFundingRefs;
  const selectedSet = new Set(selected);
  const problems = [
    ...(selected.length === 0
      ? [`${item.caseId}: selected funding must not be empty`]
      : []),
    ...(selectedSet.size !== selected.length
      ? [`${item.caseId}: selected funding must be duplicate-free`]
      : []),
  ];
  for (const ref of selectedSet) {
    const matches = item.records.accounts.filter(
      (account) =>
        account.id === ref &&
        account.householdRef === item.request.householdRef,
    );
    if (matches.length !== 1) {
      problems.push(
        `${item.caseId}: selected funding "${ref}" must resolve once to the request household`,
      );
    }
  }
  const citedPending = evidenceSubjects(item, "pending-actions");
  for (const row of item.records.pendingActions) {
    if (
      citedPending.has(row.id) &&
      (
        row.householdRef !== item.request.householdRef ||
        !selectedSet.has(row.accountRef)
      )
    ) {
      problems.push(
        `${item.caseId}: pending action semantics must bind to the request household and selected funding`,
      );
    }
  }
  const citedModels = evidenceSubjects(item, "model-assignment");
  for (const row of item.records.modelAssignments) {
    if (
      citedModels.has(row.id) &&
      row.pendingRebalance &&
      !selectedSet.has(row.accountRef)
    ) {
      problems.push(
        `${item.caseId}: pending model semantics must bind to selected funding`,
      );
    }
  }
  return problems;
};

const CONTEXT_RULES: Readonly<
  Record<string, (item: EmittedCase) => boolean>
> = {
  "identity-ambiguous": (item) =>
    syntheticIdentityContext(item).ambiguous,
  "authority-boundary": (item) =>
    evidenceSubjects(item, "authority").size > 0,
  "destination-not-integral": (item) => {
    const instruction = item.records.bankInstructions.find(
      (row) => row.id === item.request.destinationRef,
    );
    const cited = evidenceSubjects(item, "bank-instruction");
    return instruction === undefined ||
      instruction.householdRef !== item.request.householdRef ||
      instruction.verifiedAt === null ||
      item.records.bankInstructions.some(
        (row) =>
          cited.has(row.id) &&
          row.id !== instruction.id &&
          row.bank === instruction.bank &&
          row.lastFour === instruction.lastFour,
      );
  },
  "instruction-conflict-present": (item) =>
    syntheticInstructionConflictAnalysis(item).present,
  "reserve-not-scalar": (item) =>
    ["modeled-segmented", "missing"].includes(reserveState(item)),
  "stale-evidence-present": (item) =>
    item.evidence.some((evidence) => evidence.freshness === "stale"),
  "authority-lapses-during-evidence-interval": (item) => {
    const cited = evidenceSubjects(item, "authority");
    return item.records.authorizedSigners.some((row) => {
      const evidence = item.evidence.find(
        (entry) => entry.kind === "authority" && entry.subjectRef === row.id,
      );
      return cited.has(row.id) &&
        row.effectiveTo !== null &&
        evidence !== undefined &&
        epochMs(evidence.observedAt) < epochMs(row.effectiveTo) &&
        epochMs(row.effectiveTo) <= epochMs(evidence.retrievedAt);
    });
  },
  "restriction-not-in-force": (item) => {
    const cited = new Set([
      ...evidenceSubjects(item, "restriction"),
      ...evidenceSubjects(item, "household-instruction"),
    ]);
    return item.records.restrictions.some(
      (row) => cited.has(row.id) && !row.inForceAtAsOf,
    );
  },
  "position-hold-present": (item) => {
    const cited = evidenceSubjects(item, "legal-hold");
    return item.records.legalHolds.some(
      (row) => cited.has(row.id) && row.scope === "position",
    );
  },
  "nonreducing-pending-action-present": pendingContext,
  "time-zone-boundary": syntheticTimeZoneBoundary,
  "canonical-identity-collision": (item) =>
    syntheticIdentityContext(item).canonicalCollision,
  "threshold-equality": (item) =>
    item.thresholdPolicy !== null &&
    item.request.amountMinor === item.thresholdPolicy.thresholdMinor,
  "deadline-infeasible": (item) => !item.request.deadlineFeasible,
  "resolved-conflict-multi-subject":
    syntheticSharedInstructionBlastRadius,
  "selected-retirement-source-without-completed-review": (item) =>
    selectedFundingHasTaxClass(
      item.request.selectedFundingRefs,
      item.records.accounts,
      (account) => account.id,
      "retirement",
    ) &&
    item.taxReviewState !== "completed",
};

const selectorValue = (
  item: EmittedCase,
  rule: SemanticDefectRule,
): string | null => {
  switch (rule.treatmentSelector) {
    case "fixed":
      return "fixed";
    case "authority-state":
      return authorityEffective(item) ? "effective" : "ineffective";
    case "reserve-state": {
      const state = reserveState(item);
      return state === "inactive" ? null : state;
    }
    case "pending-availability":
      return selectedCitedPendingActions(
        item,
        evidenceSubjects(item, "pending-actions"),
      ).some((row) => pendingActionLiquidityTreatment(row.kind, row.state)
        .increasesAvailableLiquidity)
        ? "increased"
        : "unchanged";
    case "threshold-comparator":
      return item.thresholdPolicy?.comparator ?? "strict";
  }
};

export function syntheticSemanticProblems(
  cases: readonly EmittedCase[],
): string[] {
  const problems: string[] = [];
  for (const item of cases) {
    problems.push(...selectedFundingProblems(item));
    problems.push(...syntheticInstructionConflictAnalysis(item).problems);
    problems.push(
      ...syntheticIdentityContext(item, {
        ambiguous: item.outcomes.some(
          (outcome) =>
            outcome.defectClassId === "identity-resolution-ambiguity",
        ),
        canonicalCollision: item.outcomes.some(
          (outcome) =>
            outcome.defectClassId === "canonical-identity-defect",
        ),
      }).problems,
    );
    if (
      assumption(item, "AS-12") &&
      item.records.plannedWithdrawals.length > 0
    ) {
      problems.push(
        `${item.caseId}: AS-12 contradicts emitted withdrawal schedules`,
      );
    }
    const outcomes = new Map(
      item.outcomes.map((outcome) => [outcome.defectClassId, outcome]),
    );
    if (outcomes.size !== item.outcomes.length) {
      problems.push(
        `${item.caseId}: outcomes require unique defect classes`,
      );
    }
    const defects: string[] = [];
    for (const rule of contract.defectRules) {
      const context = CONTEXT_RULES[rule.contextRule];
      if (context === undefined) {
        problems.push(
          `${item.caseId}: semantic context rule "${rule.contextRule}" has no synthetic authority`,
        );
        continue;
      }
      const active = context(item);
      const outcome = outcomes.get(rule.id);
      if (active && outcome === undefined) {
        problems.push(
          `${item.caseId}: active "${rule.id}" context lacks a typed treatment`,
        );
        continue;
      }
      if (outcome === undefined) continue;
      const selector = selectorValue(item, rule);
      if (selector === null) {
        problems.push(
          `${item.caseId}: outcome "${rule.id}" requires cited reserve evidence`,
        );
        continue;
      }
      const treatment = semanticTreatment(
        rule,
        selector,
      );
      if (
        outcome.expectedTreatment !== treatment.expectedTreatment ||
        ![
          treatment.expectedTreatment,
          treatment.defectTreatment,
        ].includes(outcome.observedTreatment)
      ) {
        problems.push(
          `${item.caseId}: outcome "${rule.id}" is outside its closed treatment vocabulary`,
        );
      } else if (
        outcome.observedTreatment === treatment.defectTreatment
      ) {
        if (active) defects.push(rule.id);
        else {
          problems.push(
            `${item.caseId}: outcome "${rule.id}" claims a defect treatment without its required context`,
          );
        }
      }
    }
    for (const id of outcomes.keys()) {
      if (!contract.defectRules.some((rule) => rule.id === id)) {
        problems.push(
          `${item.caseId}: outcome references unknown defect class "${id}"`,
        );
      }
    }
    if (item.label.kind === "defect") {
      if (
        defects.length !== 1 ||
        defects[0] !== item.label.defectClassId
      ) {
        problems.push(
          `${item.caseId}: defect label lacks one matching expected-versus-observed treatment mismatch`,
        );
      }
    } else if (defects.length > 0) {
      problems.push(
        `${item.caseId}: clean-control carries semantic defect signatures: ${defects.join(", ")}`,
      );
    }
  }
  return problems;
}
