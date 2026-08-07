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
// The floor alone does NOT carry that guarantee, because the faded span inherits
// the CALLER's color: the same fade over a `text-slate-600` meta line on
// `bg-surface` lands at 4.34:1 by 12 days of age and 3.47:1 past 21 (the demo's
// fixed asOf dates age against the real clock, so every surface reaches the floor
// eventually). Receded content therefore owns the established receded color
// (design §12.1's slate-800, as record.tsx's voided rows already do), which clears
// 4.5:1 at the 0.7 floor on white, `bg-surface`, and `amber-50` alike. Fresh values
// still inherit, so nothing changes until the value actually recedes. Enforced by
// the blocking axe scan of every demo surface (e2e/demo-journey.spec.ts).
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
  const opacity = opacityForAge(provenance.asOf);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className={opacity < 1 ? "text-slate-800" : undefined} style={{ opacity, transition: "opacity 150ms ease" }} title={label}>
        {children}
      </span>
      <span className="whitespace-nowrap text-xs text-slate-600">· {label}</span>
    </span>
  );
}
