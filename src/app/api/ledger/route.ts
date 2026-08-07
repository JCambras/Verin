import { type NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  getDb,
  requireActionGrant,
} from "@app/_server/context";
import { readVerifiedDecisionRegister } from "@infra/ledger/ledger-register";
import {
  parseRecordProvenance,
  syntheticBadgeLabel,
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
 * `syntheticBadgeLabel` then reports THAT row's own class - an estimate as an
 * estimate - rather than the one synthetic class the register happened to ship with.
 */
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
    storedProvenance,
    decisions,
    decisionsTotal,
    decisionsTotalProvenance,
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
      levels: verification.levels.map((entry) => ({
        level: entry.level,
        ok: entry.ok,
        entriesChecked: entry.entriesChecked,
        reason: entry.reason,
      })),
    },
    total: storedProvenance
      ? metric(verification.entriesStored, "count", storedProvenance)
      : null,
    decisionsTotal: decisionsTotalProvenance
      ? metric(decisionsTotal, "count", decisionsTotalProvenance)
      : null,
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
      provenanceLabel: syntheticBadgeLabel(provenance),
    })),
    entries: [...rows].reverse().map((row) => ({
      sequence: row.sequence,
      occurredAt: row.occurredAt,
      eventType: row.eventType,
      actor: actorLabel(row.actorJson),
      decisionId: row.decisionId,
      entryHash: row.entryHash.slice(0, 16),
      provenanceLabel: syntheticBadgeLabel(rowProvenance(row)),
    })),
  } satisfies LedgerRegisterViewModel;
  return NextResponse.json(body);
}
