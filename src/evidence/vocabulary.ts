// The observation vocabulary (prompt 3 deliverable 2): a closed union owned by this one module - the
// assembly refuses a stored kind, origin or reason outside these lists, and adding one is a version
// bump, never a quiet widening. It also owns the closed freshness classification and its thresholds,
// so the assembly's band IS the surface's band and the two can never disagree about what stale means
// (DC-5: main:src/contracts/decision-core/evidence.ts:44-47; main:src/domain/world/household-world.ts:279-292).
// 1.1.0 (prompt 5 deliverable 5A.5): adds exactly the classes the decision rules read - planned
// withdrawals, pending actions, household instruction, regulatory status, household directory. The
// ratified enumeration named three; the signed truth forces five: without pending-actions GC-11's
// BINDING disposition comes out wrong (85000 >= 48000 reads proceed), and without
// household-directory GC-08's blocker has no evidence to fire on. Recorded loudly in PR-5a's body.
export const OBSERVATION_VOCABULARY_VERSION = "1.1.0";
export const OBSERVATION_KINDS = [
  "people",
  "account-balance",
  "bank-instruction",
  "beneficiary-designation",
  "planned-withdrawals",
  "pending-actions",
  "household-instruction",
  "regulatory-status",
  "household-directory",
] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

// The PII classification per kind - a hierarchy of closed labels, never a numeric AI score.
export const KIND_PII_CLASS: Record<ObservationKind, "personal-identity" | "masked-financial-reference"> = {
  people: "personal-identity",
  "account-balance": "masked-financial-reference",
  "bank-instruction": "masked-financial-reference",
  "beneficiary-designation": "personal-identity",
  "planned-withdrawals": "masked-financial-reference",
  "pending-actions": "masked-financial-reference",
  "household-instruction": "masked-financial-reference",
  "regulatory-status": "masked-financial-reference",
  "household-directory": "personal-identity",
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
export const OBSERVATION_ORIGINS = ["demo-seed", "synthetic-fixture"] as const;
export type ObservationOrigin = (typeof OBSERVATION_ORIGINS)[number];
// Both origins are demonstrations and every surface watermarks them; 'synthetic-fixture' exists for
// the signed-case reader's constructed bundles and never names a store row (charter #3).
export const DEMONSTRATION_ORIGINS: readonly ObservationOrigin[] = ["demo-seed", "synthetic-fixture"];
// The deadline configuration constant this slice owns; the route boundary mints from it exactly once.
export const EVIDENCE_ASSEMBLY_DEADLINE_MS = 2_000;
