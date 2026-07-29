import {
  canFeedComplianceDecision,
  DEV_BADGE_TEXT,
  parseRecordProvenance,
} from "@contracts/provenance";

export const UNTRUSTED_PROVENANCE_LABEL = "untrusted provenance";

export function ledgerRowProvenanceLabel(value: unknown): string | null {
  const provenance = parseRecordProvenance(value);
  if (!provenance) return UNTRUSTED_PROVENANCE_LABEL;
  return canFeedComplianceDecision(provenance)
    ? null
    : DEV_BADGE_TEXT["synthetic-fixture"];
}
