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

/** Replayed decision state - stated facts only, never a computed decision. */
export interface DecisionStateView {
  readonly decisionId: string;
  readonly disposition: string;
  readonly approvalMode: string;
  readonly approvalStages: readonly {
    readonly stageId: string;
    readonly status: string;
  }[];
  readonly activeReservations: number;
  readonly executionSteps: number;
  readonly exceptionRequested: boolean;
  readonly lastEventType: string;
  readonly lastSequence: number;
  readonly provenanceLabel: string | null;
}

export interface LedgerRegisterViewModel {
  readonly verification: {
    readonly ok: boolean;
    readonly entriesChecked: number;
    readonly entriesStored: number;
    readonly levels: readonly LedgerLevelView[];
    readonly replaySourceReason: string | null;
  };
  readonly total: number;
  /** Replayable decisions in the verified window; larger than `decisions` when limited. */
  readonly decisionsTotal: number;
  readonly decisions: readonly DecisionStateView[];
  readonly entries: readonly LedgerEntryView[];
}
