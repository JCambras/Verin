/**
 * EvidenceRow and its conflict/missing variants (design language §6.1-§6.3) - a
 * COMPOSITION of FreshValue / Metric with the observed-vs-retrieved distinction:
 * `asOf` is the observed time (freshness keys off it); the retrieved time is a
 * trailing metadata suffix. Conflicts render BOTH values and name the survivorship
 * rule; a value Verin cannot source renders as an explicit data-gap row (silent
 * omission is the failure mode this idiom exists to kill).
 */
import type { ReactNode } from "react";
import type { DisplayMetric } from "@contracts/metric";
import { provenanceLabel, type RecordProvenance } from "@contracts/provenance";
import { FreshValue } from "./fresh-value";
import { Metric } from "./metric";
import { StatusBadge } from "./ui";
import { DevProvenanceBadge } from "./dev-provenance-badge";

export interface EvidenceFact {
  readonly display: string;
  readonly provenance: RecordProvenance;
  readonly retrievedAt: string;
}

function Retrieved({ at }: { at: string }) {
  return <span className="text-xs text-slate-500">retrieved {at}</span>;
}

export function EvidenceRow({
  label,
  fact,
  badgeLabel,
  children,
}: {
  label?: string;
  fact: EvidenceFact;
  badgeLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-2">
      {label ? <p className="text-xs text-slate-600">{label}</p> : null}
      <p className="text-sm text-slate-800">
        <FreshValue provenance={fact.provenance} showLabel={false}>{fact.display}</FreshValue>
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-slate-600">
        <span>{provenanceLabel(fact.provenance)}</span>
        <Retrieved at={fact.retrievedAt} />
        {badgeLabel ? <DevProvenanceBadge label={badgeLabel} /> : null}
      </p>
      {children}
    </div>
  );
}

export function EvidenceMetricRow({
  label,
  metric,
  retrievedAt,
  badgeLabel,
  children,
}: {
  label: string;
  metric: DisplayMetric;
  retrievedAt: string;
  badgeLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <Metric metric={metric} />
        <Retrieved at={retrievedAt} />
        {badgeLabel ? <DevProvenanceBadge label={badgeLabel} /> : null}
      </p>
      {children}
    </div>
  );
}

/** Two sources disagree: render BOTH values in full and name the rule in play. */
export function EvidenceConflict({
  label,
  rule,
  a,
  b,
  badgeLabel,
  affordance,
}: {
  label: string;
  rule: string;
  a: EvidenceFact;
  b: EvidenceFact;
  badgeLabel?: string;
  affordance?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-2" data-testid="evidence-conflict">
      <p className="flex items-center gap-2 text-xs text-slate-600">
        <StatusBadge status="conflict" label="Conflict" />
        {label}
      </p>
      <EvidenceRow fact={a} badgeLabel={badgeLabel} />
      <EvidenceRow fact={b} badgeLabel={badgeLabel} />
      <p className="text-sm text-slate-600">Resolution rule: {rule}</p>
      {affordance}
    </div>
  );
}

/** The explicit data-gap row (EmptyState idiom at row scale). */
export function EvidenceMissing({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600" data-testid="evidence-missing">
      {text}
    </p>
  );
}
