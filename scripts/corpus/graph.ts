import type { EmittedCase } from "./synthetic-semantics";
import { REFERENCED_HOUSEHOLD_RELATIONSHIP_REASONS } from "./subgraph";

const RECORD_COLLECTIONS = [
  "referencedOwners",
  "accounts",
  "referencedAccounts",
  "authorizedSigners",
  "bankInstructions",
  "referencedBankInstructions",
  "plannedWithdrawals",
  "restrictions",
  "modelAssignments",
  "pendingActions",
  "legalHolds",
  "recentChanges",
] as const;
const HOUSEHOLD_OWNED_COLLECTIONS = ["accounts", "referencedAccounts", "bankInstructions", "referencedBankInstructions", "plannedWithdrawals", "pendingActions"] as const;

export function evidenceResolutionProblems(cases: readonly EmittedCase[]): string[] {
  const problems: string[] = [];
  for (const item of cases) {
    const idCounts = new Map<string, number>();
    const addId = (id: unknown, where: string): void => {
      if (typeof id !== "string" || id.length === 0) {
        problems.push(`${item.caseId}/${where}: emitted record has no id`);
        return;
      }
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    };
    addId(item.records.household?.id, "records.household");
    if (!Array.isArray(item.records.referencedHouseholds)) {
      problems.push(
        `${item.caseId}/records.referencedHouseholds: required emitted collection is missing`,
      );
    }
    for (const household of item.records.referencedHouseholds ?? []) {
      addId(household.id, "records.referencedHouseholds");
      if (
        household.relationshipReasons.length === 0 ||
        new Set(household.relationshipReasons).size !==
          household.relationshipReasons.length ||
        household.relationshipReasons.some(
          (reason) =>
            !REFERENCED_HOUSEHOLD_RELATIONSHIP_REASONS.includes(
              reason as (typeof REFERENCED_HOUSEHOLD_RELATIONSHIP_REASONS)[number],
            ),
        )
      ) {
        problems.push(
          `${item.caseId}/records.referencedHouseholds.${household.id}.relationshipReasons: expected unique closed relationship reasons`,
        );
      }
    }
    for (const party of item.records.parties ?? []) addId(party.id, "records.parties");
    for (const collection of RECORD_COLLECTIONS) {
      const rows = item.records[collection];
      if (!Array.isArray(rows)) {
        problems.push(`${item.caseId}/records.${collection}: required emitted collection is missing`);
        continue;
      }
      for (const row of rows) addId(row.id, `records.${collection}`);
    }
    const requireOne = (ref: unknown, where: string): void => {
      const count = typeof ref === "string" ? (idCounts.get(ref) ?? 0) : 0;
      if (count !== 1) {
        problems.push(
          `${item.caseId}/${where}: reference "${String(ref)}" resolves to ${count} emitted records, expected exactly one`,
        );
      }
    };
    requireOne(item.request.householdRef, "request.householdRef");
    requireOne(item.request.sourceAccountRef, "request.sourceAccountRef");
    for (const ref of item.request.selectedFundingRefs) {
      requireOne(ref, "request.selectedFundingRefs");
    }
    requireOne(item.request.destinationRef, "request.destinationRef");
    requireOne(item.records.household?.advisorRef, "records.household.advisorRef");
    for (const ref of item.records.household?.memberRefs ?? []) {
      requireOne(ref, "records.household.memberRefs");
    }
    for (const collection of HOUSEHOLD_OWNED_COLLECTIONS) {
      for (const row of item.records[collection] ?? []) {
        requireOne(row.householdRef, `records.${collection}.${row.id}.householdRef`);
      }
    }
    for (const row of item.records.accounts ?? []) {
      for (const ref of row.ownerRefs ?? []) {
        requireOne(ref, `records.accounts.${row.id}.ownerRefs`);
      }
    }
    if (!Array.isArray(item.records.beneficiaries)) {
      problems.push(`${item.caseId}/records.beneficiaries: required emitted collection is missing`);
    }
    for (const row of item.records.beneficiaries ?? []) {
      requireOne(row.accountRef, "records.beneficiaries.accountRef");
      requireOne(row.partyRef, "records.beneficiaries.partyRef");
    }
    for (const evidence of item.evidence) requireOne(evidence.subjectRef, `evidence.${evidence.id}.subjectRef`);
    for (const row of item.records.authorizedSigners ?? []) {
      requireOne(row.accountRef, `records.authorizedSigners.${row.id}.accountRef`);
      requireOne(row.partyRef, `records.authorizedSigners.${row.id}.partyRef`);
    }
    for (const row of item.records.bankInstructions ?? []) {
      requireOne(row.titledTo, `records.bankInstructions.${row.id}.titledTo`);
      for (const ref of row.accountRefs ?? []) {
        requireOne(ref, `records.bankInstructions.${row.id}.accountRefs`);
      }
    }
    for (const row of item.records.referencedBankInstructions ?? []) {
      requireOne(
        row.titledTo,
        `records.referencedBankInstructions.${row.id}.titledTo`,
      );
      for (const ref of row.accountRefs ?? []) {
        requireOne(
          ref,
          `records.referencedBankInstructions.${row.id}.accountRefs`,
        );
      }
    }
    for (const row of item.records.restrictions ?? []) {
      requireOne(
        row.householdRef,
        `records.restrictions.${row.id}.householdRef`,
      );
      requireOne(row.subjectRef, `records.restrictions.${row.id}.subjectRef`);
      if (row.term !== null) {
        requireOne(
          row.term.sourceAccountRef,
          `records.restrictions.${row.id}.term.sourceAccountRef`,
        );
        requireOne(
          row.term.targetRef,
          `records.restrictions.${row.id}.term.targetRef`,
        );
      }
    }
    for (const row of item.records.modelAssignments ?? []) {
      requireOne(row.accountRef, `records.modelAssignments.${row.id}.accountRef`);
    }
    for (const row of item.records.pendingActions ?? []) {
      requireOne(row.accountRef, `records.pendingActions.${row.id}.accountRef`);
    }
    for (const row of item.records.legalHolds ?? []) {
      const [, accountKey] = row.subjectRef.split(":");
      requireOne(
        accountKey === undefined ? undefined : `subject:${accountKey}`,
        `records.legalHolds.${row.id}.subjectRef`,
      );
    }
    for (const row of item.records.recentChanges ?? []) {
      requireOne(row.subjectRef, `records.recentChanges.${row.id}.subjectRef`);
    }
  }
  return problems;
}
