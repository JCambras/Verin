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
    readonly auditPosition: string;
  };
  readonly decisionBindings: readonly {
    readonly kind: "original" | "derived";
    readonly decisionHash: string;
    readonly bundleHash: string;
  }[];
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
  readonly stopNote: string | null;
  readonly provenanceAppendix: readonly SourceSystem[];
}
