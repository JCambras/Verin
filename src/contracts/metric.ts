/**
 * Displayed-metric vocabulary (charter #3; ADR-0022; closes Vale V12 — the
 * displayed-metric->source provenance trace). A `DisplayMetric` binds a
 * numeric/derived value (a health score, a balance, a count) to its provenance and
 * a display format. It is the ONLY shape a "metric-class" UI surface renders:
 *
 *  - TYPE-SYSTEM HALF: a `DisplayMetric` cannot be constructed without provenance,
 *    and it is deliberately NOT a `ReactNode` — React cannot render the object, so a
 *    metric can only reach the screen through `<Metric>` (which requires the
 *    provenance). Extracting `.value` to render it naked is exactly what the
 *    metric-provenance fence catches.
 *  - CI-TRACE HALF: the metric-provenance fence (run in the `provenance-trace` CI
 *    job) fails the build on any metric field rendered without going through a
 *    sanctioned provenance-carrying surface, so every displayed metric traces to a
 *    source/asOf.
 *
 * Dependency-free (contracts layer): imports only sibling provenance vocabulary.
 */
import { type RecordProvenance, type DerivedProvenance, isDemonstration, DEMO_WATERMARK } from "./provenance";

export const METRIC_FORMATS = ["currency-minor", "score", "percent", "count", "plain"] as const;
export type MetricFormat = (typeof METRIC_FORMATS)[number];

/** A displayed value bound to its provenance (charter #3). `T` is the raw value. */
export interface DisplayMetric<T extends number | string = number> {
  readonly value: T;
  readonly format: MetricFormat;
  readonly provenance: RecordProvenance | DerivedProvenance;
}

/** Construct a displayed metric. Provenance is required — a metric without a source cannot exist. */
export function metric<T extends number | string>(
  value: T,
  format: MetricFormat,
  provenance: RecordProvenance | DerivedProvenance,
): DisplayMetric<T> {
  return { value, format, provenance };
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Format a metric's raw value for display (value only — the source/asOf label is
 * added by `<Metric>`). Money is stored in minor units (cents) and rendered as USD.
 */
export function formatMetricValue(m: DisplayMetric): string {
  switch (m.format) {
    case "currency-minor":
      return USD.format(Number(m.value) / 100);
    case "score":
      return String(Math.round(Number(m.value)));
    case "percent":
      return `${Number(m.value).toFixed(1)}%`;
    case "count":
      return String(Number(m.value));
    case "plain":
      return String(m.value);
  }
}

/**
 * The watermark a metric must show when it is a demonstration artifact derived from
 * synthetic input (charter #3 / ADR-0022), or null when it may render plainly.
 */
export function metricWatermark(m: DisplayMetric): string | null {
  return isDemonstration(m.provenance) ? DEMO_WATERMARK : null;
}
