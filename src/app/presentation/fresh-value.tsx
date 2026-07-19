"use client";

/**
 * FreshValue — freshness-as-provenance (ADR-0012; Meridian FreshValue + freshness).
 * Renders a value with its source/asOf label; stale data visibly recedes (opacity
 * by age). Every displayed sourced value gets its provenance (charter #3). Ships
 * LIVE; pervasive usage grows flow-by-flow.
 */
import type { ReactNode } from "react";
import { type RecordProvenance, provenanceLabel } from "@contracts/provenance";

// Stale data visibly recedes, but never below the WCAG 1.4.3 contrast floor (Wren
// W2): opacity is floored at 0.7 so faded slate-900 text stays >= 4.5:1 on white.
function opacityForAge(asOf: string): number {
  const ageMs = Date.now() - new Date(asOf).getTime();
  const days = ageMs / 86_400_000;
  if (days < 1) return 1;
  if (days < 7) return 0.9;
  if (days < 21) return 0.8;
  return 0.7;
}

export function FreshValue({ provenance, children }: { provenance: RecordProvenance; children: ReactNode }) {
  const label = provenanceLabel(provenance);
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span style={{ opacity: opacityForAge(provenance.asOf), transition: "opacity 150ms ease" }} title={label}>
        {children}
      </span>
      <span className="text-xs text-slate-600">· {label}</span>
    </span>
  );
}
