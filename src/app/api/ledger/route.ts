import { type NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  getDb,
  requirePrincipalWithRole,
} from "@app/_server/context";
import { readVerifiedDecisionRegister } from "@infra/ledger/ledger-register";
import { tenantOf } from "@contracts/tenant";
import {
  canFeedComplianceDecision,
  DEV_BADGE_TEXT,
  deriveArtifactProvenance,
  type DerivedProvenance,
  type RecordProvenance,
} from "@contracts/provenance";
import type { LedgerRegisterViewModel } from "@app/ledger/model";
import { UNTRUSTED_PROVENANCE_LABEL } from "@app/ledger/provenance";
import { metric } from "@contracts/metric";

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

function countObservationProvenance(
  inputs: readonly RecordProvenance[],
  observedAt: string,
  complete: boolean,
): DerivedProvenance {
  const provenances = complete
    ? inputs.length > 0
      ? inputs
      : [{
          source: "verin-crm",
          asOf: observedAt,
          confidence: "high",
        } as const]
    : [{
        source: "default",
        asOf: observedAt,
        confidence: "low",
      } as const];
  return deriveArtifactProvenance(provenances, observedAt);
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
    rowProvenance = new Map(),
    replaySourceReason,
  } = await readVerifiedDecisionRegister(
    db,
    tenantOf(principal.value),
    MAX_ENTRIES,
    MAX_DECISIONS,
  );
  const trusted = verification.ok;
  const observedAt = new Date().toISOString();
  const visibleDecisions = trusted ? decisions : [];
  const visibleEntries = trusted
    ? rows.slice(-MAX_ENTRIES).reverse()
    : [];
  const visibleEntryProvenance = visibleEntries.flatMap((row) => {
    const provenance = rowProvenance.get(row.id);
    return provenance ? [provenance] : [];
  });
  const visibleDecisionProvenance = visibleDecisions.map(
    ({ provenance }) => provenance,
  );
  const verificationProvenance = countObservationProvenance(
    [...rowProvenance.values()],
    observedAt,
    trusted && rowProvenance.size === verification.entriesChecked,
  );
  const eventsTotalProvenance = countObservationProvenance(
    [...rowProvenance.values()],
    observedAt,
    trusted && rowProvenance.size === verification.entriesStored,
  );
  const eventsShownProvenance = countObservationProvenance(
    visibleEntryProvenance,
    observedAt,
    trusted && visibleEntryProvenance.length === visibleEntries.length,
  );
  const decisionsTotalProvenance = countObservationProvenance(
    visibleDecisionProvenance,
    observedAt,
    trusted && visibleDecisions.length === decisionsTotal,
  );
  const decisionsShownProvenance = countObservationProvenance(
    visibleDecisionProvenance,
    observedAt,
    trusted,
  );
  const body = {
    verification: {
      ok: verification.ok,
      entriesCheckedMetric: metric(
        verification.entriesChecked,
        "count",
        verificationProvenance,
      ),
      levels: verification.levels.map((level) => ({
        level: level.level,
        ok: level.ok,
        entriesCheckedMetric: metric(
          level.entriesChecked,
          "count",
          verificationProvenance,
        ),
        reason: level.reason,
      })),
      replaySourceReason,
    },
    eventsTotalMetric: metric(
      verification.entriesStored,
      "count",
      eventsTotalProvenance,
    ),
    eventsShownMetric: metric(
      visibleEntries.length,
      "count",
      eventsShownProvenance,
    ),
    decisionsTotalMetric: metric(
      trusted ? decisionsTotal : 0,
      "count",
      decisionsTotalProvenance,
    ),
    decisionsShownMetric: metric(
      visibleDecisions.length,
      "count",
      decisionsShownProvenance,
    ),
    verificationWindowed:
      verification.entriesChecked < verification.entriesStored,
    eventsWindowTruncated:
      verification.entriesStored > visibleEntries.length,
    decisionsWindowTruncated:
      trusted && decisionsTotal > visibleDecisions.length,
    decisions: visibleDecisions.map(({ projection, provenance }) => ({
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
    entries: visibleEntries.map((row) => ({
      sequence: row.sequence,
      occurredAt: row.occurredAt,
      eventType: row.eventType,
      actor: actorLabel(row.actorJson),
      correlationId: row.correlationId,
      decisionId: row.decisionId,
      entryHash: row.entryHash.slice(0, 16),
      provenanceLabel: rowProvenance.has(row.id)
        ? badgeLabel(rowProvenance.get(row.id)!)
        : UNTRUSTED_PROVENANCE_LABEL,
    })),
  } satisfies LedgerRegisterViewModel;
  return NextResponse.json(body);
}
