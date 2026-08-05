import { POST_REVIEW_BANK_EVIDENCE_WITHHELD } from "./build-safety-check";
import type { SignedCaseId } from "./signed-case-types";

export const SIGNED_AUTHORITY_GAP_TYPES = [
  "canonical-utc-instants",
  "evidence-completeness",
  "structured-money",
  "approval-event-bindings",
  "pre-execution-chronology",
  "verification-detail",
] as const;

export type SignedAuthorityGapType =
  (typeof SIGNED_AUTHORITY_GAP_TYPES)[number];

export interface SignedAuthorityGap {
  readonly caseId: SignedCaseId;
  readonly signedAt: string;
  readonly requiredSince: string;
  readonly status: "awaiting-captain-signature";
  readonly execution: "withheld";
  readonly reason: string;
  readonly missingAuthorities: readonly SignedAuthorityGapType[];
}

export const SIGNED_AUTHORITY_GAPS = [
  {
    caseId: "GC-03-recent-bank-change-firm-a",
    signedAt: "2026-07-26",
    requiredSince: "2026-07-28",
    status: "awaiting-captain-signature",
    execution: "withheld",
    reason: POST_REVIEW_BANK_EVIDENCE_WITHHELD,
    missingAuthorities: SIGNED_AUTHORITY_GAP_TYPES,
  },
] as const satisfies readonly SignedAuthorityGap[];

export function signedAuthorityGapFor(
  caseId: SignedCaseId,
): SignedAuthorityGap | null {
  return SIGNED_AUTHORITY_GAPS.find((gap) => gap.caseId === caseId) ?? null;
}
