import { type NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  getDb,
  requireActionGrant,
} from "@app/_server/context";
import { readVerifiedDecisionRegister } from "@infra/ledger/ledger-register";
import {
  canFeedComplianceDecision,
  DEV_BADGE_TEXT,
  parseRecordProvenance,
  type DerivedProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
import { metric } from "@contracts/metric";
import { appError } from "@contracts/errors";
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
  const provenance = parseRecordProvenance({
    source: row.provSource,
    asOf: row.provAsOf,
    confidence: row.provConfidence,
  });
  if (!provenance) {
    throw appError("STORE_CONSTRAINT", "verified ledger provenance is invalid");
  }
  return provenance;
}

/** Read-only, tenant-scoped register. No decision state is computed here. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireActionGrant(req, "audit.export");
  if (!auth.ok) return errorResponse(auth.error);
  const pii = await requireActionGrant(req, "pii.view");
  if (!pii.ok) return errorResponse(pii.error);
  const db = await getDb();
  const {
    verification,
    rows,
    decisions,
    decisionsTotal,
    decisionsWithheld,
    decisionsWithheldProvenance,
  } = await readVerifiedDecisionRegister(
    db,
    auth.value,
    pii.value,
    MAX_ENTRIES,
    MAX_DECISIONS,
  );
  const body = {
    verification: {
      ok: verification.ok,
      entriesChecked: verification.entriesChecked,
      entriesStored: verification.entriesStored,
      levels: verification.levels,
    },
    total: verification.entriesStored,
    decisionsTotal,
    decisionsWithheld: decisionsWithheldProvenance
      ? metric(decisionsWithheld, "count", decisionsWithheldProvenance)
      : null,
    decisions: decisions.map(({ projection, provenance }) => ({
      decisionId: projection.decisionId,
      disposition: projection.disposition,
      approvalMode: projection.approvalMode,
      approvalStages: projection.approvalStages.map((stage) => ({
        stageId: stage.stageId,
        status: stage.status,
      })),
      activeReservations: metric(
        projection.reservations.filter(
          (reservation) => reservation.status === "active",
        ).length,
        "count",
        provenance,
      ),
      executionSteps: metric(
        projection.executionSteps.length,
        "count",
        provenance,
      ),
      exceptionRequested: projection.exceptionRequested,
      lastEventType: projection.lastEventType,
      lastSequence: projection.lastSequence,
      provenanceLabel: badgeLabel(provenance),
    })),
    entries: [...rows].reverse().map((row) => ({
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
