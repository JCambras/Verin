import type { JsonValue } from "../../src/contracts/decision-core/serialization";
import { epochMs } from "./clock";
import {
  authorityId,
  bankInstructionId,
  legalHoldId,
  modelAssignmentId,
  pendingActionId,
  plannedWithdrawalId,
  recentChangeId,
  restrictionId,
  subjectId,
} from "./entities";
import { pendingActionLiquidityTreatment } from "./pending-actions";
import { requireLegalHoldSubject, type CaseSpec, type WorldSpec } from "./world";

const nfc = (value: string): string => value.normalize("NFC");

const byKey = <T extends { key: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.key, row]));

const sortedBy = <T>(rows: readonly T[], key: (row: T) => string): T[] =>
  [...rows].sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));

const evidenceKeys = (corpusCase: CaseSpec, kind: string): Set<string> =>
  new Set(
    corpusCase.evidence.flatMap((ref) => {
      const [candidateKind, key] = ref.split("/");
      return candidateKind === kind && key !== undefined ? [key] : [];
    }),
  );

export const REFERENCED_HOUSEHOLD_RELATIONSHIP_REASONS = [
  "identity-candidate",
  "owns-account",
  "owns-bank-instruction",
] as const;

export function caseSubgraph(world: WorldSpec, corpusCase: CaseSpec): JsonValue {
  const householdKey = corpusCase.householdRef;
  const household = byKey(world.households).get(householdKey)!;
  const householdAccounts = sortedBy(
    world.accounts.filter((account) => account.householdRef === householdKey),
    (account) => account.key,
  );
  const householdAccountKeys = new Set(householdAccounts.map((account) => account.key));
  const instructionKeys = evidenceKeys(corpusCase, "bank-instruction");
  instructionKeys.add(corpusCase.request.destinationRef);
  const selectedBankInstructions = sortedBy(
    world.bankInstructions.filter(
      (row) => row.householdRef === householdKey || instructionKeys.has(row.key),
    ),
    (row) => row.key,
  );
  const bankInstructions = selectedBankInstructions.filter(
    (row) => row.householdRef === householdKey,
  );
  const referencedBankInstructions = selectedBankInstructions.filter(
    (row) => row.householdRef !== householdKey,
  );
  const linkedAccountKeys = new Set(
    referencedBankInstructions.flatMap((row) => row.accountRefs),
  );
  const referencedAccounts = sortedBy(
    world.accounts.filter(
      (account) =>
        !householdAccountKeys.has(account.key) && linkedAccountKeys.has(account.key),
    ),
    (account) => account.key,
  );
  const referencedHouseholdReasons = new Map<
    string,
    Set<(typeof REFERENCED_HOUSEHOLD_RELATIONSHIP_REASONS)[number]>
  >();
  const addReferencedHousehold = (
    ref: string,
    reason: (typeof REFERENCED_HOUSEHOLD_RELATIONSHIP_REASONS)[number],
  ): void => {
    if (ref === householdKey) return;
    referencedHouseholdReasons.set(
      ref,
      new Set([...(referencedHouseholdReasons.get(ref) ?? []), reason]),
    );
  };
  for (const account of referencedAccounts) addReferencedHousehold(account.householdRef, "owns-account");
  for (const instruction of referencedBankInstructions) addReferencedHousehold(instruction.householdRef, "owns-bank-instruction");
  for (const candidate of corpusCase.identityInput?.candidates ?? []) {
    addReferencedHousehold(candidate.householdRef, "identity-candidate");
  }
  const beneficiaries = sortedBy(
    world.beneficiaries.filter((row) => householdAccountKeys.has(row.accountRef)),
    (row) => `${row.accountRef}/${row.partyRef}`,
  );
  const memberKeys = new Set(household.memberRefs);
  const relevantParties = sortedBy(
    world.parties.filter(
      (party) =>
        memberKeys.has(party.key) ||
        party.key === household.advisorRef ||
        householdAccounts.some((account) => account.ownerRefs.includes(party.key)) ||
        beneficiaries.some((beneficiary) => beneficiary.partyRef === party.key) ||
        bankInstructions.some((instruction) => instruction.titledTo === party.key) ||
        world.authorizedSigners.some(
          (signer) =>
            householdAccountKeys.has(signer.accountRef) && signer.partyRef === party.key,
        ),
    ),
    (party) => party.key,
  );
  const restrictionInScope = (row: WorldSpec["restrictions"][number]): boolean => {
    switch (row.scope) {
      case "household":
        return row.subjectRef === householdKey;
      case "party":
        return memberKeys.has(row.subjectRef);
      case "account":
        return householdAccountKeys.has(row.subjectRef);
      case "position":
        throw new Error(
          `corpus generate: restriction "${row.key}" is position-scoped, which has no modeled subject form - use a position-scoped legal hold, or extend the spec and this subgraph together`,
        );
    }
  };
  return {
    household: {
      id: subjectId(household.key),
      scopeSlug: household.scopeSlug,
      displayName: nfc(household.displayName),
      advisorRef: subjectId(household.advisorRef),
      memberRefs: sortedBy(household.memberRefs, (key) => key).map(subjectId),
    },
    referencedHouseholds: sortedBy(
      [...referencedHouseholdReasons.entries()].map(([key, reasons]) => ({
        key,
        reasons: [...reasons],
      })),
      (row) => row.key,
    ).map((row) => ({
      id: subjectId(row.key),
      relationshipReasons: sortedBy(row.reasons, (reason) => reason),
    })),
    parties: relevantParties.map((party) => ({
      id: subjectId(party.key),
      kind: party.kind,
      rosterName: nfc(party.rosterName),
      roles: sortedBy(party.roles, (role) => role),
    })),
    accounts: householdAccounts.map((account) => ({
      id: subjectId(account.key),
      householdRef: subjectId(account.householdRef),
      registration: account.registration,
      custodian: account.custodian,
      balanceMinor: account.balanceMinor,
      balanceObservedAt: account.balanceObservedAt,
      taxClass: account.taxClass,
      ownerRefs: sortedBy(account.ownerRefs, (key) => key).map(subjectId),
    })),
    referencedAccounts: referencedAccounts.map((account) => ({
      id: subjectId(account.key),
      householdRef: subjectId(account.householdRef),
    })),
    beneficiaries: beneficiaries.map((row) => ({
      accountRef: subjectId(row.accountRef),
      partyRef: subjectId(row.partyRef),
      sharePercentBps: row.sharePercentBps,
      tier: row.tier,
    })),
    authorizedSigners: sortedBy(
      world.authorizedSigners.filter((row) => householdAccountKeys.has(row.accountRef)),
      (row) => row.key,
    ).map((row) => ({
      id: authorityId(row.key),
      accountRef: subjectId(row.accountRef),
      partyRef: subjectId(row.partyRef),
      authorityScope: row.authorityScope,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      observedAt: row.observedAt,
    })),
    bankInstructions: bankInstructions.map((row) => ({
      id: bankInstructionId(row.key),
      householdRef: subjectId(row.householdRef),
      titledTo: subjectId(row.titledTo),
      bank: nfc(row.bank),
      lastFour: row.lastFour,
      verifiedAt: row.verifiedAt,
      changedAt: row.changedAt,
      observedAt: row.observedAt,
      accountRefs: sortedBy(row.accountRefs, (key) => key).map(subjectId),
    })),
    referencedBankInstructions: referencedBankInstructions.map((row) => ({
      id: bankInstructionId(row.key),
      householdRef: subjectId(row.householdRef),
      accountRefs: sortedBy(row.accountRefs, (key) => key).map(subjectId),
    })),
    plannedWithdrawals: sortedBy(
      world.plannedWithdrawals.filter((row) => row.householdRef === householdKey),
      (row) => row.key,
    ).map((row) => ({
      id: plannedWithdrawalId(row.key),
      householdRef: subjectId(row.householdRef),
      recordedAt: row.recordedAt,
      observedAt: row.observedAt,
      segments: row.segments.map((segment) => ({
        fromMonth: segment.fromMonth,
        monthlyMinor: segment.monthlyMinor,
      })),
    })),
    restrictions: sortedBy(world.restrictions.filter(restrictionInScope), (row) => row.key).map((row) => ({
      id: restrictionId(row.key),
      scope: row.scope,
      subjectRef: subjectId(row.subjectRef),
      kind: row.kind,
      recordedAt: row.recordedAt,
      observedAt: row.observedAt,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      sourceRef: row.sourceRef,
      inForceAtAsOf:
        epochMs(row.effectiveFrom) <= epochMs(world.clock.asOf) &&
        (row.effectiveTo === null || epochMs(row.effectiveTo) > epochMs(world.clock.asOf)),
    })),
    modelAssignments: sortedBy(
      world.modelAssignments.filter((row) => householdAccountKeys.has(row.accountRef)),
      (row) => row.key,
    ).map((row) => ({
      id: modelAssignmentId(row.key),
      accountRef: subjectId(row.accountRef),
      modelId: row.modelId,
      assignedAt: row.assignedAt,
      observedAt: row.observedAt,
      pendingRebalance: row.pendingRebalance,
    })),
    pendingActions: sortedBy(
      world.pendingActions.filter((row) => row.householdRef === householdKey),
      (row) => row.key,
    ).map((row) => ({
      id: pendingActionId(row.key),
      householdRef: subjectId(row.householdRef),
      accountRef: subjectId(row.accountRef),
      kind: row.kind,
      amountMinor: row.amountMinor,
      state: row.state,
      createdAt: row.createdAt,
      observedAt: row.observedAt,
      expectedSettleAt: row.expectedSettleAt,
      ...pendingActionLiquidityTreatment(row.kind, row.state),
    })),
    legalHolds: sortedBy(
      world.legalHolds.filter((row) =>
        householdAccountKeys.has(requireLegalHoldSubject(row).accountKey),
      ),
      (row) => row.key,
    ).map((row) => ({
      id: legalHoldId(row.key),
      subjectRef: row.subjectRef,
      scope: row.scope,
      recordedAt: row.recordedAt,
      observedAt: row.observedAt,
      releasedAt: row.releasedAt,
    })),
    recentChanges: sortedBy(
      world.recentChanges.filter((row) => evidenceKeys(corpusCase, "recent-change").has(row.key)),
      (row) => row.key,
    ).map((row) => ({
      id: recentChangeId(row.key),
      subjectRef: row.subjectRef,
      changeKind: row.changeKind,
      changedAt: row.changedAt,
      observedAt: row.observedAt,
      priorValueRef: row.priorValueRef,
    })),
  } as JsonValue;
}
