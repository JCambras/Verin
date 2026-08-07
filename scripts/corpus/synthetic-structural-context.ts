import {
  epochMs,
  localOffsetMinutes,
  renderLocal,
} from "./clock";
import type {
  EmittedCase,
  EmittedEvidence,
} from "./synthetic-semantics";

const recentChangeRecord = (
  item: EmittedCase,
  evidence: EmittedEvidence,
) => {
  const matches = item.records.recentChanges.filter(
    (record) =>
      record.id === evidence.subjectRef &&
      record.changedAt === evidence.recordChangedAt,
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const exactTemporalEvidence = (
  item: EmittedCase,
  evidence: EmittedEvidence,
): boolean => {
  if (
    evidence.kind !== "recent-change" ||
    evidence.localZone?.timeZone !== item.trigger.timeZone ||
    evidence.localZone.timeZoneDataVersion !==
      item.trigger.timeZoneDataVersion ||
    recentChangeRecord(item, evidence) === undefined
  ) {
    return false;
  }
  try {
    return (
      renderLocal(
        evidence.recordChangedAt,
        item.trigger.timeZoneTransitions ?? [],
      ) === evidence.recordChangedAtLocal
    );
  } catch {
    return false;
  }
};

export function syntheticTimeZoneBoundary(
  item: EmittedCase,
): boolean {
  const transitions = item.trigger.timeZoneTransitions;
  const evidence = item.evidence.filter(
    (entry) => entry.kind === "recent-change",
  );
  if (
    item.trigger.timeZone.length === 0 ||
    item.trigger.timeZoneDataVersion.length === 0 ||
    transitions === undefined ||
    transitions.length === 0 ||
    evidence.length < 2 ||
    !evidence.every((entry) => exactTemporalEvidence(item, entry))
  ) {
    return false;
  }
  try {
    const ordered = [...evidence].sort(
      (left, right) =>
        epochMs(left.recordChangedAt) - epochMs(right.recordChangedAt),
    );
    return ordered.slice(1).some((current, index) => {
      const prior = ordered[index]!;
      const priorAt = epochMs(prior.recordChangedAt);
      const currentAt = epochMs(current.recordChangedAt);
      const priorOffset = localOffsetMinutes(
        prior.recordChangedAt,
        transitions,
      );
      const currentOffset = localOffsetMinutes(
        current.recordChangedAt,
        transitions,
      );
      return (
        priorOffset !== currentOffset &&
        transitions.some(
          (transition) =>
            priorAt < epochMs(transition.at) &&
            epochMs(transition.at) <= currentAt &&
            transition.offsetMinutes === currentOffset,
        )
      );
    });
  } catch {
    return false;
  }
}

export function syntheticSharedInstructionBlastRadius(
  item: EmittedCase,
): boolean {
  const instructionEvidence = item.evidence.filter(
    (evidence) => evidence.kind === "bank-instruction",
  );
  const changeEvidence = item.evidence.filter(
    (evidence) => evidence.kind === "recent-change",
  );
  if (
    instructionEvidence.length !== 1 ||
    changeEvidence.length !== 1
  ) {
    return false;
  }
  const instructionMatches = item.records.bankInstructions.filter(
    (instruction) =>
      instruction.id === instructionEvidence[0]!.subjectRef &&
      instruction.id === item.request.destinationRef &&
      instruction.householdRef === item.request.householdRef,
  );
  const changes = item.records.recentChanges.filter(
    (change) =>
      change.id === changeEvidence[0]!.subjectRef &&
      change.subjectRef === instructionEvidence[0]!.subjectRef &&
      change.changedAt === changeEvidence[0]!.recordChangedAt,
  );
  if (instructionMatches.length !== 1 || changes.length !== 1) {
    return false;
  }
  if (
    instructionMatches[0]!.changedAt === null ||
    instructionMatches[0]!.changedAt !== changes[0]!.changedAt ||
    instructionEvidence[0]!.recordChangedAt !== changes[0]!.changedAt
  ) {
    return false;
  }
  const impacted = instructionMatches[0]!.accountRefs;
  const uniqueImpacted = new Set(impacted);
  const accounts = [
    ...item.records.accounts,
    ...item.records.referencedAccounts,
  ];
  return (
    uniqueImpacted.size > 1 &&
    uniqueImpacted.size === impacted.length &&
    [...uniqueImpacted].every(
      (accountRef) =>
        accounts.filter(
          (account) =>
            account.id === accountRef &&
            account.householdRef === item.request.householdRef,
        ).length === 1,
    )
  );
}
