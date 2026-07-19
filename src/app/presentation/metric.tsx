"use client";

/**
 * Metric — the sanctioned metric-class UI surface (charter #3; ADR-0022; closes
 * Vale V12). Renders a `DisplayMetric`'s formatted value with its source/asOf
 * provenance label (via FreshValue, so freshness/staleness apply too), plus the
 * "Demonstration - not a compliance record" watermark when the metric was derived
 * from synthetic input.
 *
 * A metric cannot be rendered here without provenance: the prop IS a `DisplayMetric`,
 * which the type system forbids constructing without one. Rendering a metric field
 * any other way (extracting `.value` into naked JSX) is caught by the
 * metric-provenance fence — together they close the displayed-metric->source trace.
 */
import { type DisplayMetric, formatMetricValue, metricWatermark } from "@contracts/metric";
import { FreshValue } from "./fresh-value";

export function Metric({ metric }: { metric: DisplayMetric }) {
  const watermark = metricWatermark(metric);
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <FreshValue provenance={metric.provenance}>
        <span className="font-semibold tabular-nums text-slate-900">{formatMetricValue(metric)}</span>
      </FreshValue>
      {watermark ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900" data-testid="metric-watermark">
          {watermark}
        </span>
      ) : null}
    </span>
  );
}
