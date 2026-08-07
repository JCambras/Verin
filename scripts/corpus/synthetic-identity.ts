export interface SyntheticIdentityInput {
  unresolvedRawUtf8Hex: string;
  canonicalValue: string;
  candidates: Array<{
    entityKind: "household" | "party";
    entityRef: string;
    householdRef: string;
    rawUtf8Hex: string;
    canonicalValue: string;
  }>;
}

interface IdentityCase {
  caseId: string;
  identityInput?: SyntheticIdentityInput;
  records: {
    household: { id: string; memberRefs: string[] };
    referencedHouseholds: Array<{ id: string }>;
    parties: Array<{ id: string }>;
  };
}

interface IdentityExpectations {
  ambiguous: boolean;
  canonicalCollision: boolean;
}

const canonicalRawValue = (rawUtf8Hex: string): string | null => {
  if (!/^(?:[0-9a-f]{2})+$/.test(rawUtf8Hex)) return null;
  const decoded = Buffer.from(rawUtf8Hex, "hex").toString("utf8");
  return Buffer.from(decoded, "utf8").toString("hex") === rawUtf8Hex
    ? decoded.normalize("NFC").toLowerCase()
    : null;
};

export function syntheticIdentityContext(
  item: IdentityCase,
  expected: IdentityExpectations = {
    ambiguous: false,
    canonicalCollision: false,
  },
): {
  ambiguous: boolean;
  canonicalCollision: boolean;
  problems: string[];
} {
  const input = item.identityInput;
  const required = expected.ambiguous || expected.canonicalCollision;
  if (input === undefined) {
    return {
      ambiguous: false,
      canonicalCollision: false,
      problems: required
        ? [`${item.caseId}: identity context requires typed identity input`]
        : [],
    };
  }
  const problems: string[] = [];
  const canonicalInput = canonicalRawValue(input.unresolvedRawUtf8Hex);
  if (
    canonicalInput === null ||
    input.canonicalValue !== canonicalInput
  ) {
    problems.push(
      `${item.caseId}: unresolved identity bytes must match their canonical value`,
    );
  }
  const householdRefs = new Set([
    item.records.household.id,
    ...item.records.referencedHouseholds.map((row) => row.id),
  ]);
  const matching = input.candidates.filter((candidate) => {
    const canonicalCandidate = canonicalRawValue(candidate.rawUtf8Hex);
    const householdBound = householdRefs.has(candidate.householdRef);
    const entityBound = candidate.entityKind === "household"
      ? candidate.entityRef === candidate.householdRef &&
        householdRefs.has(candidate.entityRef)
      : candidate.householdRef === item.records.household.id &&
        item.records.household.memberRefs.includes(candidate.entityRef) &&
        item.records.parties.filter(
          (party) => party.id === candidate.entityRef,
        ).length === 1;
    if (
      canonicalCandidate === null ||
      candidate.canonicalValue !== canonicalCandidate ||
      !householdBound ||
      !entityBound
    ) {
      problems.push(
        `${item.caseId}: identity candidate must preserve valid raw bytes and resolve to its bound household entity`,
      );
      return false;
    }
    if (canonicalCandidate !== canonicalInput) {
      problems.push(
        `${item.caseId}: identity candidate does not exhibit the claimed canonical relationship`,
      );
      return false;
    }
    return true;
  });
  const distinctRefs = new Set(
    matching.map(
      (candidate) => `${candidate.entityKind}:${candidate.entityRef}`,
    ),
  );
  if (distinctRefs.size !== matching.length) {
    problems.push(`${item.caseId}: identity candidates must be distinct`);
  }
  const ambiguous = distinctRefs.size > 1;
  const canonicalCollision = matching.some(
    (candidate) =>
      candidate.rawUtf8Hex !== input.unresolvedRawUtf8Hex,
  );
  if (expected.ambiguous && !ambiguous) {
    problems.push(
      `${item.caseId}: unresolved identity must resolve to multiple exact candidates`,
    );
  }
  if (expected.canonicalCollision && !canonicalCollision) {
    problems.push(
      `${item.caseId}: identity bytes do not reproduce a canonical collision`,
    );
  }
  return { ambiguous, canonicalCollision, problems };
}
