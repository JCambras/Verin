import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import type { DecisionRecord } from "@contracts/decision-core/decision";
import { assertLedgerEventPiiBoundary } from "./ledger-pii";
import { parseRecordedReplaySource } from "./ledger-source-registry";

interface DecisionSourceRow {
  decision_hash: string;
  bundle_hash: string;
  canonical_json: string;
  schema_version: string;
  serializer_version: string;
}

interface DecisionBinding {
  readonly decisionHash: string;
  readonly bundleHash: string;
  readonly record: DecisionRecord | null;
}

interface EvidenceHashes {
  content_hash: string;
  snapshot_hash: string;
}

export interface SequencedLedgerEvent {
  readonly event: LedgerEntry;
  readonly sequence: number;
}

export interface LedgerAcceptanceVerdict {
  readonly ok: boolean;
  readonly sequence: number | null;
  readonly reason: string | null;
}

interface SequenceRow {
  event_sequence: number | string;
}

interface DecisionSequenceRow extends SequenceRow {
  requires_prior: boolean;
}

function referencedDecisionId(event: LedgerEntry): string | undefined {
  if ("decisionRef" in event) return event.decisionRef.id;
  if ("priorDecisionRef" in event) return event.priorDecisionRef.id;
  return undefined;
}

function parseDecisionBinding(row: DecisionSourceRow): DecisionBinding {
  let value: unknown;
  try {
    value = JSON.parse(row.canonical_json);
  } catch {
    return {
      decisionHash: row.decision_hash,
      bundleHash: row.bundle_hash,
      record: null,
    };
  }
  const parsed = parseRecordedReplaySource(
    "decision",
    row.schema_version,
    row.serializer_version,
    value,
  );
  return {
    decisionHash: row.decision_hash,
    bundleHash: row.bundle_hash,
    record: parsed.ok ? parsed.value : null,
  };
}

function referencedStageId(event: LedgerEntry): string | undefined {
  switch (event.type) {
    case "ApprovalRecorded":
    case "ApprovalStageExpired":
    case "ApprovalStageEscalated":
      return event.stageId;
    default:
      return undefined;
  }
}

function referencedStepId(event: LedgerEntry): string | undefined {
  switch (event.type) {
    case "ExecutionStarted":
    case "ExecutionSucceeded":
    case "ExecutionPartiallySucceeded":
    case "ExecutionFailed":
      return event.stepId;
    default:
      return undefined;
  }
}

function decisionStructureReason(
  event: LedgerEntry,
  record: DecisionRecord,
): string | null {
  const stageId = referencedStageId(event);
  if (stageId !== undefined) {
    const authority = record.result.kind === "proceed"
      ? record.result.authority
      : undefined;
    const stage = authority && authority.mode !== "automatic"
      ? authority.stages.find((candidate) => candidate.stageId === stageId)
      : undefined;
    if (!stage) return "ledger approval stage is absent from the immutable decision";
    if (event.type === "ApprovalStageEscalated") {
      const escalation = stage.escalationPath[event.escalationStepIndex];
      if (!escalation) {
        return "ledger approval escalation is absent from the immutable stage";
      }
      const recordedRoles = escalation.roleIds.map((role) => role.id);
      if (
        event.reasonCode !== escalation.reasonCode ||
        event.roleIds.length !== recordedRoles.length ||
        event.roleIds.some((role, index) => role.id !== recordedRoles[index])
      ) return "ledger approval escalation differs from the immutable stage";
    }
  }
  const stepId = referencedStepId(event);
  if (stepId !== undefined) {
    const step = record.result.kind === "proceed"
      ? record.result.executionPlan.steps.find((candidate) => candidate.id === stepId)
      : undefined;
    if (!step) return "ledger execution step is absent from the immutable decision";
  }
  return null;
}

function sourceBindingReason(
  event: LedgerEntry,
  evidence: ReadonlyMap<string, EvidenceHashes>,
  decisions: ReadonlyMap<string, DecisionBinding>,
): string | null {
  if (event.type === "EvidenceSnapshotRecorded") {
    const stored = evidence.get(event.evidenceSnapshotRef.id);
    if (
      stored?.content_hash !== event.contentHash ||
      stored.snapshot_hash !== event.snapshotHash
    ) return "ledger evidence hash does not match immutable snapshot";
  }
  if (
    event.type === "StatusObserved" &&
    event.evidenceSnapshotRef &&
    !evidence.has(event.evidenceSnapshotRef.id)
  ) return "cited evidence snapshot is not stored";
  const decisionId = referencedDecisionId(event);
  if (!decisionId) return null;
  const stored = decisions.get(decisionId);
  if (!stored) return "ledger decision reference has no immutable record";
  if (!stored.record) return "immutable decision record cannot be parsed";
  const claimedDecisionHash =
    event.type === "DecisionRecorded" || event.type === "ApprovalRecorded"
      ? event.decisionHash
      : "priorDecisionHash" in event
        ? event.priorDecisionHash
        : undefined;
  if (
    claimedDecisionHash !== undefined &&
    claimedDecisionHash !== stored.decisionHash
  ) return "ledger event decision hash does not match immutable record";
  if (
    (event.type === "ApprovalRecorded" &&
      event.inputBundleHash !== stored.bundleHash) ||
    (event.type === "DecisionRecorded" &&
      event.bundleHash !== stored.bundleHash)
  ) return "ledger input bundle hash does not match immutable bundle";
  return decisionStructureReason(event, stored.record);
}

async function verifyLedgerHistoryOrdering(
  tx: SqlQueryable,
  tenant: TenantContext,
  entries: readonly SequencedLedgerEvent[],
): Promise<LedgerAcceptanceVerdict> {
  assertTenantContext(tenant);
  const violations: LedgerAcceptanceVerdict[] = [];
  const decisionEvents = entries.flatMap(({ event, sequence }) => {
    const id = referencedDecisionId(event);
    return id
      ? [{ id, sequence, requiresPrior: event.type !== "DecisionRecorded" }]
      : [];
  });
  if (decisionEvents.length > 0) {
    const rows = await tx.query<DecisionSequenceRow>(
      `SELECT selected.event_sequence, selected.requires_prior
         FROM unnest($2::text[], $3::bigint[], $4::boolean[])
           AS selected(decision_id, event_sequence, requires_prior)
        WHERE (
          selected.requires_prior AND NOT EXISTS (
            SELECT 1 FROM decision_ledger recorded
             WHERE recorded.org_id = $1
               AND recorded.event_type = 'DecisionRecorded'
               AND recorded.decision_id = selected.decision_id
               AND recorded.sequence < selected.event_sequence
          )
        ) OR (
          NOT selected.requires_prior AND EXISTS (
            SELECT 1 FROM decision_ledger recorded
             WHERE recorded.org_id = $1
               AND recorded.event_type = 'DecisionRecorded'
               AND recorded.decision_id = selected.decision_id
               AND recorded.sequence < selected.event_sequence
          )
        )
        ORDER BY selected.event_sequence ASC
        LIMIT 1`,
      [
        tenant.orgId,
        decisionEvents.map(({ id }) => id),
        decisionEvents.map(({ sequence }) => sequence),
        decisionEvents.map(({ requiresPrior }) => requiresPrior),
      ],
    );
    const row = rows.rows[0];
    if (row) {
      violations.push({
        ok: false,
        sequence: Number(row.event_sequence),
        reason: row.requires_prior
          ? "decision event does not follow its DecisionRecorded fact"
          : "decision has multiple recording ledger facts",
      });
    }
  }
  const creations = entries.flatMap(({ event, sequence }) =>
    event.type === "ReservationCreated"
      ? [{ id: event.reservationRef.id, sequence }]
      : []);
  if (creations.length > 0) {
    const rows = await tx.query<SequenceRow>(
      `SELECT selected.event_sequence
         FROM unnest($2::text[], $3::bigint[])
           AS selected(reservation_id, event_sequence)
        WHERE EXISTS (
          SELECT 1 FROM decision_ledger created
           WHERE created.org_id = $1
             AND created.event_type = 'ReservationCreated'
             AND created.sequence < selected.event_sequence
             AND created.payload_json::jsonb #>> '{reservationRef,id}' =
                 selected.reservation_id
             AND NOT EXISTS (
               SELECT 1 FROM decision_ledger released
                WHERE released.org_id = created.org_id
                  AND released.event_type = 'ReservationReleased'
                  AND released.reservation_creation_id = created.id
                  AND released.sequence < selected.event_sequence
             )
        )
        ORDER BY selected.event_sequence ASC
        LIMIT 1`,
      [
        tenant.orgId,
        creations.map(({ id }) => id),
        creations.map(({ sequence }) => sequence),
      ],
    );
    if (rows.rows[0]) {
      violations.push({
        ok: false,
        sequence: Number(rows.rows[0].event_sequence),
        reason: "reservation already has an active immutable generation",
      });
    }
  }
  const releases = entries.flatMap(({ event, sequence }) =>
    event.type === "ReservationReleased"
      ? [{
          reservationId: event.reservationRef.id,
          decisionId: event.decisionRef.id,
          creationId: event.reservationCreationRef.id,
          sequence,
        }]
      : []);
  if (releases.length > 0) {
    const rows = await tx.query<SequenceRow>(
      `SELECT selected.event_sequence
         FROM unnest($2::text[], $3::text[], $4::text[], $5::bigint[])
           AS selected(reservation_id, decision_id, creation_id, event_sequence)
        WHERE NOT EXISTS (
          SELECT 1 FROM decision_ledger created
           WHERE created.org_id = $1
             AND created.id = selected.creation_id
             AND created.event_type = 'ReservationCreated'
             AND created.decision_id = selected.decision_id
             AND created.sequence < selected.event_sequence
             AND created.payload_json::jsonb #>> '{reservationRef,id}' =
                 selected.reservation_id
        )
        ORDER BY selected.event_sequence ASC
        LIMIT 1`,
      [
        tenant.orgId,
        releases.map(({ reservationId }) => reservationId),
        releases.map(({ decisionId }) => decisionId),
        releases.map(({ creationId }) => creationId),
        releases.map(({ sequence }) => sequence),
      ],
    );
    if (rows.rows[0]) {
      violations.push({
        ok: false,
        sequence: Number(rows.rows[0].event_sequence),
        reason: "reservation release does not follow its immutable generation",
      });
    }
  }
  return violations.sort((left, right) =>
    (left.sequence ?? 0) - (right.sequence ?? 0))[0] ?? {
    ok: true,
    sequence: null,
    reason: null,
  };
}

export async function assertLedgerHistoryOrdering(
  tx: SqlQueryable,
  tenant: TenantContext,
  event: LedgerEntry,
  sequence: number,
): Promise<void> {
  assertTenantContext(tenant);
  const verdict = await verifyLedgerHistoryOrdering(
    tx,
    tenant,
    [{ event, sequence }],
  );
  if (!verdict.ok) {
    throw appError("STORE_CONSTRAINT", verdict.reason ?? "ledger history ordering is invalid");
  }
}

/**
 * Bind event hash claims to immutable source rows. This is storage consistency,
 * not decision evaluation: the event may describe any allowed outcome, but it
 * cannot name bytes other than the decision and bundle it references.
 */
export async function assertLedgerSourceBindings(
  tx: SqlQueryable,
  tenant: TenantContext,
  event: LedgerEntry,
): Promise<void> {
  assertTenantContext(tenant);
  if (event.firmId !== tenant.orgId) {
    throw appError("AUTH_FAILED", "ledger event tenant does not match source authority");
  }
  const evidence = new Map<string, EvidenceHashes>();
  if (
    event.type === "EvidenceSnapshotRecorded" ||
    (event.type === "StatusObserved" && event.evidenceSnapshotRef)
  ) {
    const id = event.type === "EvidenceSnapshotRecorded"
      ? event.evidenceSnapshotRef.id
      : event.evidenceSnapshotRef!.id;
    const snapshot = await tx.query<EvidenceHashes>(
      `SELECT content_hash, snapshot_hash
         FROM evidence_snapshots
        WHERE org_id = $1 AND id = $2`,
      [event.firmId, id],
    );
    if (snapshot.rows[0]) evidence.set(id, snapshot.rows[0]);
  }
  const decisions = new Map<string, DecisionBinding>();
  const decisionId = referencedDecisionId(event);
  if (decisionId) {
    const hashes = await tx.query<DecisionSourceRow>(
      `SELECT r.decision_hash, b.bundle_hash, r.canonical_json,
              r.schema_version, r.serializer_version
         FROM decision_records r
         JOIN decision_input_bundles b
           ON b.org_id = r.org_id AND b.id = r.input_bundle_id
        WHERE r.org_id = $1 AND r.id = $2`,
      [event.firmId, decisionId],
    );
    if (hashes.rows[0]) {
      decisions.set(decisionId, parseDecisionBinding(hashes.rows[0]));
    }
  }
  const reason = sourceBindingReason(event, evidence, decisions);
  if (reason) throw appError("STORE_CONSTRAINT", reason);
}

export async function verifyStoredLedgerEventAcceptance(
  tx: SqlQueryable,
  tenant: TenantContext,
  entries: readonly SequencedLedgerEvent[],
): Promise<LedgerAcceptanceVerdict> {
  assertTenantContext(tenant);
  for (const { event, sequence } of entries) {
    if (event.firmId !== tenant.orgId) {
      return { ok: false, sequence, reason: "ledger event tenant differs from read authority" };
    }
    try {
      assertLedgerEventPiiBoundary(event);
    } catch {
      return { ok: false, sequence, reason: "ledger event violates the retained PII boundary" };
    }
  }
  if (entries.length === 0) return { ok: true, sequence: null, reason: null };
  const sequences = entries.map(({ sequence }) => sequence);
  const causal = await tx.query<{ sequence: number | string }>(
    `SELECT citing.sequence
       FROM decision_ledger citing
       LEFT JOIN decision_ledger cause
         ON cause.org_id = citing.org_id AND cause.id = citing.causation_id
       LEFT JOIN decision_ledger triggering
         ON triggering.org_id = citing.org_id
        AND triggering.id = citing.triggering_entry_id
      WHERE citing.org_id = $1
        AND citing.sequence = ANY($2::bigint[])
        AND (
          (citing.causation_id IS NOT NULL AND
            (cause.id IS NULL OR cause.sequence >= citing.sequence)) OR
          (citing.triggering_entry_id IS NOT NULL AND
            (triggering.id IS NULL OR triggering.sequence >= citing.sequence))
        )
      ORDER BY citing.sequence ASC
      LIMIT 1`,
    [tenant.orgId, sequences],
  );
  if (causal.rows[0]) {
    return {
      ok: false,
      sequence: Number(causal.rows[0].sequence),
      reason: "ledger causal reference does not name a preceding entry",
    };
  }
  const ordering = await verifyLedgerHistoryOrdering(tx, tenant, entries);
  if (!ordering.ok) return ordering;
  const evidenceIds = [...new Set(entries.flatMap(({ event }) => {
    if (event.type === "EvidenceSnapshotRecorded") {
      return [event.evidenceSnapshotRef.id];
    }
    if (event.type === "StatusObserved" && event.evidenceSnapshotRef) {
      return [event.evidenceSnapshotRef.id];
    }
    return [];
  }))];
  const evidence = new Map<string, EvidenceHashes>();
  if (evidenceIds.length > 0) {
    const rows = await tx.query<EvidenceHashes & { id: string }>(
      `SELECT id, content_hash, snapshot_hash
         FROM evidence_snapshots
        WHERE org_id = $1 AND id = ANY($2::text[])`,
      [tenant.orgId, evidenceIds],
    );
    rows.rows.forEach((row) => evidence.set(row.id, row));
  }
  const decisionIds = [...new Set(entries.flatMap(({ event }) => {
    const id = referencedDecisionId(event);
    return id ? [id] : [];
  }))];
  const decisions = new Map<string, DecisionBinding>();
  if (decisionIds.length > 0) {
    const rows = await tx.query<DecisionSourceRow & { id: string }>(
      `SELECT r.id, r.decision_hash, b.bundle_hash, r.canonical_json,
              r.schema_version, r.serializer_version
         FROM decision_records r
         JOIN decision_input_bundles b
           ON b.org_id = r.org_id AND b.id = r.input_bundle_id
        WHERE r.org_id = $1 AND r.id = ANY($2::text[])`,
      [tenant.orgId, decisionIds],
    );
    rows.rows.forEach((row) =>
      decisions.set(row.id, parseDecisionBinding(row)));
  }
  for (const { event, sequence } of entries) {
    const reason = sourceBindingReason(event, evidence, decisions);
    if (reason) return { ok: false, sequence, reason };
  }
  return { ok: true, sequence: null, reason: null };
}
