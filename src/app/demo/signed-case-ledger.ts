import {
  asArray,
  asRecord,
  asString,
  asStringArray,
} from "./signed-case-fields";
import type { SignedLedgerEventData } from "./signed-case-types";

const OPTIONAL_STRING_FIELDS = [
  "decisionHash",
  "inputBundleHash",
  "priorDecisionHash",
  "priorInputBundleHash",
  "replacementDecisionHash",
  "replacementInputBundleHash",
  "reservationId",
  "reservationExpiresAt",
  "idempotencyKey",
] as const;

const OPTIONAL_ARRAY_FIELDS = ["conflictKeys", "reservationIds"] as const;

function parseEvidencePhase(
  value: unknown,
  path: string,
): NonNullable<SignedLedgerEventData["evidencePhase"]> {
  const phase = asString(value, path);
  if (
    phase !== "initial-decision" &&
    phase !== "pre-execution-revalidation"
  ) {
    throw new TypeError(`${path} is unsupported`);
  }
  return phase;
}

function parseOptionalStrings(
  ledger: Record<string, unknown>,
  path: string,
): Partial<SignedLedgerEventData> {
  return Object.fromEntries(
    OPTIONAL_STRING_FIELDS.flatMap((field) =>
      ledger[field] === undefined
        ? []
        : [[field, asString(ledger[field], `${path}.${field}`)]],
    ),
  );
}

function parseOptionalArrays(
  ledger: Record<string, unknown>,
  path: string,
): Partial<SignedLedgerEventData> {
  return Object.fromEntries(
    OPTIONAL_ARRAY_FIELDS.flatMap((field) =>
      ledger[field] === undefined
        ? []
        : [[field, asStringArray(ledger[field], `${path}.${field}`)]],
    ),
  );
}

export function parseLedgerEvents(
  value: unknown,
  caseId: string,
  inferredBindings: readonly {
    readonly stageId: string;
    readonly lifecyclePass: "initial" | "revalidated";
  }[],
): SignedLedgerEventData[] {
  let inferredIndex = 0;
  return asArray(value, `${caseId}.expectedLedgerEvents`).map(
    (entry, index) => {
      const path = `${caseId}.expectedLedgerEvents[${index}]`;
      const ledger = asRecord(entry, path);
      const type = asString(ledger.type, `${path}.type`);
      const inferred = type === "ApprovalRecorded"
        ? inferredBindings[inferredIndex++]
        : undefined;
      const stageId = ledger.stageId === undefined
        ? (inferred?.stageId ?? null)
        : asString(ledger.stageId, `${path}.stageId`);
      const lifecyclePass = ledger.lifecyclePass === undefined
        ? (inferred?.lifecyclePass ?? null)
        : asString(ledger.lifecyclePass, `${path}.lifecyclePass`);
      if (
        lifecyclePass !== null &&
        lifecyclePass !== "initial" &&
        lifecyclePass !== "revalidated"
      ) {
        throw new TypeError(`${path}.lifecyclePass is unsupported`);
      }
      if (
        type === "ApprovalRecorded" &&
        (stageId === null || lifecyclePass === null)
      ) {
        throw new TypeError(`${path} approval binding is incomplete`);
      }
      return {
        type,
        note: asString(ledger.note, `${path}.note`),
        stageId,
        lifecyclePass,
        actorId: ledger.actorId === undefined
          ? null
          : asString(ledger.actorId, `${path}.actorId`),
        roleId: ledger.roleId === undefined
          ? null
          : asString(ledger.roleId, `${path}.roleId`),
        requesterId: ledger.requesterId === undefined
          ? null
          : asString(ledger.requesterId, `${path}.requesterId`),
        ...(ledger.recordedAt === undefined
          ? {}
          : { recordedAt: asString(ledger.recordedAt, `${path}.recordedAt`) }),
        ...(ledger.evidencePhase === undefined
          ? {}
          : { evidencePhase: parseEvidencePhase(ledger.evidencePhase, `${path}.evidencePhase`) }),
        ...(ledger.evidenceSnapshotIds === undefined
          ? {}
          : { evidenceSnapshotIds: asStringArray(ledger.evidenceSnapshotIds, `${path}.evidenceSnapshotIds`) }),
        ...parseOptionalStrings(ledger, path),
        ...parseOptionalArrays(ledger, path),
      };
    },
  );
}
