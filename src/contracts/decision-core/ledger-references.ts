import type { LedgerEntry } from "./ledger";

/**
 * Promoted-column projections. Storage, verification, and projection all read a
 * reference out of an event through THESE functions, so the writer and the verifier
 * cannot drift apart: L3 stays a real comparison of stored column against canonical
 * payload rather than of two independently maintained transcriptions.
 */
export function promotedDecisionRef(
  event: LedgerEntry,
): { readonly firmId: string; readonly id: string } | null {
  if ("decisionRef" in event) return event.decisionRef;
  if ("priorDecisionRef" in event) return event.priorDecisionRef;
  return null;
}

export function promotedDecisionId(event: LedgerEntry): string | null {
  return promotedDecisionRef(event)?.id ?? null;
}

export function promotedEvidenceSnapshotId(event: LedgerEntry): string | null {
  if (event.type === "EvidenceSnapshotRecorded") {
    return event.evidenceSnapshotRef.id;
  }
  if (event.type === "StatusObserved") {
    return event.evidenceSnapshotRef?.id ?? null;
  }
  return null;
}

export function promotedTriggeringEntryId(event: LedgerEntry): string | null {
  return event.type === "ExceptionDecisionRequested"
    ? event.triggeringEntryRef.id
    : null;
}

export function promotedReservationCreationId(event: LedgerEntry): string | null {
  return event.type === "ReservationReleased"
    ? event.reservationCreationRef.id
    : null;
}
