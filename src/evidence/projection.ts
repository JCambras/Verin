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
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
// Textual, time-zone-free, locale-free: read from the ISO string's own bytes, never through a Date -
// and the worded form can never collide with the checker's hyphenated account-reference shape.
export function formatObservationDate(isoInstant: string): string {
  const [year, month, day] = isoInstant.slice(0, 10).split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}
