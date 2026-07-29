import type { CasesSpec } from "./case-spec";
import { restrictionReferenceProblems } from "./synthetic-instruction-topology";
import type { WorldSpec } from "./world";

const duplicates = (values: readonly string[]): string[] => [
  ...new Set(
    values.filter((value, index) => values.indexOf(value) !== index),
  ),
];

export interface LegalHoldSubject {
  readonly accountKey: string;
  readonly positionId: string | null;
}

export function legalHoldSubject(
  hold: WorldSpec["legalHolds"][number],
): LegalHoldSubject | null {
  const [scope, accountKey, positionId, ...extra] =
    hold.subjectRef.split(":");
  if (
    scope !== hold.scope ||
    accountKey === undefined ||
    accountKey === "" ||
    extra.length > 0
  ) {
    return null;
  }
  if (hold.scope === "account") {
    return positionId === undefined
      ? { accountKey, positionId: null }
      : null;
  }
  return positionId !== undefined && positionId !== ""
    ? { accountKey, positionId }
    : null;
}

export function requireLegalHoldSubject(
  hold: WorldSpec["legalHolds"][number],
): LegalHoldSubject {
  const subject = legalHoldSubject(hold);
  if (subject === null) {
    throw new Error(
      `corpus: legalHolds[${hold.key}].subjectRef "${hold.subjectRef}" is not the ${hold.scope}-scoped form ` +
        `("account:<accountKey>" or "position:<accountKey>:<positionId>")`,
    );
  }
  return subject;
}

export function specReferenceProblems(
  world: WorldSpec,
  cases: CasesSpec,
): string[] {
  const problems: string[] = [...restrictionReferenceProblems(world)];
  const keys = <T extends { key: string }>(
    rows: readonly T[],
  ): Set<string> => new Set(rows.map((row) => row.key));
  const parties = keys(world.parties);
  const households = keys(world.households);
  const accounts = keys(world.accounts);
  const instructions = keys(world.bankInstructions);
  const signers = keys(world.authorizedSigners);
  const restrictions = keys(world.restrictions);
  const changes = keys(world.recentChanges);
  const models = keys(world.modelAssignments);
  const pending = keys(world.pendingActions);
  const holds = keys(world.legalHolds);
  const schedules = keys(world.plannedWithdrawals);
  const assumptions = new Set(cases.assumptions.map((a) => a.id));
  const keyedCollections = [
    ["parties", world.parties.map((p) => p.key)],
    ["households", world.households.map((h) => h.key)],
    ["households.scopeSlug", world.households.map((h) => h.scopeSlug)],
    ["accounts", world.accounts.map((a) => a.key)],
    ["authorizedSigners", world.authorizedSigners.map((s) => s.key)],
    ["bankInstructions", world.bankInstructions.map((b) => b.key)],
    ["plannedWithdrawals", world.plannedWithdrawals.map((w) => w.key)],
    ["restrictions", world.restrictions.map((r) => r.key)],
    ["recentChanges", world.recentChanges.map((c) => c.key)],
    ["modelAssignments", world.modelAssignments.map((m) => m.key)],
    ["pendingActions", world.pendingActions.map((a) => a.key)],
    ["legalHolds", world.legalHolds.map((h) => h.key)],
    ["cases", cases.cases.map((c) => c.key)],
    ["assumptions", cases.assumptions.map((a) => a.id)],
  ] as const;
  for (const [label, values] of keyedCollections) {
    for (const dup of duplicates(values)) {
      problems.push(`${label}: duplicate key "${dup}"`);
    }
  }
  for (const dup of duplicates([
    ...world.parties.map((row) => row.key),
    ...world.households.map((row) => row.key),
    ...world.accounts.map((row) => row.key),
  ])) {
    problems.push(
      `subject namespace: duplicate key "${dup}" across parties, households, or accounts`,
    );
  }
  const need = (
    set: Set<string>,
    ref: string,
    where: string,
  ): void => {
    if (!set.has(ref)) {
      problems.push(`${where} -> "${ref}" does not resolve`);
    }
  };
  const needOwnedAccount = (
    ref: string,
    householdRef: string,
    where: string,
    noun: string,
    ownerDescription: string,
  ): void => {
    need(accounts, ref, where);
    const account = world.accounts.find((row) => row.key === ref);
    if (account !== undefined && account.householdRef !== householdRef) {
      problems.push(
        `${where}: ${noun} belongs to household "${account.householdRef}", not ${ownerDescription} "${householdRef}"`,
      );
    }
  };
  for (const household of world.households) {
    for (const member of household.memberRefs) {
      need(parties, member, `households[${household.key}].memberRefs`);
    }
    need(
      parties,
      household.advisorRef,
      `households[${household.key}].advisorRef`,
    );
  }
  for (const account of world.accounts) {
    need(
      households,
      account.householdRef,
      `accounts[${account.key}].householdRef`,
    );
    for (const owner of account.ownerRefs) {
      need(parties, owner, `accounts[${account.key}].ownerRefs`);
    }
  }
  for (const beneficiary of world.beneficiaries) {
    need(
      accounts,
      beneficiary.accountRef,
      `beneficiaries[${beneficiary.accountRef}].accountRef`,
    );
    need(
      parties,
      beneficiary.partyRef,
      `beneficiaries[${beneficiary.accountRef}].partyRef`,
    );
  }
  for (const signer of world.authorizedSigners) {
    need(
      accounts,
      signer.accountRef,
      `authorizedSigners[${signer.key}].accountRef`,
    );
    need(
      parties,
      signer.partyRef,
      `authorizedSigners[${signer.key}].partyRef`,
    );
  }
  for (const instruction of world.bankInstructions) {
    need(
      households,
      instruction.householdRef,
      `bankInstructions[${instruction.key}].householdRef`,
    );
    need(
      parties,
      instruction.titledTo,
      `bankInstructions[${instruction.key}].titledTo`,
    );
    for (const account of instruction.accountRefs) {
      needOwnedAccount(
        account,
        instruction.householdRef,
        `bankInstructions[${instruction.key}].accountRefs`,
        "bank instruction account",
        "bank instruction household",
      );
    }
  }
  for (const schedule of world.plannedWithdrawals) {
    need(
      households,
      schedule.householdRef,
      `plannedWithdrawals[${schedule.key}].householdRef`,
    );
  }
  for (const action of world.pendingActions) {
    need(
      households,
      action.householdRef,
      `pendingActions[${action.key}].householdRef`,
    );
    needOwnedAccount(
      action.accountRef,
      action.householdRef,
      `pendingActions[${action.key}].accountRef`,
      "pending action account",
      "pending action household",
    );
  }
  for (const assignment of world.modelAssignments) {
    need(
      accounts,
      assignment.accountRef,
      `modelAssignments[${assignment.key}].accountRef`,
    );
  }
  for (const change of world.recentChanges) {
    const [prefix, key, ...extra] = change.subjectRef.split(":");
    const where = `recentChanges[${change.key}].subjectRef`;
    if (extra.length > 0 || key === undefined || key === "") {
      problems.push(
        `${where} -> "${change.subjectRef}" is not a supported structured subject`,
      );
    } else if (prefix === "bank-instruction") {
      need(instructions, key, where);
    } else if (prefix === "subject") {
      need(accounts, key, where);
    } else {
      problems.push(
        `${where} -> "${change.subjectRef}" uses unsupported subject kind "${prefix}"`,
      );
    }
    if (
      !change.priorValueRef.startsWith(`${change.subjectRef}@`) ||
      change.priorValueRef.length === change.subjectRef.length + 1
    ) {
      problems.push(
        `recentChanges[${change.key}].priorValueRef -> "${change.priorValueRef}" is not a prior version of "${change.subjectRef}"`,
      );
    }
  }
  for (const hold of world.legalHolds) {
    const subject = legalHoldSubject(hold);
    if (subject === null) {
      problems.push(
        `legalHolds[${hold.key}].subjectRef -> "${hold.subjectRef}" is not the ${hold.scope}-scoped form ("account:<accountKey>" or "position:<accountKey>:<positionId>")`,
      );
      continue;
    }
    need(
      accounts,
      subject.accountKey,
      `legalHolds[${hold.key}].subjectRef`,
    );
  }
  const collections: Record<string, Set<string>> = {
    balance: accounts,
    "bank-instruction": instructions,
    "household-instruction": restrictions,
    restriction: restrictions,
    "planned-withdrawals": schedules,
    "pending-actions": pending,
    authority: signers,
    "model-assignment": models,
    "legal-hold": holds,
    "recent-change": changes,
  };
  for (const corpusCase of cases.cases) {
    need(
      households,
      corpusCase.householdRef,
      `cases[${corpusCase.key}].householdRef`,
    );
    needOwnedAccount(
      corpusCase.request.sourceAccountRef,
      corpusCase.householdRef,
      `cases[${corpusCase.key}].request.sourceAccountRef`,
      "request source account",
      "request household",
    );
    for (const ref of corpusCase.request.selectedFundingRefs) {
      needOwnedAccount(
        ref,
        corpusCase.householdRef,
        `cases[${corpusCase.key}].request.selectedFundingRefs`,
        "selected funding account",
        "request household",
      );
    }
    for (const dup of duplicates(
      corpusCase.request.selectedFundingRefs,
    )) {
      problems.push(
        `cases[${corpusCase.key}].request.selectedFundingRefs: duplicate reference "${dup}"`,
      );
    }
    need(
      instructions,
      corpusCase.request.destinationRef,
      `cases[${corpusCase.key}].request.destinationRef`,
    );
    const identityInput = corpusCase.identityInput;
    if (identityInput !== undefined) {
      for (const duplicate of duplicates(
        identityInput.candidates.map(
          (candidate) =>
            `${candidate.entityKind}:${candidate.entityRef}`,
        ),
      )) {
        problems.push(
          `cases[${corpusCase.key}].identityInput.candidates: duplicate candidate "${duplicate}"`,
        );
      }
      for (const candidate of identityInput.candidates) {
        const where = `cases[${corpusCase.key}].identityInput.candidates`;
        need(households, candidate.householdRef, `${where}.householdRef`);
        if (candidate.entityKind === "household") {
          need(households, candidate.entityRef, `${where}.entityRef`);
          if (candidate.entityRef !== candidate.householdRef) {
            problems.push(
              `${where}: household candidate must bind to its own household`,
            );
          }
        } else {
          need(parties, candidate.entityRef, `${where}.entityRef`);
          const candidateHousehold = world.households.find(
            (row) => row.key === candidate.householdRef,
          );
          if (
            candidateHousehold !== undefined &&
            !candidateHousehold.memberRefs.includes(candidate.entityRef)
          ) {
            problems.push(
              `${where}: party candidate is not a member of its bound household`,
            );
          }
        }
      }
    }
    for (const id of corpusCase.assumptionIds) {
      need(
        assumptions,
        id,
        `cases[${corpusCase.key}].assumptionIds`,
      );
    }
    if (corpusCase.assumptionIds.includes("AS-04")) {
      const signerRefs = new Set(
        corpusCase.evidence.flatMap((ref) => {
          const [kind, key] = ref.split("/");
          return kind === "authority" && key !== undefined ? [key] : [];
        }),
      );
      const citedSigners = world.authorizedSigners.filter(
        (signer) =>
          signerRefs.has(signer.key) &&
          signer.accountRef === corpusCase.request.sourceAccountRef,
      );
      const household = world.households.find(
        (candidate) => candidate.key === corpusCase.householdRef,
      );
      if (citedSigners.length !== 1) {
        problems.push(
          `cases[${corpusCase.key}]: AS-04 outside-household signer must resolve exactly once for the request source account`,
        );
      } else if (
        household?.memberRefs.includes(citedSigners[0]!.partyRef) === true
      ) {
        problems.push(
          `cases[${corpusCase.key}]: AS-04 outside-household signer "${citedSigners[0]!.partyRef}" is also a request household member`,
        );
      }
    }
    for (const dup of duplicates(corpusCase.assumptionIds)) {
      problems.push(
        `cases[${corpusCase.key}].assumptionIds: duplicate reference "${dup}"`,
      );
    }
    for (const dup of duplicates(corpusCase.evidence)) {
      problems.push(
        `cases[${corpusCase.key}].evidence: duplicate reference "${dup}"`,
      );
    }
    for (const dup of duplicates(corpusCase.conflictFamilies)) {
      problems.push(
        `cases[${corpusCase.key}].conflictFamilies: duplicate family "${dup}"`,
      );
    }
    for (const dup of duplicates(
      corpusCase.outcomes.map((outcome) => outcome.defectClassId),
    )) {
      problems.push(
        `cases[${corpusCase.key}].outcomes: duplicate defect class "${dup}"`,
      );
    }
    for (const ref of corpusCase.evidence) {
      const [kind = "", recordKey = ""] = ref.split("/");
      const collection = collections[kind];
      if (collection === undefined) {
        problems.push(
          `cases[${corpusCase.key}].evidence -> unknown evidence kind "${kind}"`,
        );
        continue;
      }
      if (world.evidenceKinds[kind] === undefined) {
        problems.push(
          `cases[${corpusCase.key}].evidence -> evidence kind "${kind}" has no timing band in world.evidenceKinds`,
        );
      }
      need(
        collection,
        recordKey,
        `cases[${corpusCase.key}].evidence[${kind}]`,
      );
    }
  }
  for (const assumption of cases.assumptions) {
    if (
      !cases.cases.some((c) => c.assumptionIds.includes(assumption.id))
    ) {
      problems.push(
        `assumptions[${assumption.id}] is attacked by no case - an unexercised structure is decoration`,
      );
    }
  }
  for (const [kind, timing] of Object.entries(world.evidenceKinds)) {
    if (timing.minRetrievalLagSeconds > timing.maxRetrievalLagSeconds) {
      problems.push(
        `evidenceKinds[${kind}]: minRetrievalLagSeconds exceeds maxRetrievalLagSeconds`,
      );
    }
  }
  return problems;
}
