/**
 * Displayed-metric vocabulary (charter #3; ADR-0022; closes Vale V12 — the
 * displayed-metric->source trace). A DisplayMetric binds a value to its
 * provenance and a display format; it is the ONLY shape a metric-class surface
 * renders. TYPE-SYSTEM HALF: it cannot be built without provenance and is
 * deliberately not a ReactNode, so it reaches the screen only through <Metric>.
 * CI-TRACE HALF: the metric-provenance fence (provenance-trace job) fails the
 * build on a metric field rendered outside a provenance-carrying surface —
 * extracting `.value` to render it naked is exactly what it catches.
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

/** Value only — <Metric> adds the source/asOf label. Money is stored in minor units. */
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

/** The watermark a demonstration-derived metric must show, or null (charter #3 / ADR-0022). */
export function metricWatermark(m: DisplayMetric): string | null {
  return isDemonstration(m.provenance) ? DEMO_WATERMARK : null;
}
