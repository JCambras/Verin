import { type NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  getDb,
  requirePrincipalWithRole,
} from "@app/_server/context";
import { verifyAndListDecisionLedger } from "@infra/ledger/ledger-verification";
import { listDecisionProjections } from "@infra/ledger/ledger-projection-store";
import {
  DEV_BADGE_TEXT,
  isSyntheticSource,
  type SourceSystem,
} from "@contracts/provenance";
import type { LedgerRegisterViewModel } from "@app/ledger/model";

export const runtime = "nodejs";
const MAX_ENTRIES = 200;

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
 */
function badgeLabel(source: string): string | null {
  return isSyntheticSource(source as SourceSystem)
    ? DEV_BADGE_TEXT["synthetic-fixture"]
    : null;
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
  const decisions = await listDecisionProjections(db, principal.value.orgId);
  const body = {
    verification: {
      ok: verification.ok,
      entriesChecked: verification.entriesChecked,
      entriesStored: verification.entriesStored,
      levels: verification.levels,
    },
    total: verification.entriesStored,
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
      provenanceLabel: badgeLabel(provenance.source),
    })),
    entries: rows.slice(-MAX_ENTRIES).reverse().map((row) => ({
      sequence: row.sequence,
      occurredAt: row.occurredAt,
      eventType: row.eventType,
      actor: actorLabel(row.actorJson),
      correlationId: row.correlationId,
      decisionId: row.decisionId,
      entryHash: row.entryHash.slice(0, 16),
      provenanceLabel: badgeLabel(row.provSource),
    })),
  } satisfies LedgerRegisterViewModel;
  return NextResponse.json(body);
}
