import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  canonicalJson,
  type JsonValue,
} from "../../src/contracts/decision-core/serialization";
import type { GeneratedFile } from "./generate";
import {
  pendingActionLiquidityTreatment,
  type PendingActionKind,
  type PendingActionState,
} from "./pending-actions";
import {
  deriveRealDerivedFreshness,
  type RealDerivedEvidenceKind,
} from "./real-derived-policy";
import { readTree } from "./tree";
import { REAL_DERIVED_DIR, SPEC_DIR } from "./world";

const OPAQUE_TOKEN = /^tok:[0-9a-f]{16}$/;
const REPLAY_SCHEMA_FILE = "real-derived-replay-schema.json";

type PendingReplay = {
  actionRef: string | null;
  actionKind: PendingActionKind | null;
  actionState: PendingActionState | null;
  direction: "outgoing" | "incoming" | "unknown" | null;
  liquidityClass: "distribution" | "debit" | "credit" | "unclassified" | null;
  amountMinor: number | null;
  reducesEffectiveLiquidity: boolean;
  increasesAvailableLiquidity: boolean;
};
type ReplayPayload = {
  request: { householdRef: string; destinationRef: string; amountMinor: number };
  identity: { resolution: "unique" | "ambiguous" | "canonical-collision"; candidateRefs: string[] };
  destination: { instructionRef: string; householdRef: string; ownerRefs: string[]; ownership: "same-household" | "cross-household" };
  liquidity: { sources: Array<{ accountRef: string }>; reserveState: "modeled-scalar" | "modeled-segmented" | "missing"; reserveRequiredMinor: number | null; withdrawalSegmentsMinor: number[]; pendingAction: PendingReplay };
  authority: { grantRef: string | null; authorityScope: "distribution-request" | "other" | "missing"; authorityState: "effective" | "expired" | "not-yet-effective" | "wrong-scope" | "missing"; validFrom: string | null; validTo: string | null };
  policy: { thresholdMinor: number; thresholdComparison: "below" | "equal" | "above"; restrictionRef: string | null; restrictionState: "absent" | "in-force" | "expired" | "future"; legalHoldRef: string | null; legalHoldScope: "none" | "account" | "position" };
  instructionConflict: { conflictState: "none" | "present" | "resolved"; instructionRefs: string[]; impactedSubjectRefs: string[] };
  temporal: { eventAt: string };
  evidenceRefs: string[];
  execution: { reservationKeys: string[]; preconditions: string[] };
};
type RealDerivedCase = {
  caseId: string;
  corpusVersion: string;
  scrubAttestation: { extractedAt: string; extractedBy: string; scrubbedBy: string; scrubbedAt: string; reviewedBy: string; reviewedAt: string; recordsBefore: number; recordsAfter: number };
  label: { kind: "defect"; defectClassId: string } | { kind: "clean-control"; controlRationaleId: string };
  occurredAt: string;
  evaluation: { asOf: string; freshnessPolicyVersion: string };
  subjects: string[];
  replayPayload: ReplayPayload;
  evidence: Array<
    | { id: string; evidenceKind: RealDerivedEvidenceKind; subjectRef: string; observationState: "observed"; observedAt: string; retrievedAt: string; freshness: "fresh" | "stale" }
    | { id: string; evidenceKind: RealDerivedEvidenceKind; subjectRef: string; observationState: "missing"; observedAt: null; retrievedAt: string; freshness: "unknown" }
  >;
  reservations: Array<{ family: string; conflictKey: string }>;
};
const schemaFromSpec = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(SPEC_DIR, name), "utf8")) as Record<string, unknown>;
const ReplayPayloadSchema = z.fromJSONSchema(
  schemaFromSpec(REPLAY_SCHEMA_FILE),
) as z.ZodType<ReplayPayload>;
export const RealDerivedCaseSchema = z
  .fromJSONSchema(schemaFromSpec("real-derived-case-schema.json"))
  .superRefine((value, context) => {
    const replay = ReplayPayloadSchema.safeParse(
      (value as { replayPayload?: unknown }).replayPayload,
    );
    if (!replay.success) {
      for (const issue of replay.error.issues) {
        context.addIssue({ ...issue, path: ["replayPayload", ...issue.path] });
      }
    }
  }) as unknown as z.ZodType<RealDerivedCase>;

export function realDerivedCaseProblems(
  value: unknown,
  defectClassIds: ReadonlySet<string>,
  where: string,
): string[] {
  const parsed = RealDerivedCaseSchema.safeParse(value);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => {
      const path = issue.path.map((part) =>
        typeof part === "number" || /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(String(part))
          ? String(part) : "(redacted)");
      return `${where}: ${path.join(".") || "(root)"} - schema validation failed`;
    });
  }
  const attestation = parsed.data.scrubAttestation;
  const problems: string[] = [];
  const reject = (invalid: boolean, message: string): void => {
    if (invalid) problems.push(`${where}: ${message}`);
  };
  reject(attestation.recordsAfter > attestation.recordsBefore, "scrubAttestation.recordsAfter exceeds recordsBefore - scrubbing cannot add records");
  reject(attestation.scrubbedBy === attestation.reviewedBy, "scrubAttestation.reviewedBy must differ from scrubbedBy - review is a second pair of eyes");
  const chronology = [
    ["occurredAt", parsed.data.occurredAt],
    ["scrubAttestation.extractedAt", attestation.extractedAt],
    ["scrubAttestation.scrubbedAt", attestation.scrubbedAt],
    ["scrubAttestation.reviewedAt", attestation.reviewedAt],
  ] as const;
  for (let index = 1; index < chronology.length; index += 1) {
    const previous = chronology[index - 1]!;
    const current = chronology[index]!;
    reject(previous[1] > current[1], `${previous[0]} must not postdate ${current[0]}`);
  }
  const subjectCounts = new Map<string, number>();
  for (const subject of parsed.data.subjects) {
    subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1);
  }
  const evidenceIds = new Set<string>();
  for (const evidence of parsed.data.evidence) {
    const subjectCount = subjectCounts.get(evidence.subjectRef) ?? 0;
    reject(subjectCount !== 1, `evidence ${evidence.id} subjectRef resolves to ${subjectCount} subjects, expected exactly one`);
    reject(evidenceIds.has(evidence.id), `duplicate evidence id "${evidence.id}"`);
    evidenceIds.add(evidence.id);
    reject(!evidence.id.endsWith(`:${evidence.evidenceKind}`), `evidence ${evidence.id} does not match evidenceKind "${evidence.evidenceKind}"`);
    reject(evidence.retrievedAt > parsed.data.evaluation.asOf, `evidence ${evidence.id} retrievedAt must not postdate evaluation.asOf`);
    reject(
      evidence.observationState === "observed" &&
        evidence.observedAt > evidence.retrievedAt,
      `evidence ${evidence.id} observedAt must not postdate retrievedAt`,
    );
    const expectedFreshness = deriveRealDerivedFreshness(
      parsed.data.evaluation.freshnessPolicyVersion,
      evidence.evidenceKind,
      parsed.data.evaluation.asOf,
      evidence.observedAt,
    );
    reject(evidence.freshness !== expectedFreshness, `evidence ${evidence.id} freshness "${evidence.freshness}" does not match derived "${expectedFreshness}"`);
  }
  for (const reservation of parsed.data.reservations) {
    reject(!reservation.conflictKey.endsWith(`:${reservation.family}`), `conflictKey ${reservation.conflictKey} does not match family "${reservation.family}"`);
  }
  const payload = parsed.data.replayPayload;
  const payloadProblem = (path: string, invalid: boolean): void => {
    reject(invalid, `replayPayload.${path} is inconsistent`);
  };
  const duplicated = (values: readonly string[]): boolean =>
    new Set(values).size !== values.length;
  payloadProblem(
    "unique references",
    [
      parsed.data.subjects,
      parsed.data.reservations.map((item) => item.conflictKey),
      payload.identity.candidateRefs,
      payload.destination.ownerRefs,
      payload.liquidity.sources.map((source) => source.accountRef),
      payload.instructionConflict.instructionRefs,
      payload.instructionConflict.impactedSubjectRefs,
      payload.evidenceRefs,
      payload.execution.reservationKeys,
      payload.execution.preconditions,
    ].some(duplicated),
  );
  const liquidity = payload.liquidity;
  const action = liquidity.pendingAction;
  const actionValues = [
    action.actionRef,
    action.actionKind,
    action.actionState,
    action.direction,
    action.liquidityClass,
    action.amountMinor,
  ];
  const actionAbsent = actionValues.every((value) => value === null);
  payloadProblem(
    "liquidity.pendingAction",
    actionAbsent
      ? action.reducesEffectiveLiquidity || action.increasesAvailableLiquidity
      : actionValues.some((value) => value === null),
  );
  if (!actionAbsent && actionValues.every((value) => value !== null)) {
    const expected = pendingActionLiquidityTreatment(
      action.actionKind!,
      action.actionState!,
    );
    payloadProblem(
      "liquidity.pendingAction treatment",
      action.direction !== expected.direction ||
        action.liquidityClass !== expected.liquidityClass ||
        action.reducesEffectiveLiquidity !==
          expected.reducesEffectiveLiquidity ||
        action.increasesAvailableLiquidity !==
          expected.increasesAvailableLiquidity,
    );
  }
  payloadProblem("destination identity", payload.request.destinationRef !== payload.destination.instructionRef);
  const expectedOwnership =
    payload.request.householdRef === payload.destination.householdRef
      ? "same-household"
      : "cross-household";
  payloadProblem("destination ownership", payload.destination.ownership !== expectedOwnership);
  const expectedThreshold =
    payload.request.amountMinor < payload.policy.thresholdMinor
      ? "below"
      : payload.request.amountMinor === payload.policy.thresholdMinor
        ? "equal"
        : "above";
  payloadProblem("threshold comparison", payload.policy.thresholdComparison !== expectedThreshold);
  payloadProblem(
    "event chronology",
    parsed.data.occurredAt > parsed.data.evaluation.asOf ||
      payload.temporal.eventAt > parsed.data.evaluation.asOf,
  );
  const authority = payload.authority;
  if (authority.authorityState !== "missing") {
    const expectedAuthority =
      authority.authorityScope === "other"
        ? "wrong-scope"
        : authority.validFrom! > parsed.data.evaluation.asOf
          ? "not-yet-effective"
          : authority.validTo !== null &&
              authority.validTo <= parsed.data.evaluation.asOf
            ? "expired"
            : "effective";
    payloadProblem(
      "authority state",
      authority.authorityState !== expectedAuthority ||
        (authority.validTo !== null && authority.validTo < authority.validFrom!),
    );
  }
  const evidenceRefs = new Set(payload.evidenceRefs);
  reject(
    evidenceRefs.size !== evidenceIds.size ||
      [...evidenceIds].some((id) => !evidenceRefs.has(id)),
    "replayPayload evidenceRefs must exactly match evidence ids",
  );
  const reservationKeys = new Set(payload.execution.reservationKeys);
  const emittedKeys = new Set(parsed.data.reservations.map((entry) => entry.conflictKey));
  reject(
    reservationKeys.size !== emittedKeys.size ||
      [...emittedKeys].some((key) => !reservationKeys.has(key)),
    "replayPayload reservationKeys must exactly match reservations",
  );
  const referencedSubjects = new Set(parsed.data.evidence.map((entry) => entry.subjectRef));
  const pending: unknown[] = [payload];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string" && OPAQUE_TOKEN.test(current)) {
      referencedSubjects.add(current);
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current !== null && typeof current === "object") {
      pending.push(...Object.values(current));
    }
  }
  reject(
    referencedSubjects.size !== subjectCounts.size ||
      [...referencedSubjects].some((ref) => subjectCounts.get(ref) !== 1),
    "subjects must exactly inventory replay and evidence token references",
  );
  reject(parsed.data.label.kind === "defect" && !defectClassIds.has(parsed.data.label.defectClassId), "label.defectClassId is not in the closed defect taxonomy");
  return problems;
}

export interface RealDerivedDelivery {
  readonly deliveredPaths: readonly string[];
  readonly files: readonly GeneratedFile[];
  readonly problems: readonly string[];
}

export function loadRealDerivedDelivery(
  dir: string = REAL_DERIVED_DIR,
): RealDerivedDelivery {
  const entries = readTree(dir, "real-derived").filter(
    (entry) => entry.relPath !== "real-derived/README.md",
  );
  const files: GeneratedFile[] = [];
  const problems: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file" || entry.bytes === null) {
      problems.push(
        `${entry.relPath}: unsupported filesystem entry in real-derived intake`,
      );
      continue;
    }
    if (!entry.relPath.endsWith(".json")) {
      problems.push(`${entry.relPath}: only JSON case files are permitted`);
      continue;
    }
    try {
      const value = JSON.parse(entry.bytes) as JsonValue;
      const canonical = canonicalJson(value);
      if (!canonical.ok || entry.bytes !== `${canonical.value}\n`) {
        problems.push(
          `${entry.relPath}: input must be canonical JSON with unique object keys`,
        );
        continue;
      }
      files.push({
        relPath: entry.relPath,
        bytes: entry.bytes,
        value,
      });
    } catch {
      problems.push(`${entry.relPath}: invalid JSON`);
    }
  }
  return {
    deliveredPaths: entries.map((entry) => entry.relPath),
    files,
    problems,
  };
}
