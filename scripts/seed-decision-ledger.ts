import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlDb } from "../src/infrastructure/store/db";
import {
  DecisionInputBundleSchema,
  EvidenceSnapshotRefSchema,
} from "../src/contracts/decision-core/evidence";
import { DecisionRecordSchema } from "../src/contracts/decision-core/decision";
import {
  LEDGER_SCHEMA_VERSION,
  LedgerEntrySchema,
} from "../src/contracts/decision-core/ledger";
import {
  CANONICAL_SERIALIZER_VERSION,
  bundleHashPreimage,
  canonicalJson,
  decisionHashPreimage,
} from "../src/contracts/decision-core/serialization";
import { recordDecision } from "../src/infrastructure/ledger/ledger-store";
import { systemWriteActor } from "../src/contracts/principal";
import { retainedTextReference } from "../src/infrastructure/ledger/ledger-pii";
import { unwrap } from "../src/contracts/result";

const FIXTURES = join(import.meta.dirname, "../fixtures/decision-core");

function retenant(value: unknown, firmId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => retenant(item, firmId));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    key === "firmId" ? firmId : retenant(nested, firmId),
  ]));
}

function fixture(name: string, firmId: string): Record<string, unknown> {
  const parsed = JSON.parse(
    readFileSync(join(FIXTURES, `${name}.json`), "utf8"),
  ) as Record<string, unknown>;
  return retenant(parsed, firmId) as Record<string, unknown>;
}

/**
 * Project fixture free text onto its own reason code so the fail-closed retained-text
 * boundary accepts it. Shared with the test fixtures: two copies would drift the
 * moment the boundary's rules change, and only one of them would fail.
 */
export function retainedTextProjection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(retainedTextProjection);
  if (value === null || typeof value !== "object") return value;
  const projected = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      retainedTextProjection(nested),
    ]),
  );
  if (typeof projected.code === "string") {
    if ("summary" in projected) projected.summary = projected.code;
    if ("explanation" in projected) projected.explanation = projected.code;
    if ("messageTemplate" in projected) {
      projected.messageTemplate = projected.code;
    }
  }
  if (
    typeof projected.reasonCode === "string" &&
    "explanation" in projected
  ) {
    projected.explanation = projected.reasonCode;
  }
  return projected;
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(unwrap(canonicalJson(value as never)), "utf8")
    .digest("hex");
}

/** Seed one inspectable, clearly synthetic decision chain for the demo tenant. */
export async function seedDecisionLedger(
  db: SqlDb,
  firmId: string,
): Promise<void> {
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM decision_records WHERE org_id = $1 AND id = $2",
    [firmId, "dec:GC-01:0001"],
  );
  if (existing.rows.length > 0) return;

  const bundleCandidate = DecisionInputBundleSchema.parse({
    ...fixture("decision-input-bundle", firmId),
    bundleHash: "0".repeat(64),
  });
  const inputBundle = DecisionInputBundleSchema.parse({
    ...bundleCandidate,
    bundleHash: hash(bundleHashPreimage(bundleCandidate)),
  });
  const recordCandidate = DecisionRecordSchema.parse({
    ...(retainedTextProjection(
      fixture("decision-record-proceed", firmId),
    ) as Record<string, unknown>),
    decisionHash: "0".repeat(64),
  });
  const decisionRecord = DecisionRecordSchema.parse({
    ...recordCandidate,
    decisionHash: hash(decisionHashPreimage(recordCandidate)),
  });
  const evidenceSnapshots = inputBundle.evidenceSnapshotRefs.map((ref, index) =>
    EvidenceSnapshotRefSchema.parse({
      firmId,
      id: ref.id,
      kind: index === 0 ? "account-balance" : "household-instruction",
      sourceRef: { firmId, id: "source:synthetic-seed" },
      subjectRef: { firmId, id: `subject:synthetic:${index}` },
      observedAt: inputBundle.asOf,
      retrievedAt: inputBundle.asOf,
      attribution: retainedTextReference("2".repeat(64)),
      schemaVersion: "evidence/1.0.0",
      encryptedStorageRef: { firmId, id: `blob:synthetic:${index}` },
      contentHash: String(index + 1).repeat(64),
      freshness: "fresh",
    }));
  const eventBase = (id: string) => ({
    firmId,
    id,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    serializerVersion: CANONICAL_SERIALIZER_VERSION,
    occurredAt: inputBundle.asOf,
    recordedAt: inputBundle.asOf,
    actor: { firmId, systemId: "seed-decision-ledger" },
    correlationId: "seed:synthetic-decision-ledger",
  });
  const events = [
    ...evidenceSnapshots.map((snapshot, index) =>
      LedgerEntrySchema.parse({
        ...eventBase(`seed:ledger:evidence:${index}`),
        type: "EvidenceSnapshotRecorded",
        evidenceSnapshotRef: { firmId, id: snapshot.id },
        contentHash: snapshot.contentHash,
        snapshotHash: hash(snapshot),
      })),
    LedgerEntrySchema.parse({
      ...eventBase("seed:ledger:decision"),
      type: "DecisionRecorded",
      decisionRef: { firmId, id: decisionRecord.id },
      decisionHash: decisionRecord.decisionHash,
      bundleHash: inputBundle.bundleHash,
    }),
  ];
  const result = await recordDecision(db, systemWriteActor("seed", firmId).tenant, {
    evidenceSnapshots,
    inputBundle,
    decisionRecord,
    events,
    provenance: {
      source: "fixture",
      asOf: inputBundle.asOf,
      confidence: "high",
    },
  });
  if (!result.ok) {
    throw new Error(
      `decision ledger seed failed: ${result.error.code} ${result.error.message}`,
    );
  }
}
