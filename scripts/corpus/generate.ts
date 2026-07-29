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
  authorityId,
  modelAssignmentId,
  pendingActionId,
  plannedWithdrawalId,
  recentChangeId,
  restrictionId,
  subjectId,
} from "./entities";
import { CORPUS_SEED, deriveIntInRange, deriveToken } from "./seed";
import { caseSubgraph } from "./subgraph";
import { type CaseSpec, type LoadedSpec, type WorldSpec } from "./world";

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
    case "planned-withdrawals":
      return plannedWithdrawalId(recordKey);
    case "authority":
      return authorityId(recordKey);
    case "model-assignment":
      return modelAssignmentId(recordKey);
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

function generateCase(spec: LoadedSpec, corpusCase: CaseSpec, seed: string): GeneratedFile {
  const world = spec.world;
  const clock = world.clock;
  const caseId = corpusCaseId(corpusCase.key);
  const household = byKey(world.households).get(corpusCase.householdRef)!;
  const sourceAccount = byKey(world.accounts).get(
    corpusCase.request.sourceAccountRef,
  )!;
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

  const assumptions = sortedBy(
    spec.cases.assumptions.filter((row) =>
      corpusCase.assumptionIds.includes(row.id),
    ),
    (row) => row.id,
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
    thresholdPolicy: corpusCase.thresholdPolicy ?? null,
    taxReviewState:
      corpusCase.taxReviewState ??
      (sourceAccount.taxClass === "retirement"
        ? "completed"
        : "not-required"),
    outcomes: sortedBy(
      corpusCase.outcomes,
      (outcome) => outcome.defectClassId,
    ),
    reservations,
    records: caseSubgraph(world, corpusCase),
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
