/**
 * Golden-record conflict resolution (ADR-0005, charter #2). When two sources
 * disagree on a field, survivorship decides the winner. Designed so a future
 * second source (Salesforce, CSV) can join without corrupting the record — the
 * gap that "manifests as incorrect compliance decisions" (retro-r7 don't-again #7).
 */
import type { RecordProvenance, SourceSystem, SurvivorshipRule, Confidence } from "@contracts/provenance";
import { invariant } from "@contracts/assert";

export interface Candidate<T> {
  readonly value: T;
  readonly provenance: RecordProvenance;
}

export interface Resolution<T> {
  readonly winner: Candidate<T>;
  readonly needsManual: boolean;
  readonly rule: SurvivorshipRule;
}

// Precedence order (lower index wins). The house CRM is authoritative for the PoC;
// a real second source is inserted here deliberately, not by accident.
const SOURCE_PRECEDENCE: readonly SourceSystem[] = [
  "verin-crm",
  "user-input",
  "salesforce",
  "csv-import",
  "computed",
  "estimate",
  "default",
  "fixture",
];

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

function precedenceIndex(source: SourceSystem): number {
  const i = SOURCE_PRECEDENCE.indexOf(source);
  return i < 0 ? SOURCE_PRECEDENCE.length : i;
}

/**
 * Resolve a conflict among candidates by the field's survivorship rule. Returns
 * the winner and whether a human must confirm. Never throws — an empty candidate
 * list is a programmer error surfaced by the assertion.
 */
export function resolveConflict<T>(rule: SurvivorshipRule, candidates: readonly Candidate<T>[]): Resolution<T> {
  invariant(candidates.length > 0, "resolveConflict: no candidates");
  const first = candidates[0]!;
  if (candidates.length === 1) return { winner: first, needsManual: false, rule };

  switch (rule) {
    case "source-precedence": {
      const winner = [...candidates].sort((a, b) => precedenceIndex(a.provenance.source) - precedenceIndex(b.provenance.source))[0]!;
      return { winner, needsManual: false, rule };
    }
    case "most-recent": {
      const winner = [...candidates].sort((a, b) => b.provenance.asOf.localeCompare(a.provenance.asOf))[0]!;
      return { winner, needsManual: false, rule };
    }
    case "highest-confidence": {
      const winner = [...candidates].sort(
        (a, b) => CONFIDENCE_RANK[b.provenance.confidence] - CONFIDENCE_RANK[a.provenance.confidence],
      )[0]!;
      return { winner, needsManual: false, rule };
    }
    case "manual":
      // A human must resolve; surface the highest-precedence value as the provisional winner.
      return { winner: first, needsManual: true, rule };
  }
}
