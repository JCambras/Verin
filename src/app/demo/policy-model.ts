import type { SignedCaseId } from "./signed-case-types";
import type {
  ComparisonCellVM,
  DecisionSpineVM,
  DispositionKind,
  FakeClass,
} from "./model";

interface DraftRowVM {
  readonly field: string;
  readonly value: string;
}

export interface SimulationDeltaRowVM {
  readonly label: string;
  readonly before: ComparisonCellVM;
  readonly after: ComparisonCellVM;
}

type PolicyApprovalVM =
  | {
      readonly kind: "available";
      readonly gateLabel: string;
      readonly activation: {
        readonly fromVersion: string;
        readonly toVersion: string;
      };
      readonly changedRerunResult: string;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
    };

interface DemoPolicyRerunExecutionPlanVM {
  readonly action: "money-movement";
  readonly sourceCaseId: SignedCaseId;
  readonly requestRef: string;
  readonly amountMinor: number;
  readonly policyVersion: string;
}

export interface DemoPolicyRerunResultVM {
  readonly disposition: DispositionKind;
  readonly reserveFloorMinor: number;
  readonly headroomMinor: number;
  readonly executionEligible: boolean;
  readonly executionReason: string;
  readonly executionPlan: DemoPolicyRerunExecutionPlanVM | null;
}

export interface DemoPolicyApprovalEventVM {
  readonly eventId: string;
  readonly actorId: string;
  readonly actorRole: string;
  readonly tenantOrgId: string;
  readonly approvedAt: string;
  readonly approvedAtIso: string;
  readonly decisionRecordedAt: string;
  readonly decisionRecordedAtIso: string;
  readonly policyHash: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly reserveMonths: number;
  readonly rerun: DemoPolicyRerunResultVM;
  readonly fakeClass: FakeClass;
  readonly watermark: string;
}

export interface PolicyAuthoringVM {
  readonly spine: DecisionSpineVM;
  readonly sentence: string;
  readonly draft: {
    readonly rows: readonly DraftRowVM[];
    readonly label: string;
    readonly fakeClass: FakeClass;
  };
  readonly interpretation: string;
  readonly simulationDelta: readonly SimulationDeltaRowVM[];
  readonly approval: PolicyApprovalVM;
  readonly fakeClass: FakeClass;
}
