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
 * Charter #3: a synthetic (estimated/defaulted/fixture) value can NEVER feed a
 * compliance decision. Use this at any compliance decision point to refuse
 * synthetic inputs.
 */
export function canFeedComplianceDecision(p: RecordProvenance): boolean {
  return !isSyntheticSource(p.source);
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
