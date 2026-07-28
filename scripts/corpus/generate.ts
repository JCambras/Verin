/**
 * CORPUS GENERATOR (v3 prompt 11, ADR-0034).
 *
 * Hand-owned spec + one root seed -> the synthetic partition, in canonical bytes.
 *
 * Determinism rules this file obeys, all fenced by `corpus-determinism`:
 *  - every derived value is keyed by its own path (scripts/corpus/seed.ts), so
 *    inserting a household changes only that household's cases;
 *  - no wall clock, no `Math.random`, no locale API, no `Intl`;
 *  - every collection is explicitly sorted before emission (never Set/Map order);
 *  - money is integer minor units, percentages basis points, no float ever;
 *  - every emitted string is NFC-normalized;
 *  - bytes come from `canonicalJson` plus exactly one trailing newline.
 */
import { canonicalJson, type JsonValue } from "../../src/contracts/decision-core/serialization";
import {
  addBusinessDays,
  deriveFreshness,
  epochMs,
  isWithinRecentChangeWindow,
  renderLocal,
  addSeconds,
  type EvidenceKindTiming,
} from "./clock";
import { conflictKey, isConflictFamily, reservationKey, idempotencyKey } from "./conflict-keys";
import {
  bankInstructionId,
  corpusCaseId,
  corpusProvenance,
  evidenceSnapshotId,
  legalHoldId,
  pendingActionId,
  recentChangeId,
  restrictionId,
  subjectId,
} from "./entities";
import { CORPUS_SEED, deriveIntInRange, deriveToken } from "./seed";
import { requireLegalHoldSubject, type CaseSpec, type LoadedSpec, type WorldSpec } from "./world";

/** Business days a custodian instruction needs before it can settle. */
const SETTLEMENT_BUSINESS_DAYS = 2;

export interface GeneratedFile {
  /** Path relative to `fixtures/corpus/`. */
  readonly relPath: string;
  readonly value: JsonValue;
  readonly bytes: string;
}

/** NFC everywhere: two spellings of one name must not be two subjects. */
const nfc = (value: string): string => value.normalize("NFC");

const byKey = <T extends { key: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.key, row]));

const sortedBy = <T>(rows: readonly T[], key: (row: T) => string): T[] =>
  [...rows].sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));

const evidenceRef = (ref: string): { kind: string; recordKey: string } => {
  const [kind = "", recordKey = ""] = ref.split("/");
  return { kind, recordKey };
};

/** Where a family's contention actually lives (design §4.5).
 *
 * `evidence` MUST arrive already sorted: scanning raw spec order would make a
 * semantically neutral reorder in `cases.json` change the conflict key, the case
 * bytes and `corpusDigest` - and every other consumer normalizes that order away. */
function conflictScope(
  family: string,
  corpusCase: CaseSpec,
  evidence: readonly string[],
  scopeSlug: string,
): string {
  const firstEvidence = (kinds: readonly string[]): string | null => {
    for (const ref of evidence) {
      const { kind, recordKey } = evidenceRef(ref);
      if (kinds.includes(kind)) return recordKey;
    }
    return null;
  };
  switch (family) {
    case "liquidity":
      return scopeSlug;
    case "bank-instruction":
      return corpusCase.request.destinationRef;
    case "account-registration":
      return corpusCase.request.sourceAccountRef;
    case "household-instruction":
      return firstEvidence(["household-instruction", "restriction"]) ?? scopeSlug;
    case "regulatory-hold":
      return firstEvidence(["legal-hold"]) ?? corpusCase.request.sourceAccountRef;
    case "party-authority":
      return firstEvidence(["authority"]) ?? scopeSlug;
    case "model-rebalance":
      return firstEvidence(["model-assignment"]) ?? corpusCase.request.sourceAccountRef;
    default:
      throw new Error(`corpus generate: no conflict scope defined for family "${family}"`);
  }
}

const findRecord = <T extends { key: string }>(
  rows: readonly T[],
  kind: string,
  recordKey: string,
): T => {
  const row = byKey(rows).get(recordKey);
  if (row === undefined) throw new Error(`corpus generate: ${kind}/${recordKey} does not resolve`);
  return row;
};

/**
 * WHEN THE EVIDENCE SOURCE OBSERVED the record - the instant freshness is
 * measured from. Read straight off the record's own committed observation
 * instant, never inferred from a business date: a long-standing authority, an
 * in-force instruction and a verified destination are all OLD IN BUSINESS AGE and
 * FRESHLY OBSERVED, and inferring one from the other planted
 * `evidence-staleness-unnoticed` in four of the five clean controls (D-078).
 */
function observedAtOf(world: WorldSpec, kind: string, recordKey: string): string {
  const find = <T extends { key: string }>(rows: readonly T[]): T => findRecord(rows, kind, recordKey);
  switch (kind) {
    case "balance":
      return find(world.accounts).balanceObservedAt;
    case "bank-instruction":
      return find(world.bankInstructions).observedAt;
    case "household-instruction":
    case "restriction":
      return find(world.restrictions).observedAt;
    case "planned-withdrawals":
      return find(world.plannedWithdrawals).observedAt;
    case "pending-actions":
      return find(world.pendingActions).observedAt;
    case "authority":
      return find(world.authorizedSigners).observedAt;
    case "model-assignment":
      return find(world.modelAssignments).observedAt;
    case "legal-hold":
      return find(world.legalHolds).observedAt;
    case "recent-change":
      return find(world.recentChanges).observedAt;
    default:
      throw new Error(`corpus generate: unknown evidence kind "${kind}"`);
  }
}

/**
 * WHEN THE UNDERLYING FACT last changed or was recorded - the business instant.
 * Distinct from `observedAt` and used only for recent-change-window membership:
 * "this destination was changed four days ago" is a fact about the record, not
 * about when we looked at it.
 */
function recordChangedAtOf(world: WorldSpec, kind: string, recordKey: string): string {
  const find = <T extends { key: string }>(rows: readonly T[]): T => findRecord(rows, kind, recordKey);
  switch (kind) {
    case "balance":
      return find(world.accounts).balanceObservedAt;
    case "bank-instruction": {
      const instruction = find(world.bankInstructions);
      return instruction.changedAt ?? instruction.verifiedAt ?? instruction.observedAt;
    }
    case "household-instruction":
    case "restriction":
      return find(world.restrictions).recordedAt;
    case "planned-withdrawals":
      return find(world.plannedWithdrawals).recordedAt;
    case "pending-actions":
      return find(world.pendingActions).createdAt;
    case "authority":
      return find(world.authorizedSigners).effectiveFrom;
    case "model-assignment":
      return find(world.modelAssignments).assignedAt;
    case "legal-hold":
      return find(world.legalHolds).recordedAt;
    case "recent-change":
      return find(world.recentChanges).changedAt;
    default:
      throw new Error(`corpus generate: unknown evidence kind "${kind}"`);
  }
}

/** The stable, derived subject id an evidence item points at. */
function subjectRefOf(kind: string, recordKey: string): string {
  switch (kind) {
    case "bank-instruction":
      return bankInstructionId(recordKey);
    case "household-instruction":
    case "restriction":
      return restrictionId(recordKey);
    case "pending-actions":
      return pendingActionId(recordKey);
    case "legal-hold":
      return legalHoldId(recordKey);
    case "recent-change":
      return recentChangeId(recordKey);
    default:
      return subjectId(recordKey);
  }
}

function timingOf(world: WorldSpec, kind: string): EvidenceKindTiming {
  const timing = world.evidenceKinds[kind];
  if (timing === undefined) throw new Error(`corpus generate: evidence kind "${kind}" has no timing band`);
  return timing;
}

/** The household subgraph a case is evaluated over. Scoped to ONE household so
 * adding another household cannot change this case's bytes. */
function householdSubgraph(world: WorldSpec, householdKey: string): JsonValue {
  const household = byKey(world.households).get(householdKey)!;
  const accounts = sortedBy(
    world.accounts.filter((account) => account.householdRef === householdKey),
    (account) => account.key,
  );
  const accountKeys = new Set(accounts.map((account) => account.key));
  const memberKeys = new Set(household.memberRefs);
  const relevantParties = sortedBy(
    world.parties.filter(
      (party) =>
        memberKeys.has(party.key) ||
        party.key === household.advisorRef ||
        world.authorizedSigners.some(
          (signer) => accountKeys.has(signer.accountRef) && signer.partyRef === party.key,
        ),
    ),
    (party) => party.key,
  );
  const schedule = world.plannedWithdrawals.find((row) => row.householdRef === householdKey) ?? null;
  /** Fail-closed: an unmodeled restriction scope aborts generation rather than
   * dropping the record, which would leave a case whose evidence points at a
   * record absent from its own subgraph. `loadSpec` refuses it by path first. */
  const restrictionInScope = (row: WorldSpec["restrictions"][number]): boolean => {
    switch (row.scope) {
      case "household":
        return row.subjectRef === householdKey;
      case "party":
        return memberKeys.has(row.subjectRef);
      case "account":
        return accountKeys.has(row.subjectRef);
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
    parties: relevantParties.map((party) => ({
      id: subjectId(party.key),
      kind: party.kind,
      rosterName: nfc(party.rosterName),
      roles: sortedBy(party.roles, (role) => role),
    })),
    accounts: accounts.map((account) => ({
      id: subjectId(account.key),
      registration: account.registration,
      custodian: account.custodian,
      balanceMinor: account.balanceMinor,
      balanceObservedAt: account.balanceObservedAt,
      taxClass: account.taxClass,
      ownerRefs: sortedBy(account.ownerRefs, (key) => key).map(subjectId),
    })),
    beneficiaries: sortedBy(
      world.beneficiaries.filter((row) => accountKeys.has(row.accountRef)),
      (row) => `${row.accountRef}/${row.partyRef}`,
    ).map((row) => ({
      accountRef: subjectId(row.accountRef),
      partyRef: subjectId(row.partyRef),
      sharePercentBps: row.sharePercentBps,
      tier: row.tier,
    })),
    authorizedSigners: sortedBy(
      world.authorizedSigners.filter((row) => accountKeys.has(row.accountRef)),
      (row) => row.key,
    ).map((row) => ({
      id: subjectId(row.key),
      accountRef: subjectId(row.accountRef),
      partyRef: subjectId(row.partyRef),
      authorityScope: row.authorityScope,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      observedAt: row.observedAt,
    })),
    bankInstructions: sortedBy(
      world.bankInstructions.filter((row) => row.householdRef === householdKey),
      (row) => row.key,
    ).map((row) => ({
      id: bankInstructionId(row.key),
      titledTo: subjectId(row.titledTo),
      bank: nfc(row.bank),
      lastFour: row.lastFour,
      verifiedAt: row.verifiedAt,
      changedAt: row.changedAt,
      observedAt: row.observedAt,
      accountRefs: sortedBy(row.accountRefs, (key) => key).map(subjectId),
    })),
    plannedWithdrawal:
      schedule === null
        ? null
        : {
            recordedAt: schedule.recordedAt,
            observedAt: schedule.observedAt,
            segments: schedule.segments.map((segment) => ({
              fromMonth: segment.fromMonth,
              monthlyMinor: segment.monthlyMinor,
            })),
          },
    restrictions: sortedBy(world.restrictions.filter(restrictionInScope), (row) => row.key).map((row) => ({
      id: restrictionId(row.key),
      scope: row.scope,
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
      world.modelAssignments.filter((row) => accountKeys.has(row.accountRef)),
      (row) => row.key,
    ).map((row) => ({
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
      accountRef: subjectId(row.accountRef),
      kind: row.kind,
      amountMinor: row.amountMinor,
      state: row.state,
      createdAt: row.createdAt,
      observedAt: row.observedAt,
      expectedSettleAt: row.expectedSettleAt,
      /** A BLOCKED action does not reduce effective liquidity (assumption AS-15). */
      reducesEffectiveLiquidity: row.state !== "blocked",
    })),
    legalHolds: sortedBy(
      world.legalHolds.filter((row) => accountKeys.has(requireLegalHoldSubject(row).accountKey)),
      (row) => row.key,
    ).map((row) => ({
      id: legalHoldId(row.key),
      subjectRef: row.subjectRef,
      scope: row.scope,
      recordedAt: row.recordedAt,
      observedAt: row.observedAt,
      releasedAt: row.releasedAt,
    })),
  } as JsonValue;
}

function generateCase(spec: LoadedSpec, corpusCase: CaseSpec, seed: string): GeneratedFile {
  const world = spec.world;
  const clock = world.clock;
  const caseId = corpusCaseId(corpusCase.key);
  const household = byKey(world.households).get(corpusCase.householdRef)!;
  const casePath = `case/${caseId}`;
  const settlementEarliest = addBusinessDays(clock.asOf, SETTLEMENT_BUSINESS_DAYS, clock.transitions);

  const evidenceRefs = sortedBy(corpusCase.evidence, (ref) => ref);
  const evidence = evidenceRefs.map((ref) => {
    const { kind, recordKey } = evidenceRef(ref);
    const timing = timingOf(world, kind);
    const observedAt = observedAtOf(world, kind, recordKey);
    const recordChangedAt = recordChangedAtOf(world, kind, recordKey);
    const lagSeconds = deriveIntInRange(
      seed,
      `${casePath}/evidence/${kind}/${recordKey}`,
      "retrieval-lag-seconds",
      timing.minRetrievalLagSeconds,
      timing.maxRetrievalLagSeconds,
    );
    const retrievedAt = addSeconds(clock.asOf, lagSeconds);
    return {
      id: evidenceSnapshotId(caseId, `${kind}:${recordKey}`),
      kind,
      subjectRef: subjectRefOf(kind, recordKey),
      /** The business instant: when the observed fact last changed or was
       * recorded. Recent-change-window membership is about THIS, never about
       * when the source happened to look. */
      recordChangedAt,
      recordChangedAtLocal: renderLocal(recordChangedAt, clock.transitions),
      observedAt,
      observedAtLocal: renderLocal(observedAt, clock.transitions),
      retrievedAt,
      retrievedAtLocal: renderLocal(retrievedAt, clock.transitions),
      retrievalLagSeconds: lagSeconds,
      freshness: deriveFreshness(clock.asOf, observedAt, timing),
      freshnessWindowDays: timing.freshnessWindowDays,
      withinRecentChangeWindow: isWithinRecentChangeWindow(
        clock.asOf,
        recordChangedAt,
        clock.recentChangeWindowDays,
      ),
      provenance: { ...corpusProvenance(clock.asOf, "high") },
    };
  });

  const reservations = sortedBy(corpusCase.conflictFamilies, (family) => family).map((family) => {
    if (!isConflictFamily(family)) {
      throw new Error(`corpus generate: case ${caseId} names unknown conflict family "${family}"`);
    }
    return {
      family,
      reservationId: reservationKey(caseId, family),
      firmId: corpusCase.firmId,
      conflictKey: conflictKey(conflictScope(family, corpusCase, evidenceRefs, household.scopeSlug), family),
    };
  });

  const assumptions = spec.cases.assumptions.filter((row) =>
    corpusCase.assumptionIds.includes(row.id),
  );

  const value: JsonValue = {
    caseId,
    corpusVersion: world.corpusVersion,
    partition: "synthetic",
    provenance: "synthetic-fixture",
    title: nfc(corpusCase.title),
    firmId: corpusCase.firmId,
    label: corpusCase.label as unknown as JsonValue,
    assumptions: assumptions.map((row) => ({
      id: row.id,
      structure: nfc(row.structure),
      falsifies: nfc(row.falsifies),
    })),
    generationToken: deriveToken(seed, casePath, "nonce"),
    recordProvenance: { ...corpusProvenance(clock.asOf, "high") },
    trigger: {
      asOf: clock.asOf,
      asOfLocal: renderLocal(clock.asOf, clock.transitions),
      timeZone: clock.timeZone,
      timeZoneDataVersion: clock.timeZoneDataVersion,
    },
    request: {
      householdRef: subjectId(household.key),
      sourceAccountRef: subjectId(corpusCase.request.sourceAccountRef),
      destinationRef: bankInstructionId(corpusCase.request.destinationRef),
      amountMinor: corpusCase.request.amountMinor,
      currency: "USD",
      deadline: corpusCase.request.deadline,
      deadlineLocal: renderLocal(corpusCase.request.deadline, clock.transitions),
      settlementEarliest,
      settlementEarliestLocal: renderLocal(settlementEarliest, clock.transitions),
      deadlineFeasible: epochMs(corpusCase.request.deadline) >= epochMs(settlementEarliest),
      idempotencyKey: idempotencyKey(
        caseId,
        household.scopeSlug,
        corpusCase.request.discriminator,
      ),
    },
    reservations,
    records: householdSubgraph(world, corpusCase.householdRef),
    evidence,
  };

  const serialized = canonicalJson(value);
  if (!serialized.ok) {
    throw new Error(`corpus generate: ${caseId} is not canonically serializable: ${serialized.error.message}`);
  }
  return { relPath: `synthetic/${caseId}.json`, value, bytes: `${serialized.value}\n` };
}

/** Every synthetic-partition file, in canonical (caseId-sorted) order. */
export function generateSyntheticCases(spec: LoadedSpec, seed: string = CORPUS_SEED): GeneratedFile[] {
  return sortedBy(
    spec.cases.cases.map((corpusCase) => generateCase(spec, corpusCase, seed)),
    (file) => file.relPath,
  );
}
