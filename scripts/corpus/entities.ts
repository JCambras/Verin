/**
 * CORPUS-PLANE RECORD TYPES (v3 prompt 11, ADR-0034).
 *
 * The twelve record types the prompt's entity set needs, as CORPUS-PLANE types -
 * deliberately NOT added to `DATA_DICTIONARY` (charter #2 forbids speculative
 * CRM modeling for a fixture generator; they graduate when a real evidence port
 * needs them). Every record carries `RecordProvenance` STRUCTURALLY: the type
 * makes an unlabeled record unrepresentable, and the `corpus-provenance-split`
 * fence proves an unlabeled one cannot pass (charter #3).
 *
 * `RecordProvenance` is imported from the contracts layer rather than redeclared,
 * so the corpus and the product share one provenance vocabulary.
 */
import type { Confidence, RecordProvenance } from "../../src/contracts/provenance";

/** Every corpus record is a fixture record: synthetic, never compliance-feeding. */
export const CORPUS_RECORD_SOURCE = "fixture" as const;

export interface Provenanced {
  readonly provenance: RecordProvenance;
}

export type PartyKind = "natural-person" | "trust" | "entity";
export type PartyRole = "client" | "grantor" | "trustee" | "beneficiary" | "signer" | "advisor";
export type TaxClass = "taxable" | "retirement" | "trust" | "entity";
export type BeneficiaryTier = "primary" | "contingent";
export type RestrictionScope = "household" | "account" | "position" | "party";
export type PendingActionState = "pending" | "blocked" | "settling";

export interface Party extends Provenanced {
  readonly id: string;
  readonly kind: PartyKind;
  /** Drawn from the spec's committed, explicitly-invented roster. */
  readonly rosterName: string;
  readonly roles: readonly PartyRole[];
}

export interface Household extends Provenanced {
  readonly id: string;
  readonly scopeSlug: string;
  readonly displayName: string;
  readonly memberRefs: readonly string[];
  readonly advisorRef: string;
}

export interface FinancialAccount extends Provenanced {
  readonly id: string;
  readonly householdRef: string;
  readonly registration: string;
  readonly ownerRefs: readonly string[];
  readonly custodian: string;
  readonly balanceMinor: number;
  /** The nightly-cut instant the balance was struck at - the `observedAt` of any
   * balance evidence over this account. */
  readonly balanceObservedAt: string;
  readonly taxClass: TaxClass;
}

export interface Beneficiary extends Provenanced {
  readonly accountRef: string;
  readonly partyRef: string;
  readonly sharePercentBps: number;
  readonly tier: BeneficiaryTier;
}

export interface AuthorizedSigner extends Provenanced {
  readonly accountRef: string;
  readonly partyRef: string;
  readonly authorityScope: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface BankInstruction extends Provenanced {
  readonly id: string;
  readonly householdRef: string;
  readonly titledTo: string;
  readonly bank: string;
  readonly lastFour: string;
  readonly verifiedAt: string | null;
  readonly changedAt: string | null;
  readonly accountRefs: readonly string[];
}

export interface WithdrawalSegment {
  readonly fromMonth: string;
  readonly monthlyMinor: number;
}

export interface PlannedWithdrawal extends Provenanced {
  readonly householdRef: string;
  /** A SEGMENTED schedule, never a single scalar: `reserveFloor = monthly x months`
   * is exactly the assumption awkward structure AS-11 falsifies. */
  readonly segments: readonly WithdrawalSegment[];
  readonly recordedAt: string;
}

export interface Restriction extends Provenanced {
  readonly id: string;
  readonly scope: RestrictionScope;
  readonly subjectRef: string;
  readonly kind: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly sourceRef: string;
}

export interface RecentChange extends Provenanced {
  readonly id: string;
  readonly subjectRef: string;
  readonly changeKind: string;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly priorValueRef: string;
}

export interface ModelAssignment extends Provenanced {
  readonly accountRef: string;
  readonly modelId: string;
  readonly assignedAt: string;
  readonly pendingRebalance: boolean;
}

export interface PendingAction extends Provenanced {
  readonly id: string;
  readonly householdRef: string;
  readonly accountRef: string;
  readonly kind: string;
  readonly amountMinor: number;
  readonly state: PendingActionState;
  readonly createdAt: string;
  readonly expectedSettleAt: string;
}

export interface LegalHold extends Provenanced {
  readonly id: string;
  readonly subjectRef: string;
  readonly scope: "account" | "position";
  readonly recordedAt: string;
  readonly releasedAt: string | null;
}

/** The whole generated record graph for one corpus world. */
export interface CorpusRecords {
  readonly parties: readonly Party[];
  readonly households: readonly Household[];
  readonly accounts: readonly FinancialAccount[];
  readonly beneficiaries: readonly Beneficiary[];
  readonly authorizedSigners: readonly AuthorizedSigner[];
  readonly bankInstructions: readonly BankInstruction[];
  readonly plannedWithdrawals: readonly PlannedWithdrawal[];
  readonly restrictions: readonly Restriction[];
  readonly recentChanges: readonly RecentChange[];
  readonly modelAssignments: readonly ModelAssignment[];
  readonly pendingActions: readonly PendingAction[];
  readonly legalHolds: readonly LegalHold[];
}

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
export const evidenceSnapshotId = (caseId: string, slot: string): string => `evs:${caseId}:${slot}`;
export const reservationId = (caseId: string, family: string): string => `res:${caseId}:${family}`;

/** Corpus case ids are `CS-` prefixed and derived from the spec's stable key, so
 * they can never collide with a `GC-` signed golden case id (design §4.1's
 * disjointness rule, fenced by `corpus-provenance-split`). */
export const corpusCaseId = (key: string): string => `CS-${key}`;
