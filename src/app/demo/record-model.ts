import type {
  DerivedProvenance,
  SourceSystem,
} from "@contracts/provenance";
import type {
  ApprovalStageVM,
  ApprovalVM,
  AutomaticAuthorityVM,
  DispositionVM,
  EvidenceRowVM,
  ExecutionRowVM,
  IntentVM,
  PrecedenceRowVM,
  SafetyVM,
  VerificationVM,
  DemoPolicyApprovalEventVM,
} from "./model";
import type { SignedCaseId } from "./signed-case-types";

export interface RecordVM {
  readonly header: {
    readonly decisionId: string;
    readonly scenarioId: string;
    readonly firmId: string;
    readonly sourceCaseId: SignedCaseId | null;
    readonly pass: "initial" | "revalidated";
    readonly createdAt: string;
    readonly createdAtIso: string;
    readonly provenance: DerivedProvenance;
    readonly watermark: string | null;
  };
  readonly hashes: {
    readonly policyVersion: string;
    readonly instructionVersion: string;
    readonly auditPosition: {
      readonly orgId: string;
      readonly sequence: number;
    } | null;
  };
  readonly decisionBindings: readonly {
    readonly kind: "original" | "derived";
    readonly decisionHash: string;
    readonly bundleHash: string;
  }[];
  readonly policyApproval: DemoPolicyApprovalEventVM | null;
  readonly intent: IntentVM;
  readonly evidence: readonly EvidenceRowVM[];
  readonly disposition: DispositionVM;
  readonly precedence: readonly PrecedenceRowVM[];
  readonly approvalStages: readonly ApprovalStageVM[] | null;
  readonly authorityMode: ApprovalVM["mode"] | null;
  readonly automaticAuthority: AutomaticAuthorityVM | null;
  readonly executionEligibility: SafetyVM["executionEligibility"];
  readonly safety: SafetyVM | null;
  readonly execution: readonly ExecutionRowVM[] | null;
  readonly verification: VerificationVM | null;
  readonly lifecycle: readonly {
    readonly type: string;
    readonly timestampIso: string;
    readonly display: string;
    readonly note: string;
  }[];
  readonly lifecycleKind: "signed" | "demonstration-policy-rerun";
  readonly stopNote: string | null;
  readonly provenanceAppendix: readonly SourceSystem[];
}
