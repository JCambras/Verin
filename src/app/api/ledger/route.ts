import { type NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  getDb,
  requirePrincipalWithRole,
} from "@app/_server/context";
import { readVerifiedDecisionRegister } from "@infra/ledger/ledger-register";
import {
  canFeedComplianceDecision,
  DEV_BADGE_TEXT,
  type DerivedProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
import type { LedgerRegisterViewModel } from "@app/ledger/model";
import { ledgerRowProvenanceLabel } from "@app/ledger/provenance";

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

/** Read-only, tenant-scoped register. No decision state is computed here. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const principal = await requirePrincipalWithRole(
    req,
    ["ops", "cco", "principal", "admin"],
  );
  if (!principal.ok) return errorResponse(principal.error);
  const db = await getDb();
  const {
    verification,
    rows,
    decisions,
    decisionsTotal,
    replaySourceReason,
  } = await readVerifiedDecisionRegister(
    db,
    principal.value.orgId,
    MAX_ENTRIES,
    MAX_DECISIONS,
  );
  const trusted = verification.ok;
  const body = {
    verification: {
      ok: verification.ok,
      entriesChecked: verification.entriesChecked,
      entriesStored: verification.entriesStored,
      levels: verification.levels,
      replaySourceReason,
    },
    total: verification.entriesStored,
    decisionsTotal: trusted ? decisionsTotal : 0,
    decisions: (trusted ? decisions : []).map(({ projection, provenance }) => ({
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
    entries: (trusted ? rows : []).slice(-MAX_ENTRIES).reverse().map((row) => ({
      sequence: row.sequence,
      occurredAt: row.occurredAt,
      eventType: row.eventType,
      actor: actorLabel(row.actorJson),
      correlationId: row.correlationId,
      decisionId: row.decisionId,
      entryHash: row.entryHash.slice(0, 16),
      provenanceLabel: ledgerRowProvenanceLabel({
        source: row.provSource,
        asOf: row.provAsOf,
        confidence: row.provConfidence,
      }),
    })),
  } satisfies LedgerRegisterViewModel;
  return NextResponse.json(body);
}
