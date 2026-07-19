/**
 * Provenance vocabulary (ADR-0005, charter #2/#3). Every modeled value's origin
 * is known: which source system produced it, as of when, how confident, and how
 * to resolve a conflict when two sources disagree (survivorship). Synthetic
 * values (estimate/default/fixture) can NEVER feed a compliance decision and must
 * render with a visible source/asOf label.
 */

export const SOURCE_SYSTEMS = [
  "verin-crm", // the house CRM (system of record for the PoC)
  "salesforce", // future second source
  "csv-import", // future second source
  "computed", // derived from other real values (show the formula)
  "user-input", // entered by an authenticated user
  "estimate", // synthetic — labeled, never feeds compliance
  "default", // synthetic — a fallback default, labeled, never feeds compliance
  "fixture", // synthetic — seed/demo data, labeled, never feeds compliance
] as const;
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];

export const SYNTHETIC_SOURCES: readonly SourceSystem[] = ["estimate", "default", "fixture"];

export type Confidence = "high" | "medium" | "low";

export const SURVIVORSHIP_RULES = [
  "source-precedence", // a fixed source ranking wins
  "most-recent", // newest asOf wins
  "highest-confidence", // highest confidence wins
  "manual", // a human must resolve
] as const;
export type SurvivorshipRule = (typeof SURVIVORSHIP_RULES)[number];

/** Record-level provenance carried on every persisted entity instance. */
export interface RecordProvenance {
  readonly source: SourceSystem;
  readonly asOf: string; // ISO-8601
  readonly confidence: Confidence;
}

/** A value bound to its provenance (used for displayed metrics — charter #3). */
export interface Provenanced<T> {
  readonly value: T;
  readonly provenance: RecordProvenance;
}

export function provenanced<T>(value: T, provenance: RecordProvenance): Provenanced<T> {
  return { value, provenance };
}

export function isSyntheticSource(source: SourceSystem): boolean {
  return SYNTHETIC_SOURCES.includes(source);
}

/**
 * Charter #3 (+ ADR-0022 extension): a value can feed a real compliance decision
 * only if it is neither synthetic (estimated/defaulted/fixture) NOR a demonstration
 * artifact DERIVED from synthetic input. Use this at any compliance decision point
 * to refuse both. Accepts a plain RecordProvenance or a DerivedProvenance.
 */
export function canFeedComplianceDecision(p: RecordProvenance | DerivedProvenance): boolean {
  return !isSyntheticSource(p.source) && !isDemonstration(p);
}

// ── Charter #3 EXTENSION (ADR-0022): derived compliance artifacts ────────────────
// A value DERIVED from one or more inputs is only as trustworthy as its
// least-trustworthy input. If ANY input is synthetic, the derived value is itself
// synthetic — a "demonstration" artifact (a health score or compliance-scan result
// computed over a labeled-synthetic/demo household). It must render/record as a
// demonstration (watermarked, demo audit class, excluded from the real
// examiner-export) and can never feed a real compliance decision. This makes charter
// #3's displayed-metric->source trace run end-to-end THROUGH derived artifacts,
// closing the hole the charter's prose leaves open. It is an EXTENSION, never a
// weakening: a NEW class of value is brought under the existing rule; nothing
// previously forbidden is now permitted.

/** The visible label a demonstration-derived artifact must carry (charter #3 / ADR-0022). */
export const DEMO_WATERMARK = "Demonstration - not a compliance record" as const;

/** Provenance of a value computed FROM other provenanced inputs (the derivation trace). */
export interface DerivedProvenance extends RecordProvenance {
  /** True iff any input was synthetic or itself a demonstration: the derived artifact is itself synthetic. */
  readonly demonstration: boolean;
  /** The input sources this artifact was derived from, flattened through nested derivations to leaf sources (deduped). */
  readonly derivedFrom: readonly SourceSystem[];
}

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };

/** The least-confident input governs a derived value's confidence. */
function lowestConfidence(inputs: readonly RecordProvenance[]): Confidence {
  return inputs.reduce<Confidence>(
    (lowest, i) => (CONFIDENCE_RANK[i.confidence] < CONFIDENCE_RANK[lowest] ? i.confidence : lowest),
    "high",
  );
}

function isDerived(p: RecordProvenance): p is DerivedProvenance {
  return "derivedFrom" in p;
}

/**
 * Provenance of a value computed from `inputs` (ADR-0022). source = "computed";
 * `demonstration` is true iff ANY input is synthetic OR itself a demonstration, so
 * the flag is TRANSITIVE through chained derivations: a value derived, at any depth,
 * from even one labeled-synthetic/demo input is itself a demonstration artifact that
 * `canFeedComplianceDecision` refuses. `derivedFrom` flattens nested traces so the
 * displayed-metric->source trace always reaches leaf sources.
 */
export function deriveArtifactProvenance(inputs: readonly RecordProvenance[], asOf: string): DerivedProvenance {
  const demonstration = inputs.some((i) => isSyntheticSource(i.source) || isDemonstration(i));
  const derivedFrom = [...new Set(inputs.flatMap((i) => (isDerived(i) ? [i.source, ...i.derivedFrom] : [i.source])))];
  return {
    source: "computed",
    asOf,
    confidence: demonstration ? "low" : lowestConfidence(inputs),
    demonstration,
    derivedFrom,
  };
}

/** True iff `p` is a demonstration-derived artifact (charter #3 / ADR-0022). */
export function isDemonstration(p: RecordProvenance | DerivedProvenance): boolean {
  return "demonstration" in p && p.demonstration === true;
}

/** A short, human-visible source/asOf label for the UI (charter #3). */
export function provenanceLabel(p: RecordProvenance): string {
  const labels: Record<SourceSystem, string> = {
    "verin-crm": "Verin CRM",
    salesforce: "Salesforce",
    "csv-import": "CSV import",
    computed: "Computed",
    "user-input": "Entered",
    estimate: "Estimated",
    default: "Default",
    fixture: "Sample data",
  };
  const date = p.asOf.slice(0, 10);
  return `${labels[p.source]} · as of ${date}`;
}
