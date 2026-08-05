import type { SqlQueryable } from "@infra/store/db";
import { appError } from "@contracts/errors";
import {
  assertTenantContext,
  type TenantContext,
} from "@contracts/tenant";
import type { LedgerEntry } from "@contracts/decision-core/ledger";
import { assertLedgerEventPiiBoundary } from "./ledger-pii";

interface DecisionHashes {
  decision_hash: string;
  bundle_hash: string;
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

function referencedDecisionId(event: LedgerEntry): string | undefined {
  if ("decisionRef" in event) return event.decisionRef.id;
  if ("priorDecisionRef" in event) return event.priorDecisionRef.id;
  return undefined;
}

function sourceBindingReason(
  event: LedgerEntry,
  evidence: ReadonlyMap<string, EvidenceHashes>,
  decisions: ReadonlyMap<string, DecisionHashes>,
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
  const claimedDecisionHash =
    event.type === "DecisionRecorded" || event.type === "ApprovalRecorded"
      ? event.decisionHash
      : "priorDecisionHash" in event
        ? event.priorDecisionHash
        : undefined;
  if (
    claimedDecisionHash !== undefined &&
    claimedDecisionHash !== stored.decision_hash
  ) return "ledger event decision hash does not match immutable record";
  if (
    (event.type === "ApprovalRecorded" &&
      event.inputBundleHash !== stored.bundle_hash) ||
    (event.type === "DecisionRecorded" &&
      event.bundleHash !== stored.bundle_hash)
  ) return "ledger input bundle hash does not match immutable bundle";
  return null;
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
  const decisions = new Map<string, DecisionHashes>();
  const decisionId = referencedDecisionId(event);
  if (decisionId) {
    const hashes = await tx.query<DecisionHashes>(
      `SELECT r.decision_hash, b.bundle_hash
         FROM decision_records r
         JOIN decision_input_bundles b
           ON b.org_id = r.org_id AND b.id = r.input_bundle_id
        WHERE r.org_id = $1 AND r.id = $2`,
      [event.firmId, decisionId],
    );
    if (hashes.rows[0]) decisions.set(decisionId, hashes.rows[0]);
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
  const decisions = new Map<string, DecisionHashes>();
  if (decisionIds.length > 0) {
    const rows = await tx.query<DecisionHashes & { id: string }>(
      `SELECT r.id, r.decision_hash, b.bundle_hash
         FROM decision_records r
         JOIN decision_input_bundles b
           ON b.org_id = r.org_id AND b.id = r.input_bundle_id
        WHERE r.org_id = $1 AND r.id = ANY($2::text[])`,
      [tenant.orgId, decisionIds],
    );
    rows.rows.forEach((row) => decisions.set(row.id, row));
  }
  for (const { event, sequence } of entries) {
    const reason = sourceBindingReason(event, evidence, decisions);
    if (reason) return { ok: false, sequence, reason };
  }
  return { ok: true, sequence: null, reason: null };
}
