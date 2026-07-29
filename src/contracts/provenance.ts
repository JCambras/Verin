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

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

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

export const DIRECT_LEDGER_PROVENANCE_VERSION = "record-v1.0.0" as const;
export const LEGACY_COMPUTED_LEDGER_PROVENANCE_VERSION =
  "computed-legacy-v0.0.0" as const;
export const COMPUTED_LEDGER_PROVENANCE_VERSION =
  "computed-v1.0.0" as const;
export const LEDGER_PROVENANCE_SERIALIZER_VERSION = "1.0.0" as const;

type DirectSourceSystem = Exclude<SourceSystem, "computed">;

export interface DirectLedgerProducerProvenance
  extends Omit<RecordProvenance, "source"> {
  readonly source: DirectSourceSystem;
  readonly demonstration?: never;
  readonly derivedFrom?: never;
  readonly derivation?: never;
}

export interface ComputedProvenanceInput {
  readonly kind: "ledger-entry";
  readonly entryRef: {
    readonly firmId: string;
    readonly id: string;
  };
  readonly entryHash: string;
}

export interface ComputedProvenanceTrace {
  readonly schemaVersion: typeof COMPUTED_LEDGER_PROVENANCE_VERSION;
  readonly serializerVersion: typeof LEDGER_PROVENANCE_SERIALIZER_VERSION;
  readonly traceRef: {
    readonly firmId: string;
    readonly id: string;
  };
  readonly producer: {
    readonly kind: "algorithm";
    readonly id: string;
    readonly version: string;
  };
  readonly inputs: readonly ComputedProvenanceInput[];
  readonly observedAt: string;
  readonly confidence: Confidence;
}

export interface ComputedLedgerProducerProvenance {
  readonly source: "computed";
  readonly asOf: string;
  readonly confidence: Confidence;
  readonly derivation: ComputedProvenanceTrace & {
    readonly traceDigest: string;
  };
  readonly demonstration?: never;
  readonly derivedFrom?: never;
}

export type LedgerProducerProvenance =
  | DirectLedgerProducerProvenance
  | ComputedLedgerProducerProvenance;

function exactKeys(
  value: object,
  expected: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length &&
    expected.every((key) => keys.includes(key));
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return false;
  }
  return new Date(value).toISOString() === value;
}

function lexicalId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function scopedRef(
  value: unknown,
): value is { readonly firmId: string; readonly id: string } {
  return value !== null &&
    typeof value === "object" &&
    exactKeys(value, ["firmId", "id"]) &&
    lexicalId(Reflect.get(value, "firmId")) &&
    lexicalId(Reflect.get(value, "id"));
}

export function computedProvenanceTrace(
  provenance: ComputedLedgerProducerProvenance,
): ComputedProvenanceTrace {
  return {
    schemaVersion: provenance.derivation.schemaVersion,
    serializerVersion: provenance.derivation.serializerVersion,
    traceRef: provenance.derivation.traceRef,
    producer: provenance.derivation.producer,
    inputs: provenance.derivation.inputs,
    observedAt: provenance.derivation.observedAt,
    confidence: provenance.derivation.confidence,
  };
}

export function parseLedgerProducerProvenance(
  value: unknown,
): LedgerProducerProvenance | null {
  if (value === null || typeof value !== "object") return null;
  if (Reflect.get(value, "source") !== "computed") {
    if (!exactKeys(value, ["source", "asOf", "confidence"])) return null;
    const parsed = parseRecordProvenance(value);
    return parsed && parsed.source !== "computed"
      ? parsed as DirectLedgerProducerProvenance
      : null;
  }
  if (!exactKeys(value, ["source", "asOf", "confidence", "derivation"])) {
    return null;
  }
  const asOf = Reflect.get(value, "asOf");
  const confidence = Reflect.get(value, "confidence");
  const derivation = Reflect.get(value, "derivation");
  if (
    !canonicalTimestamp(asOf) ||
    !CONFIDENCES.includes(confidence as Confidence) ||
    derivation === null ||
    typeof derivation !== "object" ||
    !exactKeys(derivation, [
      "schemaVersion",
      "serializerVersion",
      "traceRef",
      "producer",
      "inputs",
      "observedAt",
      "confidence",
      "traceDigest",
    ]) ||
    Reflect.get(derivation, "schemaVersion") !==
      COMPUTED_LEDGER_PROVENANCE_VERSION ||
    Reflect.get(derivation, "serializerVersion") !==
      LEDGER_PROVENANCE_SERIALIZER_VERSION ||
    !scopedRef(Reflect.get(derivation, "traceRef")) ||
    Reflect.get(derivation, "observedAt") !== asOf ||
    Reflect.get(derivation, "confidence") !== confidence ||
    !hash(Reflect.get(derivation, "traceDigest"))
  ) {
    return null;
  }
  const producer = Reflect.get(derivation, "producer");
  const inputs = Reflect.get(derivation, "inputs");
  if (
    producer === null ||
    typeof producer !== "object" ||
    !exactKeys(producer, ["kind", "id", "version"]) ||
    Reflect.get(producer, "kind") !== "algorithm" ||
    !lexicalId(Reflect.get(producer, "id")) ||
    typeof Reflect.get(producer, "version") !== "string" ||
    !/^[0-9]+(?:\.[0-9]+){1,3}(?:-[a-z0-9.-]+)?$/.test(
      Reflect.get(producer, "version") as string,
    ) ||
    !Array.isArray(inputs) ||
    inputs.length === 0
  ) {
    return null;
  }
  const seen = new Set<string>();
  for (const input of inputs) {
    if (
      input === null ||
      typeof input !== "object" ||
      !exactKeys(input, ["kind", "entryRef", "entryHash"]) ||
      Reflect.get(input, "kind") !== "ledger-entry" ||
      !scopedRef(Reflect.get(input, "entryRef")) ||
      !hash(Reflect.get(input, "entryHash"))
    ) {
      return null;
    }
    const ref = Reflect.get(input, "entryRef") as {
      readonly firmId: string;
      readonly id: string;
    };
    if (
      ref.firmId !== (
        Reflect.get(derivation, "traceRef") as { readonly firmId: string }
      ).firmId ||
      seen.has(`${ref.firmId}\u0000${ref.id}`)
    ) {
      return null;
    }
    seen.add(`${ref.firmId}\u0000${ref.id}`);
  }
  return value as unknown as ComputedLedgerProducerProvenance;
}

export function parseRecordProvenance(value: unknown): RecordProvenance | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<RecordProvenance>;
  if (
    !SOURCE_SYSTEMS.some((source) => source === candidate.source) ||
    !CONFIDENCES.some((confidence) => confidence === candidate.confidence) ||
    typeof candidate.asOf !== "string" ||
    Number.isNaN(Date.parse(candidate.asOf))
  ) {
    return null;
  }
  return {
    source: candidate.source!,
    asOf: new Date(candidate.asOf).toISOString(),
    confidence: candidate.confidence!,
  };
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
  if (isSyntheticSource(p.source)) return false;
  if (p.source !== "computed") return true;
  if (!isDerived(p) || p.demonstration || p.derivedFrom.length === 0) {
    return false;
  }
  const leafSources = p.derivedFrom.filter((source) => source !== "computed");
  return leafSources.length > 0 &&
    leafSources.every((source) => !isSyntheticSource(source));
}

// ── Charter #3 EXTENSION (ADR-0022): derived compliance artifacts ────────────────
// A derived value is only as trustworthy as its least-trustworthy input: if ANY
// input is synthetic the result is itself synthetic — a "demonstration" artifact
// that must render watermarked, record under the demo audit class, stay out of
// the examiner-export, and never feed a real compliance decision. That runs
// charter #3's displayed-metric->source trace end-to-end THROUGH derivations.
// An EXTENSION, never a weakening: nothing previously forbidden is now permitted.

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
  return p.source === "computed" &&
    "demonstration" in p &&
    typeof p.demonstration === "boolean" &&
    "derivedFrom" in p &&
    Array.isArray(p.derivedFrom);
}

/**
 * Provenance of a value computed from `inputs` (ADR-0022). `demonstration` is
 * TRANSITIVE — true iff any input, at any depth, is synthetic or itself a
 * demonstration — so canFeedComplianceDecision refuses a chained derivation too;
 * `derivedFrom` flattens nested traces so the trace always reaches leaf sources.
 */
export function deriveArtifactProvenance(inputs: readonly RecordProvenance[], asOf: string): DerivedProvenance {
  const demonstration = inputs.some((i) =>
    isSyntheticSource(i.source) ||
    (i.source === "computed" && !isDerived(i)) ||
    isDemonstration(i));
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

// ── Fake-class taxonomy (demo contract §6 / design language §11.1-11.2) ──────────
// The single vocabulary for "what is backing this element". It lives here, beside the
// SourceSystem vocabulary, because every surface - demo skeleton or real - labels its
// unlanded paths from the SAME taxonomy; a surface-local literal forks it.
// `real-salesforce-sandbox-response` is deferred-pending-sandbox and cannot be
// produced now, so it is deliberately absent from this union.
export type FakeClass =
  | "synthetic-fixture"
  | "real-derived-fixture"
  | "fake-adapter-response"
  | "user-entered-demo-input"
  | "deterministic-engine-output"
  | "llm-proposed-draft";

/** The DevProvenanceBadge text per class - lowercase and plain (design §11.2). */
export const DEV_BADGE_TEXT: Record<FakeClass, string> = {
  "synthetic-fixture": "synthetic fixture",
  "real-derived-fixture": "sample data · anonymized history",
  "fake-adapter-response": "fake adapter",
  "user-entered-demo-input": "demo input",
  "deterministic-engine-output": "engine output · fake",
  "llm-proposed-draft": "llm draft",
};

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
