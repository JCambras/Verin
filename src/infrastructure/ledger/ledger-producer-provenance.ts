import type { SqlQueryable } from "@infra/store/db";
import { appError, type AppError } from "@contracts/errors";
import { assertNoPIIValues } from "@contracts/pii";
import { err, ok, type Result } from "@contracts/result";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import {
  COMPUTED_LEDGER_PROVENANCE_VERSION,
  DIRECT_LEDGER_PROVENANCE_VERSION,
  LEDGER_PROVENANCE_SERIALIZER_VERSION,
  canFeedComplianceDecision,
  computedProvenanceTrace,
  deriveArtifactProvenance,
  parseLedgerProducerProvenance,
  type ComputedLedgerProducerProvenance,
  type DerivedProvenance,
  type LedgerProducerProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
import { canonical, canonicalDigest } from "./ledger-canonical";
import {
  parseRecordedLedgerProvenance,
  type RecordedLedgerProvenanceFields,
} from "./ledger-schema-registry";

export const UNVERIFIED_COMPUTED_PROVENANCE_INPUT =
  "computed provenance input is outside the verified window";
const COMPUTED_CONFIDENCE_MISMATCH =
  "computed provenance confidence does not match verified ancestry";

export interface PreparedLedgerProducerProvenance {
  readonly value: LedgerProducerProvenance;
  readonly schemaVersion:
    | typeof DIRECT_LEDGER_PROVENANCE_VERSION
    | typeof COMPUTED_LEDGER_PROVENANCE_VERSION;
  readonly serializerVersion:
    typeof LEDGER_PROVENANCE_SERIALIZER_VERSION;
  readonly provenanceJson: string | null;
  readonly traceId: string | null;
  readonly traceJson: string | null;
  readonly traceDigest: string | null;
}

export interface StoredLedgerProvenance
{
  readonly orgId: string;
  readonly id: string;
  readonly sequence: number;
  readonly entryHash: string;
  readonly schemaVersion: string;
  readonly serializerVersion: string;
  readonly provSource: string;
  readonly provAsOf: string;
  readonly provConfidence: string;
  readonly provenanceSchemaVersion: string;
  readonly provenanceSerializerVersion: string;
  readonly provenanceJson: string | null;
  readonly provenanceTraceId: string | null;
}

interface StoredInputRow {
  readonly org_id: string;
  readonly id: string;
  readonly sequence: number | string;
  readonly entry_hash: string;
  readonly schema_version: string;
  readonly serializer_version: string;
  readonly prov_source: string;
  readonly prov_asof: string;
  readonly prov_confidence: string;
  readonly prov_schema_version: string;
  readonly prov_serializer_version: string;
  readonly prov_json: string | null;
  readonly prov_trace_id: string | null;
}

function fields(row: StoredInputRow): RecordedLedgerProvenanceFields {
  return {
    source: row.prov_source,
    asOf: row.prov_asof,
    confidence: row.prov_confidence,
    provenanceSchemaVersion: row.prov_schema_version,
    provenanceSerializerVersion: row.prov_serializer_version,
    provenanceJson: row.prov_json,
    provenanceTraceId: row.prov_trace_id,
  };
}

export function prepareLedgerProducerProvenance(
  value: unknown,
  orgId: string,
): Result<PreparedLedgerProducerProvenance, AppError> {
  const parsed = parseLedgerProducerProvenance(value);
  if (!parsed) {
    return err(appError("VALIDATION", "decision ledger provenance is invalid"));
  }
  try {
    assertNoPIIValues(parsed, "decision ledger provenance");
  } catch {
    return err(appError(
      "PII_VIOLATION",
      "decision ledger provenance contains prohibited PII",
    ));
  }
  if (parsed.source !== "computed") {
    return ok({
      value: parsed,
      schemaVersion: DIRECT_LEDGER_PROVENANCE_VERSION,
      serializerVersion: LEDGER_PROVENANCE_SERIALIZER_VERSION,
      provenanceJson: null,
      traceId: null,
      traceJson: null,
      traceDigest: null,
    });
  }
  const trace = computedProvenanceTrace(parsed);
  if (
    trace.traceRef.firmId !== orgId ||
    trace.inputs.some((input) => input.entryRef.firmId !== orgId)
  ) {
    return err(appError(
      "VALIDATION",
      "computed provenance references another tenant",
    ));
  }
  const provenanceJson = canonical(parsed, "computed ledger provenance");
  const traceJson = canonical(trace, "computed provenance trace");
  const traceDigest = canonicalDigest(trace, "computed provenance trace");
  if (!provenanceJson.ok || !traceJson.ok || !traceDigest.ok) {
    return err(appError(
      "VALIDATION",
      "computed provenance is not canonically serializable",
    ));
  }
  if (traceDigest.value !== parsed.derivation.traceDigest) {
    return err(appError(
      "VALIDATION",
      "computed provenance trace digest does not match canonical bytes",
    ));
  }
  return ok({
    value: parsed,
    schemaVersion: COMPUTED_LEDGER_PROVENANCE_VERSION,
    serializerVersion: LEDGER_PROVENANCE_SERIALIZER_VERSION,
    provenanceJson: provenanceJson.value,
    traceId: trace.traceRef.id,
    traceJson: traceJson.value,
    traceDigest: traceDigest.value,
  });
}

async function verifiedInputProvenances(
  tx: SqlQueryable,
  tenant: TenantContext,
  provenance: ComputedLedgerProducerProvenance,
  beforeSequence: number,
  verifiedEntryIds: ReadonlySet<string> | undefined,
  activeTraces: Set<string>,
  cache: Map<string, Promise<RecordProvenance>>,
): Promise<RecordProvenance[]> {
  const inputs: RecordProvenance[] = [];
  for (const input of provenance.derivation.inputs) {
    if (input.entryRef.firmId !== tenant.orgId) {
      throw appError("STORE_CONSTRAINT", "computed provenance references another tenant");
    }
    if (
      verifiedEntryIds &&
      !verifiedEntryIds.has(input.entryRef.id)
    ) {
      throw appError(
        "STORE_CONSTRAINT",
        UNVERIFIED_COMPUTED_PROVENANCE_INPUT,
      );
    }
    const result = await tx.query<StoredInputRow>(
      `SELECT org_id, id, sequence, entry_hash, schema_version,
              serializer_version, prov_source, prov_asof, prov_confidence,
              prov_schema_version, prov_serializer_version, prov_json,
              prov_trace_id
         FROM decision_ledger
        WHERE org_id = $1 AND id = $2 AND sequence < $3`,
      [input.entryRef.firmId, input.entryRef.id, beforeSequence],
    );
    const row = result.rows[0];
    if (!row || row.entry_hash !== input.entryHash) {
      throw appError(
        "STORE_CONSTRAINT",
        "computed provenance input digest is invalid",
      );
    }
    const key = `${row.org_id}\u0000${row.id}`;
    let pending = cache.get(key);
    if (!pending) {
      const parsed = parseRecordedLedgerProvenance(
        row.schema_version,
        row.serializer_version,
        fields(row),
      );
      if (!parsed) {
        throw appError(
          "STORE_CONSTRAINT",
          "computed provenance input is invalid",
        );
      }
      pending = parsed.source === "computed" && "derivation" in parsed
        ? verifyComputedProvenance(
            tx,
            tenant,
            parsed,
            Number(row.sequence),
            verifiedEntryIds,
            activeTraces,
            cache,
          )
        : Promise.resolve(
            parsed.source === "computed"
              ? deriveArtifactProvenance([parsed], parsed.asOf)
              : parsed,
          );
      cache.set(key, pending);
    }
    let verified;
    try {
      verified = await pending;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
    if (!canFeedComplianceDecision(verified)) {
      throw appError(
        "STORE_CONSTRAINT",
        "computed provenance input is not compliance-eligible",
      );
    }
    inputs.push(verified);
  }
  return inputs;
}

async function traceMatches(
  tx: SqlQueryable,
  tenant: TenantContext,
  provenance: ComputedLedgerProducerProvenance,
): Promise<boolean> {
  if (provenance.derivation.traceRef.firmId !== tenant.orgId) return false;
  const trace = computedProvenanceTrace(provenance);
  const expectedJson = canonical(trace, "computed provenance trace");
  const expectedDigest = canonicalDigest(trace, "computed provenance trace");
  if (!expectedJson.ok || !expectedDigest.ok) return false;
  const result = await tx.query<{
    schema_version: string;
    serializer_version: string;
    canonical_json: string;
    trace_digest: string;
  }>(
    `SELECT schema_version, serializer_version, canonical_json, trace_digest
       FROM decision_provenance_traces
      WHERE org_id = $1 AND id = $2`,
    [trace.traceRef.firmId, trace.traceRef.id],
  );
  const row = result.rows[0];
  return row !== undefined &&
    row.schema_version === trace.schemaVersion &&
    row.serializer_version === trace.serializerVersion &&
    row.canonical_json === expectedJson.value &&
    row.trace_digest === expectedDigest.value &&
    expectedDigest.value === provenance.derivation.traceDigest;
}

async function verifyComputedProvenance(
  tx: SqlQueryable,
  tenant: TenantContext,
  provenance: ComputedLedgerProducerProvenance,
  beforeSequence: number,
  verifiedEntryIds: ReadonlySet<string> | undefined,
  activeTraces: Set<string>,
  cache: Map<string, Promise<RecordProvenance>>,
): Promise<DerivedProvenance> {
  const traceId = provenance.derivation.traceRef.id;
  if (activeTraces.has(traceId)) {
    throw appError(
      "STORE_CONSTRAINT",
      "computed provenance trace is cyclic",
    );
  }
  activeTraces.add(traceId);
  try {
    if (!await traceMatches(tx, tenant, provenance)) {
      throw appError(
        "STORE_CONSTRAINT",
        "computed provenance trace is invalid",
      );
    }
    const inputs = await verifiedInputProvenances(
      tx,
      tenant,
      provenance,
      beforeSequence,
      verifiedEntryIds,
      activeTraces,
      cache,
    );
    const derived = deriveArtifactProvenance(inputs, provenance.asOf);
    if (provenance.confidence !== derived.confidence) {
      throw appError("STORE_CONSTRAINT", COMPUTED_CONFIDENCE_MISMATCH);
    }
    if (!canFeedComplianceDecision(derived)) {
      throw appError(
        "STORE_CONSTRAINT",
        "computed provenance ancestry is not compliance-eligible",
      );
    }
    return derived;
  } finally {
    activeTraces.delete(traceId);
  }
}

export async function verifyPreparedLedgerProducerProvenance(
  tx: SqlQueryable,
  tenant: TenantContext,
  prepared: PreparedLedgerProducerProvenance,
  beforeSequence: number,
): Promise<RecordProvenance> {
  assertTenantContext(tenant);
  if (prepared.value.source !== "computed") return prepared.value;
  const inputs = await verifiedInputProvenances(
    tx,
    tenant,
    prepared.value,
    beforeSequence,
    undefined,
    new Set(),
    new Map(),
  );
  const derived = deriveArtifactProvenance(inputs, prepared.value.asOf);
  if (prepared.value.confidence !== derived.confidence) {
    throw appError("STORE_CONSTRAINT", COMPUTED_CONFIDENCE_MISMATCH);
  }
  if (!canFeedComplianceDecision(derived)) {
    throw appError(
      "STORE_CONSTRAINT",
      "computed provenance ancestry is not compliance-eligible",
    );
  }
  return derived;
}

export async function verifyRecordedLedgerProvenance(
  tx: SqlQueryable,
  tenant: TenantContext,
  row: StoredLedgerProvenance,
  verifiedEntryIds?: ReadonlySet<string>,
  cache: Map<string, Promise<RecordProvenance>> = new Map(),
): Promise<RecordProvenance> {
  assertTenantContext(tenant);
  if (row.orgId !== tenant.orgId) {
    throw appError("STORE_CONSTRAINT", "ledger provenance tenant does not match authority");
  }
  const key = `${row.orgId}\u0000${row.id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = verifyRecordedLedgerProvenanceUncached(
    tx,
    tenant,
    row,
    verifiedEntryIds,
    cache,
  );
  cache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function verifyRecordedLedgerProvenanceUncached(
  tx: SqlQueryable,
  tenant: TenantContext,
  row: StoredLedgerProvenance,
  verifiedEntryIds: ReadonlySet<string> | undefined,
  cache: Map<string, Promise<RecordProvenance>>,
): Promise<RecordProvenance> {
  const parsed = parseRecordedLedgerProvenance(
    row.schemaVersion,
    row.serializerVersion,
    {
      source: row.provSource,
      asOf: row.provAsOf,
      confidence: row.provConfidence,
      provenanceSchemaVersion: row.provenanceSchemaVersion,
      provenanceSerializerVersion: row.provenanceSerializerVersion,
      provenanceJson: row.provenanceJson,
      provenanceTraceId: row.provenanceTraceId,
    },
  );
  if (!parsed) {
    throw appError(
      "STORE_CONSTRAINT",
      "ledger replay provenance is invalid",
    );
  }
  if (parsed.source === "computed" && "derivation" in parsed) {
    if (
      parsed.derivation.traceRef.firmId !== row.orgId ||
      parsed.derivation.inputs.some(
        (input) => input.entryRef.firmId !== row.orgId,
      )
    ) {
      throw appError(
        "STORE_CONSTRAINT",
        "computed provenance references another tenant",
      );
    }
    return verifyComputedProvenance(
      tx,
      tenant,
      parsed,
      row.sequence,
      verifiedEntryIds,
      new Set(),
      cache,
    );
  }
  return parsed.source === "computed"
    ? deriveArtifactProvenance([parsed], parsed.asOf)
    : parsed;
}

export async function assertNoOrphanComputedProvenanceTraces(
  tx: SqlQueryable,
  tenant: TenantContext,
): Promise<void> {
  assertTenantContext(tenant);
  const orgId = tenant.orgId;
  const result = await tx.query<{ n: number | string }>(
    `SELECT count(*) AS n
       FROM decision_provenance_traces trace
      WHERE trace.org_id = $1
        AND NOT EXISTS (
          SELECT 1
            FROM decision_ledger ledger
           WHERE ledger.org_id = trace.org_id
             AND ledger.prov_trace_id = trace.id
        )`,
    [orgId],
  );
  if (Number(result.rows[0]?.n ?? 0) !== 0) {
    throw appError(
      "STORE_CONSTRAINT",
      "computed provenance trace has no ledger reference",
    );
  }
}
