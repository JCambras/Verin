/**
 * THE DECISION-PRIMITIVE CATALOG (v3 prompt 8, re-baselined from the v3 path
 * `src/primitives/catalog.ts` into the contracts layer per marriage-map C6;
 * captain ratification: waveb-design-ratification, 2026-07-26; ADR-0039;
 * D-102).
 *
 * VERSIONED AND PROVISIONAL. The set version below is mirrored by the
 * machine-usable registry `primitive-set-version.json` at the repo root (the
 * `primitive-catalog` fence proves they agree in both directions) and is
 * pinned into every DecisionInputBundle.primitiveSetVersion, independently of
 * the policy-AST grammar version (prompt 9).
 *
 * THE COMPOSABILITY RAZOR (binding, from the ratified design): a concept
 * expressible as a closed AST predicate over already-published values must NOT
 * be a primitive; a concept requiring aggregation, arithmetic, per-candidate
 * quantification, or cross-snapshot comparison MUST be one, because adding
 * those to the AST is the road to the banned general-purpose expression
 * engine. Thresholds, freshness, recency-of-change, eligibility-of-the-bound-
 * subject, allocation integrity, precedence, and approval mechanics are
 * deliberately NOT primitives - docs/primitive-rationale.md records where
 * each lives instead.
 *
 * Declared future primitives (named now so their arrival is a version bump
 * executing a plan, never a local convenience): deviation-from-target (ratio
 * and drift, activated by trading-wave rules), windowed-event-count (backward-
 * looking activity counts, activated by velocity rules), allocation-vector
 * (multi-candidate quantity allocation, activated when single-winner selection
 * is falsified). Adding ANY primitive requires reporting it before building it
 * (v3 standing rule) and a primitive-set version bump.
 */
import type { PrimitiveId } from "../decision-core/ids";
import { candidateSelection } from "./selection";
import { evidenceReconciliation, restrictionScreen } from "./screening";
import { horizonProjection, netAvailability, sufficiencyCheck } from "./quantity";
import type { CatalogPrimitive } from "./values";

/** Semantic version of the primitive SET (not of any one primitive's schema). */
export const PRIMITIVE_SET_VERSION = "1.0.0";

/** The vocabulary is provisional until a second domain wave has exercised it. */
export const PRIMITIVE_SET_PROVISIONAL = true;

/**
 * The six primitives of set 1.0.0, in canonical (id-lexicographic) order.
 * The heterogeneous tuple keeps each entry's full parameter/input typing;
 * `satisfies` proves every entry honors the shared catalog contract.
 */
export const PRIMITIVE_CATALOG = [
  candidateSelection,
  evidenceReconciliation,
  horizonProjection,
  netAvailability,
  restrictionScreen,
  sufficiencyCheck,
] as const satisfies readonly CatalogPrimitive[];

export const PRIMITIVE_CATALOG_IDS: readonly PrimitiveId[] = Object.freeze(
  PRIMITIVE_CATALOG.map((primitive) => primitive.id),
);

export {
  candidateSelection,
  evidenceReconciliation,
  horizonProjection,
  netAvailability,
  restrictionScreen,
  sufficiencyCheck,
};
