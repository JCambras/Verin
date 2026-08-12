/**
 * THE POPULATED WORLD - typed model + port (ADR-0057, front-end parity prompt 4).
 *
 * A hundred named households with real depth: people and their relationships,
 * trusts and entities, accounts with holdings and registration types,
 * beneficiaries and authorized signers, bank instructions with change history,
 * planned withdrawals, restrictions and standing instructions, pending actions,
 * and recent activity. The world is DEMONSTRATION data: every record carries
 * `source: "fixture"` provenance, so `canFeedComplianceDecision` refuses it and
 * anything derived from it renders watermarked (charter #3 + ADR-0022).
 *
 * The world arrives through a PORT, not a second store. Household depth is
 * EVIDENCE - positions, beneficiary designations, and bank instructions are
 * owned by custodians and the CRM of record, not by Verin's house CRM - so the
 * house CRM keeps the entities it genuinely owns and this port supplies the rest
 * behind a typed contract (ADR-0027's Wave 0 rule). The fixture adapter is
 * replaced, not amended, when a real EvidenceSource lands (ADR-0024).
 *
 * The vocabularies below are the SINGLE source of truth for the world: the
 * build-time generator under `scripts/world/` imports them, so a fixture can
 * never carry a registration type, relationship, or activity kind the product
 * cannot render.
 */
import type { ActionGrant } from "@contracts/authz";
import type { RecordProvenance } from "@contracts/provenance";
import type { PIIBearing } from "@contracts/pii";

export const PARTY_KINDS = ["natural-person", "trust", "entity"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

/** Household roles. A household need not have a natural-person client: an
 * entity household (Larkspur Ridge Partners) has only signers. */
export const MEMBER_ROLES = ["client", "spouse", "beneficiary", "signer", "trustee", "grantor"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const RELATIONSHIP_KINDS = [
  "spouse", "parent", "child", "step-parent", "step-child", "sibling", "trustee-of", "grantor-of",
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const ENTITY_KINDS = [
  "revocable-trust", "irrevocable-trust", "llc", "limited-partnership",
] as const;
export type WorldEntityKind = (typeof ENTITY_KINDS)[number];

/** Registration type is the legal titling of an account and is never cosmetic:
 * it decides who may instruct it and how a distribution is taxed. */
export const REGISTRATION_TYPES = [
  "individual", "joint-wros", "ira-traditional", "ira-roth", "rollover-ira", "sep-ira",
  "education-529", "revocable-trust", "irrevocable-trust", "llc-entity", "partnership",
] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

/**
 * CAN a registration carry a beneficiary designation at all? Every registration
 * titled to a natural person can: an individual or joint account takes a
 * transfer-on-death designation as routinely as an IRA takes a beneficiary form.
 * A registration titled to a TRUST or an ENTITY cannot - the trust instrument or
 * the operating agreement says who receives, and there is no designation to
 * make - so on those, and only those, a surface may say the registration does
 * not take one.
 *
 * Deliberately SEPARATE from `BENEFICIARY_SCORED_REGISTRATIONS`, and neither set
 * answers the other's question. Collapsing the two is what put "this
 * registration does not take a beneficiary designation" on ninety joint and
 * individual accounts, which is simply untrue of them.
 */
export const BENEFICIARY_CAPABLE_REGISTRATIONS: ReadonlySet<RegistrationType> = new Set<RegistrationType>([
  "individual", "joint-wros", "ira-traditional", "ira-roth", "rollover-ira", "sep-ira", "education-529",
]);

/**
 * DOES a missing designation count against the household's health? Only where
 * the designation is how the asset actually passes: a retirement account and a
 * 529 pass by designation and nothing else, so an absence there is a real
 * shortfall. On an individual or joint account a designation is available but
 * optional - the account still passes, by survivorship or through the estate -
 * so an absence is a fact, not a deficiency, and nothing may report it as one.
 *
 * The health factor scores THIS set and the detail note is worded from it, so
 * the score and the sentence beside it cannot disagree.
 */
export const BENEFICIARY_SCORED_REGISTRATIONS: ReadonlySet<RegistrationType> = new Set<RegistrationType>([
  "ira-traditional", "ira-roth", "rollover-ira", "sep-ira", "education-529",
]);

export const TAX_CLASSES = ["taxable", "retirement", "trust", "entity", "education"] as const;
export type TaxClass = (typeof TAX_CLASSES)[number];

export const ASSET_CLASSES = ["equity", "fixed-income", "real-assets", "cash", "alternatives"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const BENEFICIARY_TIERS = ["primary", "contingent"] as const;
export type BeneficiaryTier = (typeof BENEFICIARY_TIERS)[number];

export const INSTRUCTION_KINDS = ["restriction", "standing-instruction"] as const;
export type InstructionKind = (typeof INSTRUCTION_KINDS)[number];

export const INSTRUCTION_SCOPES = ["household", "account", "party"] as const;
export type InstructionScope = (typeof INSTRUCTION_SCOPES)[number];

/** Same two words the replay corpus uses (`scripts/corpus/instruction-conflicts.ts`),
 * so one household instruction cannot mean two things in two artifacts. */
export const INSTRUCTION_POLARITIES = ["required", "forbidden"] as const;
export type InstructionPolarity = (typeof INSTRUCTION_POLARITIES)[number];

export const BANK_INSTRUCTION_STATES = ["current", "superseded"] as const;
export type BankInstructionState = (typeof BANK_INSTRUCTION_STATES)[number];

export const ACTIVITY_KINDS = [
  "review-meeting", "document-received", "distribution-settled", "contribution-received",
  "beneficiary-updated", "bank-instruction-changed", "model-rebalanced", "statement-published",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const SERVICE_TIERS = ["foundational", "core", "premier"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export const HOUSEHOLD_STATES = ["prospect", "active", "inactive"] as const;
export type HouseholdState = (typeof HOUSEHOLD_STATES)[number];

/** How a household's depth was written. `hand-authored` households carry
 * written-by-a-person structure and prose; `derived` households are generated
 * from the same seeded rules. Surfaces label the difference rather than
 * pretending the whole world was authored (charter #3). */
export const AUTHORING_MODES = ["hand-authored", "derived"] as const;
export type AuthoringMode = (typeof AUTHORING_MODES)[number];

export const CROSS_HOUSEHOLD_LINK_KINDS = [
  "trust-owned-account-serving-another-household",
  "receives-distribution-from-external-trust",
  "shared-authorized-signer",
] as const;
export type CrossHouseholdLinkKind = (typeof CROSS_HOUSEHOLD_LINK_KINDS)[number];

/** PIIBearing: a party display name is client PII in the real world, and the
 * fixture is shaped like the real thing so no boundary learns the wrong shape. */
export interface WorldParty extends PIIBearing {
  readonly key: string;
  readonly id: string;
  readonly displayName: string;
  readonly kind: PartyKind;
  readonly role: MemberRole;
  readonly relationships: readonly { readonly toKey: string; readonly kind: RelationshipKind }[];
  readonly provenance: RecordProvenance;
}

export interface WorldEntity extends PIIBearing {
  readonly key: string;
  readonly id: string;
  readonly kind: WorldEntityKind;
  readonly name: string;
  readonly formedOn: string;
  readonly controllerKeys: readonly string[];
  readonly note: string;
  readonly provenance: RecordProvenance;
}

export interface WorldHolding {
  readonly symbol: string;
  readonly description: string;
  readonly assetClass: AssetClass;
  /** Thousandths of a unit - integer arithmetic only, never a float. */
  readonly unitsMilli: number;
  readonly marketValueMinor: number;
  readonly costBasisMinor: number;
  readonly asOf: string;
  readonly provenance: RecordProvenance;
}

export interface WorldBeneficiary extends PIIBearing {
  readonly partyKey: string;
  readonly displayName: string;
  readonly tier: BeneficiaryTier;
  readonly shareBps: number;
  readonly provenance: RecordProvenance;
}

export interface WorldSigner extends PIIBearing {
  readonly partyKey: string;
  readonly displayName: string;
  readonly authorityScope: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly provenance: RecordProvenance;
}

export interface WorldAccount extends PIIBearing {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly registration: RegistrationType;
  readonly taxClass: TaxClass;
  readonly custodian: string;
  readonly accountNumberMasked: string;
  readonly openedOn: string;
  readonly balanceMinor: number;
  readonly balanceObservedAt: string;
  readonly ownerKeys: readonly string[];
  readonly modelPortfolio: string;
  readonly pendingRebalance: boolean;
  readonly holdings: readonly WorldHolding[];
  readonly beneficiaries: readonly WorldBeneficiary[];
  readonly signers: readonly WorldSigner[];
  readonly provenance: RecordProvenance;
}

export interface WorldBankInstruction {
  readonly key: string;
  readonly id: string;
  readonly bank: string;
  readonly lastFour: string;
  readonly titledTo: string;
  readonly state: BankInstructionState;
  readonly verifiedAt: string | null;
  readonly changedAt: string | null;
  readonly supersedesKey: string | null;
  readonly accountKeys: readonly string[];
  readonly observedAt: string;
  readonly provenance: RecordProvenance;
}

export interface WorldPlannedWithdrawal {
  readonly key: string;
  readonly id: string;
  readonly accountKey: string;
  readonly purpose: string;
  readonly fromMonth: string;
  readonly monthlyMinor: number;
  readonly recordedAt: string;
  readonly provenance: RecordProvenance;
}

export interface WorldInstruction {
  readonly key: string;
  readonly id: string;
  readonly kind: InstructionKind;
  readonly polarity: InstructionPolarity;
  readonly scope: InstructionScope;
  readonly subjectRef: string;
  readonly text: string;
  readonly sourceRef: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordedAt: string;
  readonly provenance: RecordProvenance;
}

export interface WorldPendingAction {
  readonly key: string;
  readonly id: string;
  readonly accountKey: string;
  readonly kind: string;
  readonly amountMinor: number;
  readonly state: string;
  readonly createdAt: string;
  readonly expectedSettleAt: string;
  readonly provenance: RecordProvenance;
}

export interface WorldActivity {
  readonly key: string;
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: ActivityKind;
  readonly summary: string;
  readonly actorLabel: string;
  readonly provenance: RecordProvenance;
}

export interface WorldCrossHouseholdLink {
  readonly kind: CrossHouseholdLinkKind;
  readonly counterpartyHouseholdKey: string;
  readonly partyKey: string;
  readonly note: string;
}

/**
 * Each class of evidence AS ITS PROVENANCE: the instant it was observed and the
 * confidence that instant earns against the world's own `asOf`, decided once by
 * the materializer. Carrying bare instants left every reader free to decide the
 * confidence again, and a surface that typed `high` beside an observation the
 * materializer had already measured as `medium` disagreed with itself on the
 * same page. The freshness health factor reads `asOf`; anything stating how far
 * an observation can be trusted reads the provenance rather than minting one.
 */
export interface WorldEvidenceClock {
  readonly liquidity: RecordProvenance;
  readonly positions: RecordProvenance;
  readonly instructions: RecordProvenance;
  readonly retrievedAt: string;
}

export interface WorldHousehold extends PIIBearing {
  readonly key: string;
  readonly id: string;
  readonly displayName: string;
  readonly surname: string;
  readonly state: HouseholdState;
  readonly authoring: AuthoringMode;
  readonly advisorName: string;
  readonly advisorCredential: string;
  readonly serviceTier: ServiceTier;
  readonly city: string;
  readonly openedOn: string;
  readonly narrative: string;
  readonly members: readonly WorldParty[];
  readonly entities: readonly WorldEntity[];
  readonly accounts: readonly WorldAccount[];
  readonly bankInstructions: readonly WorldBankInstruction[];
  readonly plannedWithdrawals: readonly WorldPlannedWithdrawal[];
  readonly instructions: readonly WorldInstruction[];
  readonly pendingActions: readonly WorldPendingAction[];
  readonly activity: readonly WorldActivity[];
  readonly crossHouseholdLinks: readonly WorldCrossHouseholdLink[];
  readonly evidence: WorldEvidenceClock;
  readonly provenance: RecordProvenance;
}

/** The directory row - what a hundred-row list renders without loading a
 * hundred deep households. Emitted by the generator into the manifest. */
export interface WorldHouseholdSummary extends PIIBearing {
  readonly key: string;
  readonly id: string;
  readonly displayName: string;
  readonly surname: string;
  readonly state: HouseholdState;
  readonly authoring: AuthoringMode;
  readonly advisorName: string;
  readonly serviceTier: ServiceTier;
  readonly city: string;
  readonly memberCount: number;
  readonly accountCount: number;
  readonly totalBalanceMinor: number;
  readonly openItemCount: number;
  readonly provenance: RecordProvenance;
}

/**
 * THE PORT. Reading a household means reading the names of the people in it, so
 * both methods take the governed `pii.view` grant (v3 §15.3) exactly as the CRM
 * repository does - the grant's sealed tenant is what scopes the read, and no
 * caller can reach this evidence without having been authorized for it.
 */
export interface HouseholdWorldSource {
  listHouseholds(grant: ActionGrant<"pii.view">): Promise<readonly WorldHouseholdSummary[]>;
  getHousehold(grant: ActionGrant<"pii.view">, key: string): Promise<WorldHousehold | null>;
}
