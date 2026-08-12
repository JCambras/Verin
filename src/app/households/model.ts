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
  readonly score: DisplayMetric;
  readonly weightLabel: string;
  readonly statement: string;
  readonly readRecords: readonly string[];
  readonly band: HealthBand;
}

export interface HealthVM {
  readonly score: DisplayMetric;
  readonly band: HealthBand;
  readonly bandLabel: string;
  readonly summary: string;
  readonly factors: readonly HealthFactorVM[];
}

/** One row of the hundred-household directory. */
export interface HouseholdRowVM {
  readonly key: string;
  readonly id: string;
  readonly displayName: string;
  readonly surname: string;
  readonly stateLabel: string;
  readonly state: string;
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
  readonly health: HealthVM;
  /** Lowercased haystack the client filters on - search must not re-derive
   * which fields are searchable, or two surfaces will disagree about it. */
  readonly searchText: string;
  readonly provenance: RecordProvenance;
}

export interface DirectoryVM {
  readonly rows: readonly HouseholdRowVM[];
  readonly totalHouseholds: DisplayMetric;
  readonly totalAccounts: DisplayMetric;
  readonly totalPeople: DisplayMetric;
  readonly totalOpenItems: DisplayMetric;
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
  readonly counterpartyKey: string;
  readonly counterpartyName: string;
  readonly note: string;
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
