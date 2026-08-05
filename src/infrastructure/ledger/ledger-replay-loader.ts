import { createHash } from "node:crypto";
import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import type { PIIBearing } from "@contracts/pii";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import type {
  DecisionInputBundle,
  EvidenceSnapshotRef,
} from "@contracts/decision-core/evidence";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { deriveDecisionReplayProvenance } from "@contracts/decision-core/replay-provenance";
import {
  type BundleHashPreimage,
  type DecisionHashPreimage,
} from "@contracts/decision-core/serialization";
import type {
  DerivedProvenance,
  RecordProvenance,
} from "@contracts/provenance";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import { canonicalDigest } from "./ledger-canonical";
import { assertReplaySourcePiiBoundary } from "./ledger-pii";
import {
  loadReplaySourceOriginSequences,
  loadReplaySourceOrigins,
} from "./ledger-source-provenance";
import { verifiedReplayWindowOrigins } from "./ledger-replay-window";
import {
  parseRecordedReplaySource,
  type ReplaySourceHashPreimage,
} from "./ledger-source-registry";

export interface RecordedReplayEvent {
  readonly event: LedgerEntry;
  readonly sequence: number;
  readonly provenance: RecordProvenance;
}

export interface VerifiedReplayDecisionSource {
  readonly record: DecisionRecord;
  readonly provenance: DerivedProvenance;
}

export interface VerifiedReplaySources {
  readonly decisions: ReadonlyMap<string, VerifiedReplayDecisionSource>;
  readonly withheldDecisionIds: ReadonlySet<string>;
  readonly sourcesChecked: number;
}

interface EvidenceRow {
  id: string;
  canonical_json: string;
  schema_version: string;
  contract_schema_version: string;
  serializer_version: string;
  content_hash: string;
  snapshot_hash: string;
}

interface DecisionSourceRow {
  decision_id: string;
  input_bundle_id: string;
  decision_json: string;
  decision_schema_version: string;
  decision_serializer_version: string;
  decision_hash: string;
  decision_created_at: string;
  bundle_json: string;
  bundle_schema_version: string;
  bundle_serializer_version: string;
  engine_version: string;
  primitive_set_version: string;
  time_zone_data_version: string;
  bundle_hash: string;
}

interface MembershipRow {
  bundle_id: string;
  source_id: string;
  ordinal: number | string;
}

interface ParsedDecisionSource extends PIIBearing {
  readonly record: DecisionRecord;
  readonly bundle: DecisionInputBundle;
  readonly decisionHashPreimage: DecisionHashPreimage;
  readonly bundleHashPreimage: BundleHashPreimage;
}

function replaySourceError(reason: string): never {
  throw appError("STORE_CONSTRAINT", reason);
}

type ReplaySourceValue<K extends "evidence" | "bundle" | "decision"> =
  K extends "evidence"
    ? EvidenceSnapshotRef
    : K extends "bundle"
      ? DecisionInputBundle
      : DecisionRecord;

function requireCanonicalSource<K extends "evidence" | "bundle" | "decision">(
  kind: K,
  bytes: string,
  schemaVersion: string,
  serializerVersion: string,
  label: string,
): {
  readonly value: ReplaySourceValue<K>;
  readonly hashPreimage: ReplaySourceHashPreimage | null;
} {
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    return replaySourceError(`${label} is not JSON during replay`);
  }
  const parsed = parseRecordedReplaySource(
    kind,
    schemaVersion,
    serializerVersion,
    value,
  );
  if (!parsed.ok) return replaySourceError(`${parsed.reason} during replay`);
  if (parsed.canonicalBytes !== bytes) {
    return replaySourceError(`${label} bytes are not canonical during replay`);
  }
  try {
    assertReplaySourcePiiBoundary(kind, parsed.value);
  } catch {
    return replaySourceError(`${label} contains unclassified text during replay`);
  }
  return {
    value: parsed.value as ReplaySourceValue<K>,
    hashPreimage: parsed.hashPreimage,
  };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function verifyEvidenceRow(
  row: EvidenceRow,
  firmId: string,
): EvidenceSnapshotRef {
  const source = requireCanonicalSource(
    "evidence",
    row.canonical_json,
    row.contract_schema_version,
    row.serializer_version,
    "evidence snapshot",
  );
  const snapshot = source.value;
  const snapshotHash = createHash("sha256")
    .update(row.canonical_json, "utf8")
    .digest("hex");
  if (
    snapshot.firmId !== firmId ||
    snapshot.id !== row.id ||
    snapshot.schemaVersion !== row.schema_version ||
    snapshot.contentHash !== row.content_hash ||
    snapshotHash !== row.snapshot_hash
  ) return replaySourceError("evidence snapshot binding differs during replay");
  return snapshot;
}

function verifyEvidenceEvent(
  entry: RecordedReplayEvent,
  row: EvidenceRow | undefined,
): void {
  if (entry.event.type !== "EvidenceSnapshotRecorded" || !row) {
    if (entry.event.type === "EvidenceSnapshotRecorded") {
      replaySourceError("evidence snapshot is missing during replay");
    }
    return;
  }
  const snapshot = verifyEvidenceRow(row, entry.event.firmId);
  if (
    snapshot.firmId !== entry.event.firmId ||
    snapshot.id !== entry.event.evidenceSnapshotRef.id ||
    entry.event.contentHash !== row.content_hash ||
    entry.event.snapshotHash !== row.snapshot_hash
  ) replaySourceError("evidence snapshot binding differs during replay");
}

function parseDecisionSources(row: DecisionSourceRow): {
  readonly record: DecisionRecord;
  readonly bundle: DecisionInputBundle;
  readonly decisionHashPreimage: DecisionHashPreimage;
  readonly bundleHashPreimage: BundleHashPreimage;
} {
  const decision = requireCanonicalSource(
    "decision",
    row.decision_json,
    row.decision_schema_version,
    row.decision_serializer_version,
    "decision record",
  );
  const bundle = requireCanonicalSource(
    "bundle",
    row.bundle_json,
    row.bundle_schema_version,
    row.bundle_serializer_version,
    "decision input bundle",
  );
  if (decision.hashPreimage?.hashKind !== "decision-record") {
    return replaySourceError("decision hash codec is missing during replay");
  }
  if (bundle.hashPreimage?.hashKind !== "decision-input-bundle") {
    return replaySourceError("bundle hash codec is missing during replay");
  }
  return {
    record: decision.value,
    bundle: bundle.value,
    decisionHashPreimage: decision.hashPreimage,
    bundleHashPreimage: bundle.hashPreimage,
  };
}

async function loadReplaySources(
  tx: SqlQueryable,
  tenant: TenantContext,
  entries: readonly RecordedReplayEvent[],
  windowed: boolean,
): Promise<VerifiedReplaySources> {
  assertTenantContext(tenant);
  if (entries.some(({ event }) => event.firmId !== tenant.orgId)) {
    throw appError("AUTH_FAILED", "replay event tenant does not match read authority");
  }
  const evidenceEntries = entries.filter(
    ({ event }) => event.type === "EvidenceSnapshotRecorded",
  );
  const decisionEntries = entries.filter(
    ({ event }) => event.type === "DecisionRecorded",
  );
  const decisionIds = unique(decisionEntries.map(({ event }) =>
    event.type === "DecisionRecorded" ? event.decisionRef.id : ""));
  if (decisionIds.length !== decisionEntries.length) {
    replaySourceError("decision has multiple recording ledger facts");
  }
  const sourceRows = new Map<string, DecisionSourceRow>();
  if (decisionIds.length > 0) {
    const loaded = await tx.query<DecisionSourceRow>(
      `SELECT record.id AS decision_id,
              record.input_bundle_id,
              record.canonical_json AS decision_json,
              record.schema_version AS decision_schema_version,
              record.serializer_version AS decision_serializer_version,
              record.decision_hash,
              record.created_at AS decision_created_at,
              bundle.canonical_json AS bundle_json,
              bundle.schema_version AS bundle_schema_version,
              bundle.serializer_version AS bundle_serializer_version,
              bundle.engine_version,
              bundle.primitive_set_version,
              bundle.time_zone_data_version,
              bundle.bundle_hash
         FROM decision_records record
         JOIN decision_input_bundles bundle
           ON bundle.org_id = record.org_id AND bundle.id = record.input_bundle_id
        WHERE record.org_id = $1 AND record.id = ANY($2::text[])`,
      [tenant.orgId, decisionIds],
    );
    loaded.rows.forEach((row) => sourceRows.set(row.decision_id, row));
  }
  const parsed = new Map<string, ParsedDecisionSource>();
  for (const decisionId of decisionIds) {
    const row = sourceRows.get(decisionId);
    if (!row) replaySourceError("decision record is missing during replay");
    parsed.set(decisionId, parseDecisionSources(row));
  }
  const bundleIds = unique([...parsed.values()].map(({ bundle }) => bundle.id));
  const memberships = new Map<string, MembershipRow[]>();
  if (bundleIds.length > 0) {
    const loaded = await tx.query<MembershipRow>(
      `SELECT bundle_id, evidence_snapshot_id AS source_id, ordinal
         FROM decision_input_bundle_evidence
        WHERE org_id = $1 AND bundle_id = ANY($2::text[])
        ORDER BY bundle_id ASC, ordinal ASC`,
      [tenant.orgId, bundleIds],
    );
    for (const row of loaded.rows) {
      const rows = memberships.get(row.bundle_id) ?? [];
      rows.push(row);
      memberships.set(row.bundle_id, rows);
    }
  }
  const evidenceIds = unique([
    ...evidenceEntries.map(({ event }) =>
      event.type === "EvidenceSnapshotRecorded"
        ? event.evidenceSnapshotRef.id
        : ""),
    ...[...parsed.values()].flatMap(({ bundle }) =>
      bundle.evidenceSnapshotRefs.map((ref) => ref.id)),
  ]);
  const evidenceRows = new Map<string, EvidenceRow>();
  if (evidenceIds.length > 0) {
    const loaded = await tx.query<EvidenceRow>(
      `SELECT id, canonical_json, schema_version, contract_schema_version,
              serializer_version, content_hash, snapshot_hash
         FROM evidence_snapshots
        WHERE org_id = $1 AND id = ANY($2::text[])`,
      [tenant.orgId, evidenceIds],
    );
    loaded.rows.forEach((row) => evidenceRows.set(row.id, row));
  }
  evidenceEntries.forEach((entry) => {
    if (entry.event.type === "EvidenceSnapshotRecorded") {
      verifyEvidenceEvent(entry, evidenceRows.get(entry.event.evidenceSnapshotRef.id));
    }
  });
  const origins = windowed
    ? verifiedReplayWindowOrigins(
        tenant,
        entries,
        new Map([...parsed].map(([id, source]) => [id, source.bundle.id])),
        await loadReplaySourceOriginSequences(
          tx,
          tenant,
          evidenceIds,
          bundleIds,
        ),
      )
    : await loadReplaySourceOrigins(
        tx,
        tenant,
        evidenceIds,
        bundleIds,
      );
  const evidenceSequences = new Map<string, number[]>();
  for (const entry of evidenceEntries) {
    if (entry.event.type !== "EvidenceSnapshotRecorded") continue;
    const sequences = evidenceSequences.get(entry.event.evidenceSnapshotRef.id) ?? [];
    sequences.push(entry.sequence);
    evidenceSequences.set(entry.event.evidenceSnapshotRef.id, sequences);
  }
  const decisions = new Map<string, VerifiedReplayDecisionSource>();
  const withheldDecisionIds = new Set<string>();
  for (const entry of decisionEntries) {
    if (entry.event.type !== "DecisionRecorded") continue;
    const row = sourceRows.get(entry.event.decisionRef.id)!;
    const source = parsed.get(entry.event.decisionRef.id)!;
    const memberRows = memberships.get(source.bundle.id) ?? [];
    const memberIds = memberRows.map((member, index) =>
      Number(member.ordinal) === index ? member.source_id : "");
    const expectedIds = source.bundle.evidenceSnapshotRefs.map((ref) => ref.id);
    const decisionHash = canonicalDigest(
      source.decisionHashPreimage,
      "decision hash preimage",
    );
    const bundleHash = canonicalDigest(
      source.bundleHashPreimage,
      "bundle hash preimage",
    );
    if (
      source.record.firmId !== entry.event.firmId ||
      source.bundle.firmId !== entry.event.firmId ||
      source.record.id !== entry.event.decisionRef.id ||
      source.record.inputBundleRef.id !== source.bundle.id ||
      source.bundle.id !== row.input_bundle_id ||
      row.input_bundle_id !== source.bundle.id ||
      row.decision_hash !== source.record.decisionHash ||
      row.decision_created_at !== source.record.createdAt ||
      row.engine_version !== source.bundle.engineVersion ||
      row.primitive_set_version !== source.bundle.primitiveSetVersion ||
      row.time_zone_data_version !== source.bundle.timeZoneDataVersion ||
      row.bundle_hash !== source.bundle.bundleHash ||
      !decisionHash.ok ||
      decisionHash.value !== source.record.decisionHash ||
      entry.event.decisionHash !== source.record.decisionHash ||
      !bundleHash.ok ||
      bundleHash.value !== source.bundle.bundleHash ||
      entry.event.bundleHash !== source.bundle.bundleHash ||
      memberIds.length !== expectedIds.length ||
      memberIds.some((id, index) => id !== expectedIds[index])
    ) replaySourceError("decision replay source binding differs during replay");
    if (expectedIds.some((id) => !origins.snapshots.has(id))) {
      if (windowed) {
        withheldDecisionIds.add(entry.event.decisionRef.id);
        continue;
      }
      replaySourceError("decision evidence has no recording ledger fact");
    }
    expectedIds.forEach((id) => verifyEvidenceRow(
      evidenceRows.get(id) ?? replaySourceError("evidence snapshot is missing during replay"),
      tenant.orgId,
    ));
    const completeWindow = expectedIds.every((id) =>
      evidenceSequences.get(id)?.some((sequence) => sequence < entry.sequence));
    if (!completeWindow) {
      if (windowed) {
        withheldDecisionIds.add(entry.event.decisionRef.id);
        continue;
      }
      replaySourceError("decision evidence is missing before its recording event");
    }
    const bundleOrigin = origins.bundles.get(source.bundle.id);
    if (!bundleOrigin) {
      if (windowed) {
        withheldDecisionIds.add(entry.event.decisionRef.id);
        continue;
      }
      replaySourceError("decision input bundle has no recording ledger fact");
    }
    decisions.set(entry.event.decisionRef.id, {
      record: source.record,
      provenance: deriveDecisionReplayProvenance(
        source.bundle,
        source.record,
        expectedIds.map((id) => origins.snapshots.get(id)!),
        bundleOrigin,
        entry.provenance,
      ),
    });
  }
  if (windowed) {
    return {
      decisions,
      withheldDecisionIds,
      sourcesChecked: evidenceRows.size + sourceRows.size +
        bundleIds.length + [...memberships.values()].flat().length,
    };
  }
  const coverage = await tx.query<{
    orphan_evidence: number | string;
    orphan_bundles: number | string;
    orphan_decisions: number | string;
    source_count: number | string;
  }>(
    `SELECT
       (SELECT count(*) FROM evidence_snapshots s
         WHERE s.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_ledger l
            WHERE l.org_id = s.org_id
              AND l.evidence_snapshot_id = s.id
              AND l.event_type = 'EvidenceSnapshotRecorded'
         )) AS orphan_evidence,
       (SELECT count(*) FROM decision_input_bundles b
         WHERE b.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_records r
            WHERE r.org_id = b.org_id AND r.input_bundle_id = b.id
         )) AS orphan_bundles,
       (SELECT count(*) FROM decision_records r
         WHERE r.org_id = $1 AND NOT EXISTS (
           SELECT 1 FROM decision_ledger l
            WHERE l.org_id = r.org_id
              AND l.decision_id = r.id
              AND l.event_type = 'DecisionRecorded'
         )) AS orphan_decisions,
       (SELECT count(*) FROM evidence_snapshots WHERE org_id = $1) +
       (SELECT count(*) FROM decision_input_bundles WHERE org_id = $1) +
       (SELECT count(*) FROM decision_input_bundle_evidence WHERE org_id = $1) +
       (SELECT count(*) FROM decision_records WHERE org_id = $1) AS source_count`,
    [tenant.orgId],
  );
  const summary = coverage.rows[0];
  if (
    !summary ||
    Number(summary.orphan_evidence) !== 0 ||
    Number(summary.orphan_bundles) !== 0 ||
    Number(summary.orphan_decisions) !== 0
  ) replaySourceError("immutable replay source has no recording ledger fact");
  return {
    decisions,
    withheldDecisionIds,
    sourcesChecked: Number(summary.source_count),
  };
}

export function loadVerifiedReplayWindow(
  tx: SqlQueryable,
  tenant: TenantContext,
  entries: readonly RecordedReplayEvent[],
): Promise<VerifiedReplaySources> {
  assertTenantContext(tenant);
  return loadReplaySources(tx, tenant, entries, true);
}

export function verifyReplaySources(
  tx: SqlQueryable,
  tenant: TenantContext,
  entries: readonly RecordedReplayEvent[],
): Promise<VerifiedReplaySources> {
  assertTenantContext(tenant);
  return loadReplaySources(tx, tenant, entries, false);
}
