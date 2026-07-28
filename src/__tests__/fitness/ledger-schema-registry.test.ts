import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "ts-morph";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT, inMemoryProject, realProject } from "./_fence-utils";
import { createMemoryDb, type SqlDb } from "@infra/store/db";
import { GENESIS_HASH, computeChainHash } from "@infra/audit/hash-chain";
import {
  LEDGER_SCHEMA_VERSION,
  LEDGER_SCHEMA_VERSIONS,
} from "@contracts/decision-core/ledger";
import {
  CANONICAL_SERIALIZER_VERSION,
  DECISION_CORE_SCHEMA_VERSION,
} from "@contracts/decision-core/serialization";
import type { RecordProvenance } from "@contracts/provenance";
import {
  canonicalizeRecordedLedgerValue,
  decisionLedgerChainPreimage,
  parseRecordedLedgerEvent,
  registeredLedgerEncodings,
} from "@infra/ledger/ledger-schema-registry";
import {
  parseRecordedReplaySource,
  registeredSourceEncodings,
} from "@infra/ledger/ledger-source-registry";
import { verifyDecisionLedger } from "@infra/ledger/ledger-verification";

/**
 * LEDGER-SCHEMA-REGISTRY FENCE (ADR-0033, charter #1/#13). `decision_ledger` and its
 * immutable source tables refuse DELETE, so every byte ever committed must stay
 * readable: a registry keyed off the CURRENT version constants would make the next
 * version bump orphan all existing rows with no repair path. This fence holds the
 * registries to being genuinely additive - a stored fixture at EVERY shipped version
 * still decodes, still round-trips to its recorded bytes, and still verifies through
 * the real chain verifier - and proves the check is not vacuous by showing an
 * unregistered version fails closed.
 */
interface RecordedRow {
  readonly payloadJson: string;
  readonly entryHash: string;
}
interface RecordedRowFixture {
  readonly firmId: string;
  readonly serializerVersion: string;
  readonly prevHash: string;
  readonly provenance: RecordProvenance;
  readonly evidenceSnapshotId: string;
  readonly versions: Record<string, Record<string, RecordedRow>>;
}
interface RecordedReplayFixture {
  readonly schemaVersion: string;
  readonly serializerVersion: string;
  readonly sources: readonly {
    readonly kind: "evidence" | "bundle" | "decision";
    readonly canonical: string;
    readonly hash: string;
  }[];
}

const FIXTURE = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "fixtures/decision-core/recorded-ledger-rows.json"),
    "utf8",
  ),
) as RecordedRowFixture;
const REPLAY_FIXTURE = JSON.parse(
  readFileSync(
    join(REPO_ROOT, "fixtures/decision-core/recorded-replay-sources.json"),
    "utf8",
  ),
) as RecordedReplayFixture;

const TS = "2026-07-26T13:30:00.000Z";
const encoding = (schemaVersion: string): string =>
  `${schemaVersion}|${FIXTURE.serializerVersion}`;
const LIVE_CODEC_DEPENDENCIES = new Set([
  "LedgerEntrySchema",
  "LEDGER_SCHEMA_VERSION",
  "EvidenceSnapshotRefSchema",
  "DecisionInputBundleSchema",
  "DecisionRecordSchema",
  "canonicalJson",
  "bundleHashPreimage",
  "decisionHashPreimage",
  "CANONICAL_SERIALIZER_VERSION",
  "DECISION_CORE_SCHEMA_VERSION",
]);

function liveCodecDependencies(source: SourceFile): string[] {
  return source.getImportDeclarations().flatMap((declaration) =>
    declaration.getNamedImports().map((item) => item.getName()))
    .filter((name) => LIVE_CODEC_DEPENDENCIES.has(name));
}

async function storeRecordedRow(
  db: SqlDb,
  schemaVersion: string,
  row: RecordedRow,
): Promise<void> {
  const payload = JSON.parse(row.payloadJson) as {
    id: string;
    type: string;
    schemaVersion: string;
    serializerVersion: string;
    occurredAt: string;
    recordedAt: string;
    actor: unknown;
    correlationId: string;
  };
  const actorJson = canonicalizeRecordedLedgerValue(
    payload.schemaVersion,
    payload.serializerVersion,
    payload.actor,
  );
  if (actorJson === null) throw new Error("fixture actor is not canonicalizable");
  await db.query(
    `INSERT INTO evidence_snapshots
      (org_id,id,canonical_json,schema_version,contract_schema_version,
       serializer_version,content_hash,snapshot_hash,recorded_at)
     VALUES ($1,$2,'{}','evidence/1.0.0',$3,$4,'b','c',$5)`,
    [
      FIXTURE.firmId, FIXTURE.evidenceSnapshotId, DECISION_CORE_SCHEMA_VERSION,
      CANONICAL_SERIALIZER_VERSION, TS,
    ],
  );
  await db.query(
    `INSERT INTO decision_ledger
      (org_id,id,sequence,event_type,schema_version,serializer_version,
       occurred_at,recorded_at,actor_json,correlation_id,payload_json,
       prev_hash,entry_hash,evidence_snapshot_id,prov_source,prov_asof,
       prov_confidence)
     VALUES ($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      FIXTURE.firmId, payload.id, payload.type, schemaVersion,
      FIXTURE.serializerVersion, payload.occurredAt, payload.recordedAt,
      actorJson, payload.correlationId, row.payloadJson,
      GENESIS_HASH, row.entryHash, FIXTURE.evidenceSnapshotId,
      FIXTURE.provenance.source, FIXTURE.provenance.asOf,
      FIXTURE.provenance.confidence,
    ],
  );
  await db.query(
    `INSERT INTO decision_ledger_anchor
      (org_id,max_sequence,entry_count,head_hash,updated_at)
     VALUES ($1,0,1,$2,$3)`,
    [FIXTURE.firmId, row.entryHash, payload.recordedAt],
  );
}

describe("decision-ledger schema registry fence", () => {
  let db: SqlDb;
  beforeEach(async () => {
    db = await createMemoryDb();
    await db.query(
      `INSERT INTO orgs
        (id,name,created_at,prov_source,prov_asof,prov_confidence)
       VALUES ($1,'Synthetic',$2,'synthetic-ledger-test',$2,'high')`,
      [FIXTURE.firmId, TS],
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it("enforces: the write version is registered and no shipped version was dropped", () => {
    expect(LEDGER_SCHEMA_VERSIONS).toContain(LEDGER_SCHEMA_VERSION);
    expect([...registeredLedgerEncodings()].sort()).toEqual(
      LEDGER_SCHEMA_VERSIONS.map(encoding).sort(),
    );
    expect(registeredLedgerEncodings()).toContain(
      `${LEDGER_SCHEMA_VERSION}|${CANONICAL_SERIALIZER_VERSION}`,
    );
    expect(Object.keys(FIXTURE.versions).sort()).toEqual(
      [...LEDGER_SCHEMA_VERSIONS].sort(),
    );
    for (const kind of ["evidence", "bundle", "decision"] as const) {
      expect(registeredSourceEncodings(kind)).toEqual([
        `${REPLAY_FIXTURE.schemaVersion}|${REPLAY_FIXTURE.serializerVersion}`,
      ]);
      expect(registeredSourceEncodings(kind)).toContain(
        `${DECISION_CORE_SCHEMA_VERSION}|${CANONICAL_SERIALIZER_VERSION}`,
      );
    }
  });

  it("enforces: retained codecs import only explicit versioned behavior", () => {
    const project = realProject();
    for (const file of [
      "src/infrastructure/ledger/ledger-schema-registry.ts",
      "src/infrastructure/ledger/ledger-source-registry.ts",
    ]) {
      expect(liveCodecDependencies(project.getSourceFileOrThrow(file))).toEqual(
        [],
      );
    }
  });

  it.each([...LEDGER_SCHEMA_VERSIONS])(
    "enforces: a stored fixture recorded at ledger schema %s still decodes and re-serializes",
    (schemaVersion) => {
      const rows = FIXTURE.versions[schemaVersion]!;
      expect(Object.keys(rows).length).toBeGreaterThan(0);
      for (const [eventType, row] of Object.entries(rows)) {
        const parsed = parseRecordedLedgerEvent(
          eventType,
          schemaVersion,
          FIXTURE.serializerVersion,
          JSON.parse(row.payloadJson),
        );
        expect(parsed.ok ? "" : parsed.reason).toBe("");
        if (!parsed.ok) return;
        expect(parsed.event.schemaVersion).toBe(schemaVersion);
        expect(parsed.canonicalBytes).toBe(row.payloadJson);
        const preimage = decisionLedgerChainPreimage(
          schemaVersion,
          FIXTURE.serializerVersion,
          row.payloadJson,
          FIXTURE.provenance,
        );
        expect(preimage).not.toBeNull();
        expect(computeChainHash(preimage!, GENESIS_HASH)).toBe(row.entryHash);
      }
    },
  );

  it("enforces: every retained replay-source codec reproduces its recorded bytes and hash", () => {
    for (const source of REPLAY_FIXTURE.sources) {
      const parsed = parseRecordedReplaySource(
        source.kind,
        REPLAY_FIXTURE.schemaVersion,
        REPLAY_FIXTURE.serializerVersion,
        JSON.parse(source.canonical),
      );
      expect(parsed.ok ? parsed.canonicalBytes : parsed.reason).toBe(source.canonical);
      expect(parsed.ok ? parsed.recordedHash : "").toBe(source.hash);
    }
  });

  it.each([...LEDGER_SCHEMA_VERSIONS])(
    "enforces: a ledger row stored at schema %s verifies L1-L4 through the real verifier",
    async (schemaVersion) => {
      await storeRecordedRow(
        db,
        schemaVersion,
        FIXTURE.versions[schemaVersion]!.EvidenceSnapshotRecorded!,
      );
      const verdict = await verifyDecisionLedger(db, FIXTURE.firmId);
      expect(
        verdict.levels.find((level) => !level.ok)?.reason ?? "",
      ).toBe("");
      expect(verdict.ok).toBe(true);
      expect(verdict.levels.map((level) => level.level)).toEqual([
        "L1", "L2", "L3", "L4",
      ]);
    },
  );

  describe("detects (companion): an unregistered encoding fails closed", () => {
    it("detects a retained codec that closes over live schemas or serializers", () => {
      const project = inMemoryProject({
        "/src/infrastructure/ledger/registry.ts":
          `import { LedgerEntrySchema } from "@contracts/decision-core/ledger";\n` +
          `import { canonicalJson } from "@contracts/decision-core/serialization";`,
      });
      expect(liveCodecDependencies(project.getSourceFiles()[0]!)).toEqual([
        "LedgerEntrySchema",
        "canonicalJson",
      ]);
    });

    it("an unshipped schema version has no decoder and no chain preimage", () => {
      const row = FIXTURE.versions[LEDGER_SCHEMA_VERSION]!.DecisionRecorded!;
      expect(
        parseRecordedLedgerEvent(
          "DecisionRecorded",
          "9.9.9",
          FIXTURE.serializerVersion,
          JSON.parse(row.payloadJson),
        ),
      ).toEqual({
        ok: false,
        reason: "unsupported ledger encoding 9.9.9/1.0.0",
      });
      expect(
        decisionLedgerChainPreimage(
          "9.9.9",
          FIXTURE.serializerVersion,
          row.payloadJson,
          FIXTURE.provenance,
        ),
      ).toBeNull();
    });

    it("a row decoded under the wrong registered version is rejected, not upcast", () => {
      const older = FIXTURE.versions["1.0.0"]!.DecisionRecorded!;
      expect(
        parseRecordedLedgerEvent(
          "DecisionRecorded",
          LEDGER_SCHEMA_VERSION,
          FIXTURE.serializerVersion,
          JSON.parse(older.payloadJson),
        ).ok,
      ).toBe(false);
    });

    it("a ledger row whose recorded version is unregistered fails L1 with a reason", async () => {
      const row = FIXTURE.versions[LEDGER_SCHEMA_VERSION]!.EvidenceSnapshotRecorded!;
      await storeRecordedRow(db, "9.9.9", row);
      const verdict = await verifyDecisionLedger(db, FIXTURE.firmId);
      expect(verdict.ok).toBe(false);
      expect(verdict.levels.at(-1)).toMatchObject({
        level: "L1",
        reason: "ledger chain preimage or provenance is unsupported",
      });
    });
  });
});
