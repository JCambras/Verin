// The observation vocabulary (prompt 3 deliverable 2): a closed union owned by this one module - the
// assembly refuses a stored kind, origin or reason outside these lists, and adding one is a version
// bump, never a quiet widening. It also owns the closed freshness classification and its thresholds,
// so the assembly's band IS the surface's band and the two can never disagree about what stale means
// (DC-5: main:src/contracts/decision-core/evidence.ts:44-47; main:src/domain/world/household-world.ts:279-292).
export const OBSERVATION_VOCABULARY_VERSION = "1.0.0";
export const OBSERVATION_KINDS = ["people", "account-balance", "bank-instruction", "beneficiary-designation"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

// The PII classification per kind - a hierarchy of closed labels, never a numeric AI score.
export const KIND_PII_CLASS: Record<ObservationKind, "personal-identity" | "masked-financial-reference"> = {
  people: "personal-identity",
  "account-balance": "masked-financial-reference",
  "bank-instruction": "masked-financial-reference",
  "beneficiary-designation": "personal-identity",
};

export const FRESHNESS_BANDS = ["fresh", "aging", "stale"] as const;
export type FreshnessBand = (typeof FRESHNESS_BANDS)[number];
export const FRESHNESS_THRESHOLDS = { agingAfterDays: 30, staleAfterDays: 90 } as const;
export function freshnessBand(asOf: string, observedAt: string): FreshnessBand {
  const days = Math.floor((Date.parse(asOf) - Date.parse(observedAt)) / 86_400_000);
  return days > FRESHNESS_THRESHOLDS.staleAfterDays ? "stale" : days > FRESHNESS_THRESHOLDS.agingAfterDays ? "aging" : "fresh";
}

export const ABSENCE_REASONS = ["no-observation-in-house-records"] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];
export const EVIDENCE_SOURCE = "house-record-store"; // the ONE source; a second is stop condition 6
export const OBSERVATION_ORIGINS = ["demo-seed"] as const;
export type ObservationOrigin = (typeof OBSERVATION_ORIGINS)[number];
// The deadline configuration constant this slice owns; the route boundary mints from it exactly once.
export const EVIDENCE_ASSEMBLY_DEADLINE_MS = 2_000;
