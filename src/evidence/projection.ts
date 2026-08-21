// The trusted-static-projection module - the ONE declared member of the outbound-projection module
// set (OUTBOUND_PROJECTION_MODULES, src/evidence/pii.ts), empty of LLM callers until a later slice
// lands one. Every string here is a reviewed static template keyed by the closed vocabulary; nothing
// here may transitively import a PII-bearing type or value - the containment rule in
// src/tools/e16.test.ts fails the build if one arrives (DC-5: main:src/infrastructure/pii/llm-projection.ts:1-13).
import type { ObservationKind } from "./vocabulary";

export const KIND_LABELS: Record<ObservationKind, string> = {
  people: "People",
  "account-balance": "Account balance",
  "bank-instruction": "Bank instruction",
  "beneficiary-designation": "Beneficiary designation",
  "planned-withdrawals": "Planned withdrawals",
  "pending-actions": "Pending actions",
  "household-instruction": "Household instruction",
  "regulatory-status": "Regulatory status",
  "household-directory": "Household directory",
};
// The missing-item presentation's real next step, per kind (deliverable 4, PR-3b; 1.1.0 in PR-5a).
export const KIND_NEXT_STEPS: Record<ObservationKind, string> = {
  people: "Record the household's members in the house record store to put its people on evidence.",
  "account-balance": "Record a custodial balance in the house record store to put an account balance on evidence.",
  "bank-instruction": "Record a standing bank instruction in the house record store before any movement relies on one.",
  "beneficiary-designation": "Record each account's beneficiary designation in the house record store to close this gap.",
  "planned-withdrawals": "Record the household's planned withdrawal schedule so a cash-reserve computation has evidence to stand on.",
  "pending-actions": "Record the household's pending approved activity so effective liquidity reads whole, not just the raw balance.",
  "household-instruction": "Record the household's standing instructions so every decision honors its mandates.",
  "regulatory-status": "Record the household's regulatory standing so a hold is never discovered after a movement starts.",
  "household-directory": "Record the directory resolution for this household so a request can bind to it unambiguously.",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
// Textual, time-zone-free, locale-free: read from the ISO string's own bytes, never through a Date -
// and the worded form can never collide with the checker's hyphenated account-reference shape.
export function formatObservationDate(isoInstant: string): string {
  const [year, month, day] = isoInstant.slice(0, 10).split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}
