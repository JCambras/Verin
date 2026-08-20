// The provenance-carrying metric component (prompt 2 5B.4; oracle characterization:
// main:src/contracts/metric.ts and main:src/app/presentation/metric.tsx - a metric cannot exist
// without provenance, and a figure derived from any demonstration input is watermarked, never clean).
// Every displayed figure in generation-4 renders through this component; a naked figure is the
// defect rule E7 exists to catch.
type Metric = { label: string; value: string; source: string; asOf: Date; demonstration: boolean };

export function DisplayMetric({ metric }: { metric: Metric }) {
  return (
    <div className="metric">
      <span className="meta">{metric.label}</span>
      <span className="metric-value">{metric.value}</span>
      <span className="meta">
        {metric.source} · as of {metric.asOf.toISOString().slice(0, 10)}
      </span>
      {metric.demonstration ? <span className="badge-demo">demonstration - not a compliance record</span> : null}
    </div>
  );
}
