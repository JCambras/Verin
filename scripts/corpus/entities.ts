/**
 * CORPUS-PLANE IDENTITY AND PROVENANCE (v3 prompt 11, ADR-0034).
 *
 * The record SHAPES live in `scripts/corpus/world.ts`, where Zod both declares
 * and validates them - one declaration, not two. What lives here is the part the
 * schema cannot express: how a corpus record earns its `RecordProvenance` stamp,
 * and how every emitted id is DERIVED rather than typed (design §4.3 rule 11).
 *
 * `RecordProvenance` is imported from the contracts layer rather than redeclared,
 * so the corpus and the product share one provenance vocabulary. Corpus records
 * are deliberately NOT added to `DATA_DICTIONARY`: charter #2 forbids speculative
 * CRM modeling for a fixture generator, and they graduate when a real evidence
 * port needs them.
 */
import type { Confidence, RecordProvenance } from "../../src/contracts/provenance";

/** Every corpus record is a fixture record: synthetic, never compliance-feeding. */
export const CORPUS_RECORD_SOURCE = "fixture" as const;

/** The one way a corpus record gets its provenance stamp. */
export const corpusProvenance = (asOf: string, confidence: Confidence): RecordProvenance => ({
  source: CORPUS_RECORD_SOURCE,
  asOf,
  confidence,
});

// ── Derived identifiers (design §4.3 rule 11: ids are derived, never typed) ─────

export const subjectId = (slug: string): string => `subject:${slug}`;
export const bankInstructionId = (slug: string): string => `bank-instruction:${slug}`;
export const restrictionId = (slug: string): string => `restriction:${slug}`;
export const legalHoldId = (slug: string): string => `hold:${slug}`;
export const pendingActionId = (slug: string): string => `pending:${slug}`;
export const recentChangeId = (slug: string): string => `change:${slug}`;
export const authorityId = (slug: string): string => `authority:${slug}`;
export const plannedWithdrawalId = (slug: string): string => `planned-withdrawal:${slug}`;
export const modelAssignmentId = (slug: string): string => `model-assignment:${slug}`;
export const evidenceSnapshotId = (caseId: string, slot: string): string => `evs:${caseId}:${slot}`;

/** Corpus case ids are `CS-` prefixed and derived from the spec's stable key, so
 * they can never collide with a `GC-` signed golden case id (design §4.1's
 * disjointness rule, fenced by `corpus-provenance-split`). */
export const corpusCaseId = (key: string): string => `CS-${key}`;
