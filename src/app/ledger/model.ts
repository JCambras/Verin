export interface LedgerLevelView {
  readonly level: "L1" | "L2" | "L3" | "L4";
  readonly ok: boolean;
  readonly entriesChecked: number;
  readonly reason: string | null;
}

export interface LedgerEntryView {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly actor: string;
  readonly correlationId: string;
  readonly decisionId: string | null;
  readonly entryHash: string;
  readonly provenanceLabel: string | null;
}

export interface LedgerRegisterViewModel {
  readonly verification: {
    readonly ok: boolean;
    readonly entriesChecked: number;
    readonly levels: readonly LedgerLevelView[];
  };
  readonly total: number;
  readonly entries: readonly LedgerEntryView[];
}
