import type { DisplayMetric } from "@contracts/metric";

export interface LedgerLevelView {
  readonly level: "L1" | "L2" | "L3" | "L4";
  readonly ok: boolean;
  readonly entriesCheckedMetric: DisplayMetric<number>;
  readonly reason: string | null;
}

export interface LedgerVerificationView {
  readonly ok: boolean;
  readonly entriesCheckedMetric: DisplayMetric<number>;
  readonly levels: readonly LedgerLevelView[];
  readonly replaySourceReason: string | null;
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
  readonly activeReservations: DisplayMetric<number>;
  readonly executionSteps: DisplayMetric<number>;
  readonly exceptionRequested: boolean;
  readonly lastEventType: string;
  readonly lastSequence: number;
  readonly provenanceLabel: string | null;
}

export interface LedgerRegisterViewModel {
  readonly verification: LedgerVerificationView;
  readonly eventsTotalMetric: DisplayMetric<number>;
  readonly eventsShownMetric: DisplayMetric<number>;
  readonly decisionsTotalMetric: DisplayMetric<number>;
  readonly decisionsShownMetric: DisplayMetric<number>;
  readonly verificationWindowed: boolean;
  readonly eventsWindowTruncated: boolean;
  readonly decisionsWindowTruncated: boolean;
  readonly decisions: readonly DecisionStateView[];
  readonly entries: readonly LedgerEntryView[];
}
