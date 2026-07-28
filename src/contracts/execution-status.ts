/** Canonical external statuses and the two non-status timeline planes approved
 * by the captain on 2026-07-28. Presentation labels never create new states. */
export const OBSERVED_STATUS_IDS = [
  "submitted",
  "in-flight",
  "completed",
  "rejected",
  "nigo",
  "unknown",
] as const;
export type ObservedStatusId = (typeof OBSERVED_STATUS_IDS)[number];

export const VERIFICATION_PROJECTION_IDS = ["stuck"] as const;
export type VerificationProjectionId = (typeof VERIFICATION_PROJECTION_IDS)[number];

export const EXECUTION_RECEIPT_IDS = ["duplicate-suppressed"] as const;
export type ExecutionReceiptId = (typeof EXECUTION_RECEIPT_IDS)[number];
