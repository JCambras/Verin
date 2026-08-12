/**
 * HOUSEHOLD VIEW MODELS (ADR-0057).
 *
 * The typed shapes the household directory and the household surface render.
 * Components branch on nothing and derive nothing: every disposition, label,
 * statement, and metric is decided here (built in `build.ts` from the CRM row,
 * the evidence port, and the domain's health computation) and rendered there.
 *
 * Every displayed number is a `DisplayMetric`, so it reaches the screen only
 * through `<Metric>` with its provenance attached; the health figures carry
 * DERIVED provenance, which watermarks them "demonstration - not a compliance
 * record" because their inputs are fixture-sourced (charter #3, ADR-0022).
 */
import type { DisplayMetric } from "@contracts/metric";
import type { RecordProvenance } from "@contracts/provenance";
import type { HealthBand } from "@domain/world/health";

export interface HealthFactorVM {
  readonly id: string;
  readonly label: string;
  /** How far the factor's bar fills, composed here (`"73%"`). A factor's
   * contribution is shown as a proportion and a sentence, never as a bare
   * number: the panel's ONE figure is the composite, which renders through
   * `<Metric>` carrying the watermark its derivation earns. */
  readonly barWidth: string;
  readonly weightLabel: string;
  readonly statement: string;
  readonly readRecords: readonly string[];
  readonly band: HealthBand;
  readonly bandLabel: string;
}

/** How a household's health reaches a LIST: the band and the word for it, which
 * is the whole of what a row renders. The composite figure and the six-factor
 * breakdown belong to the household's own page, where the figure renders once
 * through `<Metric>` carrying its watermark - so a row that cannot show them
 * does not carry them either, and a hundred-row response does not ship a
 * kilobyte of breakdown per row for two words. */
export interface HealthBandVM {
  readonly band: HealthBand;
  readonly bandLabel: string;
}

export interface HealthVM extends HealthBandVM {
  readonly score: DisplayMetric;
  readonly summary: string;
  readonly factors: readonly HealthFactorVM[];
}

/** The DEPTH the evidence port supplies for one household. Everything here is
 * evidence, which is why it is one nullable block rather than a dozen optional
 * fields: a household the firm's record store holds and no evidence describes
 * has none of it, and inventing an empty shell for those fields would be a
 * surface asserting facts nobody sent. */
export interface HouseholdRowEvidenceVM {
  readonly surname: string;
  readonly advisorName: string;
  readonly serviceTier: string;
  readonly city: string;
  readonly authoringLabel: string;
  /** "4 accounts · 3 people · 1 open item" - counts of records, composed here
   * so the row renders one line instead of three provenance labels fighting
   * for the same eighty pixels. The record they count carries its provenance
   * on the row's one metric-class value, the balance. */
  readonly countsLabel: string;
  readonly openItemCount: number;
  readonly totalBalance: DisplayMetric;
  readonly health: HealthBandVM;
}

/** What a household with no evidence on file says, and where it sends a reader
 * next. A state a person can do nothing about is a dead end, so this always
 * carries a real destination. */
export interface NoEvidenceVM {
  readonly badgeLabel: string;
  readonly note: string;
  readonly actionLabel: string;
  readonly actionHref: string;
}

/** What the surface says when the firm's book holds NO household at all, and
 * where it sends a reader next. A DIFFERENT question from "nothing matched this
 * search", and it must never be answered by the same state: an empty book
 * rendering the search-miss copy tells a reader no household matched a search
 * they never made, and names the four Smiths that are not there. `null` when
 * there is a book, so this can never become permanent furniture. */
export interface EmptyBookVM {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly actionHref: string;
}

/**
 * What every row carries whatever the evidence port can say. IDENTITY is the
 * record store's - the house CRM owns the household's name and status, edits
 * them through a governed audited write, and two shipped surfaces reading one
 * record must not disagree about what it is called.
 */
interface HouseholdRowIdentityVM {
  readonly key: string;
  readonly id: string;
  readonly displayName: string;
  readonly stateLabel: string;
  readonly state: string;
  /** Lowercased haystack the client filters on - search must not re-derive
   * which fields are searchable, or two surfaces will disagree about it. */
  readonly searchText: string;
  readonly provenance: RecordProvenance;
}

/**
 * A row is one of exactly two things, and the type says which so the component
 * cannot render a half state: a household the evidence port describes, which
 * opens its own page, or one it does not, which says so and offers a next step.
 */
export type HouseholdRowVM =
  | (HouseholdRowIdentityVM & {
    /** The household's own page. */
    readonly href: string;
    readonly evidence: HouseholdRowEvidenceVM;
    readonly noEvidence: null;
  })
  | (HouseholdRowIdentityVM & {
    /** No page to open: it would have nothing on it. */
    readonly href: null;
    readonly evidence: null;
    readonly noEvidence: NoEvidenceVM;
  });

export interface DirectoryVM {
  readonly rows: readonly HouseholdRowVM[];
  readonly totalHouseholds: DisplayMetric;
  readonly totalAccounts: DisplayMetric;
  readonly totalPeople: DisplayMetric;
  readonly totalOpenItems: DisplayMetric;
  /** What the three record counts stand on when part of the book has no
   * evidence yet: the households are all listed, so a figure that reads only
   * some of them has to say which (null when every row has evidence). */
  readonly evidenceCoverageNote: string | null;
  /** Present ONLY when the book itself is empty; a search that matches nothing
   * is the component's own state and reads different copy. */
  readonly emptyBook: EmptyBookVM | null;
  readonly worldVersion: string | null;
  readonly worldDigest: string | null;
  readonly provenanceNote: string;
}

export interface PersonVM {
  readonly key: string;
  readonly displayName: string;
  readonly roleLabel: string;
  readonly kindLabel: string;
  readonly relationshipLabels: readonly string[];
  readonly provenance: RecordProvenance;
}

export interface EntityVM {
  readonly key: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly formedOn: string;
  readonly controllerNames: readonly string[];
  readonly note: string;
  readonly provenance: RecordProvenance;
}

export interface HoldingVM {
  readonly symbol: string;
  readonly description: string;
  readonly assetClassLabel: string;
  readonly units: string;
  readonly marketValue: DisplayMetric;
  readonly unrealizedLabel: string;
  readonly provenance: RecordProvenance;
}

export interface AccountVM {
  readonly key: string;
  readonly title: string;
  readonly registrationLabel: string;
  readonly taxClassLabel: string;
  readonly custodian: string;
  readonly accountNumberMasked: string;
  readonly openedOn: string;
  readonly balance: DisplayMetric;
  readonly ownerNames: readonly string[];
  readonly modelPortfolio: string;
  readonly rebalanceLabel: string | null;
  readonly holdings: readonly HoldingVM[];
  readonly beneficiaries: readonly {
    readonly displayName: string;
    readonly tierLabel: string;
    readonly share: DisplayMetric;
    readonly provenance: RecordProvenance;
  }[];
  readonly beneficiaryNote: string | null;
  readonly beneficiaryEmptyLabel: string;
  readonly signers: readonly {
    readonly displayName: string;
    readonly authorityLabel: string;
    readonly effectiveLabel: string;
    readonly lapsed: boolean;
    readonly provenance: RecordProvenance;
  }[];
  readonly provenance: RecordProvenance;
}

export interface BankInstructionVM {
  readonly key: string;
  readonly label: string;
  readonly titledTo: string;
  readonly stateLabel: string;
  readonly state: string;
  readonly statusStatement: string;
  readonly supersedesLabel: string | null;
  readonly accountTitles: readonly string[];
  readonly provenance: RecordProvenance;
}

export interface InstructionVM {
  readonly key: string;
  readonly kindLabel: string;
  readonly polarityLabel: string;
  readonly polarity: string;
  readonly scopeLabel: string;
  readonly text: string;
  readonly sourceRef: string;
  readonly effectiveLabel: string;
  readonly provenance: RecordProvenance;
}

export interface PendingActionVM {
  readonly key: string;
  readonly kindLabel: string;
  readonly accountTitle: string;
  readonly amount: DisplayMetric;
  readonly stateLabel: string;
  readonly state: string;
  readonly expectedLabel: string;
  readonly provenance: RecordProvenance;
}

export interface PlannedWithdrawalVM {
  readonly key: string;
  readonly purpose: string;
  readonly accountTitle: string;
  readonly monthly: DisplayMetric;
  readonly fromLabel: string;
  readonly provenance: RecordProvenance;
}

export interface ActivityVM {
  readonly key: string;
  readonly kindLabel: string;
  readonly summary: string;
  readonly actorLabel: string;
  readonly occurredLabel: string;
  readonly provenance: RecordProvenance;
}

export interface CrossHouseholdLinkVM {
  readonly kindLabel: string;
  readonly note: string;
  /** How this page refers to the counterparty. A WITHHELD one is an opaque
   * page-local ordinal (`counterparty-1`), numbered across withheld
   * counterparties alone so the number the copy names counts the parties a
   * reader can actually see, and derivable from nothing about who it is - never
   * a world key, which is `<surname>-<given name>`. A counterparty this caller
   * may see is referred to by the key `counterpartyKey` already discloses. */
  readonly reference: string;
  /** The world key to open, present ONLY when this firm's book holds the
   * counterparty. `null` withholds the link itself, because the key names the
   * party as surely as the name does. */
  readonly counterpartyKey: string | null;
  /** The counterparty's name when this caller may be told it; otherwise a
   * sentence that names no party. */
  readonly counterpartyLabel: string;
}

export interface HouseholdDetailVM {
  readonly key: string;
  readonly id: string;
  readonly displayName: string;
  readonly stateLabel: string;
  readonly state: string;
  readonly advisorLabel: string;
  readonly serviceTierLabel: string;
  readonly city: string;
  readonly openedOn: string;
  readonly narrative: string;
  readonly authoringLabel: string;
  readonly totalBalance: DisplayMetric;
  readonly health: HealthVM;
  readonly people: readonly PersonVM[];
  readonly entities: readonly EntityVM[];
  readonly accounts: readonly AccountVM[];
  readonly bankInstructions: readonly BankInstructionVM[];
  readonly plannedWithdrawals: readonly PlannedWithdrawalVM[];
  readonly instructions: readonly InstructionVM[];
  readonly pendingActions: readonly PendingActionVM[];
  readonly activity: readonly ActivityVM[];
  readonly crossHouseholdLinks: readonly CrossHouseholdLinkVM[];
  readonly evidenceLines: readonly { readonly label: string; readonly provenance: RecordProvenance }[];
  readonly provenance: RecordProvenance;
}
