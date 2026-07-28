import { type NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  getDb,
  requirePrincipalWithRole,
} from "@app/_server/context";
import { verifyAndListDecisionLedger } from "@infra/ledger/ledger-verification";
import {
  countDecisionProjections,
  listDecisionProjections,
} from "@infra/ledger/ledger-projection-store";
import {
  canFeedComplianceDecision,
  DEV_BADGE_TEXT,
  type Confidence,
  type DerivedProvenance,
  type RecordProvenance,
  type SourceSystem,
} from "@contracts/provenance";
import type { LedgerRegisterViewModel } from "@app/ledger/model";

export const runtime = "nodejs";
const MAX_ENTRIES = 200;
const MAX_DECISIONS = 50;

function actorLabel(actorJson: string): string {
  try {
    const actor = JSON.parse(actorJson) as {
      actorId?: unknown;
      systemId?: unknown;
    };
    if (typeof actor.actorId === "string") return actor.actorId;
    return typeof actor.systemId === "string" ? actor.systemId : "unknown";
  } catch {
    return "invalid actor metadata";
  }
}

/**
 * Provenance is read from the row the producer wrote, never inferred from an actor
 * name, so a renamed seed or a new synthetic producer cannot render as real history.
 * Derived state carries the trust of its least trustworthy input (ADR-0022), so the
 * same test labels a single row and a whole fold.
 */
function badgeLabel(provenance: RecordProvenance | DerivedProvenance): string | null {
  return canFeedComplianceDecision(provenance)
    ? null
    : DEV_BADGE_TEXT["synthetic-fixture"];
}

function rowProvenance(row: {
  provSource: string;
  provAsOf: string;
  provConfidence: string;
}): RecordProvenance {
  return {
    source: row.provSource as SourceSystem,
    asOf: row.provAsOf,
    confidence: row.provConfidence as Confidence,
  };
}

/** Read-only, tenant-scoped register. No decision state is computed here. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const principal = await requirePrincipalWithRole(
    req,
    ["ops", "cco", "principal", "admin"],
  );
  if (!principal.ok) return errorResponse(principal.error);
  const db = await getDb();
  const { verification, rows } = await verifyAndListDecisionLedger(
    db,
    principal.value.orgId,
    MAX_ENTRIES,
  );
  const decisions = await listDecisionProjections(
    db,
    principal.value.orgId,
    MAX_DECISIONS,
  );
  const decisionsTotal = await countDecisionProjections(db, principal.value.orgId);
  const body = {
    verification: {
      ok: verification.ok,
      entriesChecked: verification.entriesChecked,
      entriesStored: verification.entriesStored,
      levels: verification.levels,
    },
    total: verification.entriesStored,
    decisionsTotal,
    decisions: decisions.map(({ projection, provenance }) => ({
      decisionId: projection.decisionId,
      disposition: projection.disposition,
      approvalMode: projection.approvalMode,
      approvalStages: projection.approvalStages.map((stage) => ({
        stageId: stage.stageId,
        status: stage.status,
      })),
      activeReservations: projection.reservations.filter(
        (reservation) => reservation.status === "active",
      ).length,
      executionSteps: projection.executionSteps.length,
      exceptionRequested: projection.exceptionRequested,
      lastEventType: projection.lastEventType,
      lastSequence: projection.lastSequence,
      provenanceLabel: badgeLabel(provenance),
    })),
    entries: rows.slice(-MAX_ENTRIES).reverse().map((row) => ({
      sequence: row.sequence,
      occurredAt: row.occurredAt,
      eventType: row.eventType,
      actor: actorLabel(row.actorJson),
      correlationId: row.correlationId,
      decisionId: row.decisionId,
      entryHash: row.entryHash.slice(0, 16),
      provenanceLabel: badgeLabel(rowProvenance(row)),
    })),
  } satisfies LedgerRegisterViewModel;
  return NextResponse.json(body);
}
