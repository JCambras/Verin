import {
  hashCanonicalPreimage,
  toJsonValue,
} from "./decision-identity";
import {
  APPROVAL_CLOCKS,
  CANONICAL_REQUEST,
  DEMO_NOW,
  DESTINATION_RESTRICTION,
  FIRMS,
  SMITHS_LIQUIDITY,
  scenarioById,
  type SignedLiquidityCase,
} from "./data";
import {
  decisionEvidenceSnapshotFor,
  type DecisionEvidenceSnapshot,
} from "./decision-evidence";
import { decisionAuthorityClaimFor } from "./decision-authority-claim";
import { prov } from "./provenance";
import {
  SETUP_FIRM_IDS,
  setupFirmSelectionKey,
  type SignedImpactAttributionVM,
  type SetupFirmId,
  type SetupSelections,
} from "./setup-model";
import { evaluateAuthorityPlan } from "./setup-authority";
import {
  evaluateSetupPolicy,
  setupResolvedConfiguration,
  setupRuntimeFirm,
  type SetupPolicyEvidence,
} from "./setup-policy";
import {
  signedCaseEvaluationEvidence,
  signedCaseMaterialEvidence,
  signedCaseRequestMaterial,
  signedCaseResolvedConfiguration,
  type SignedSetupCase,
} from "./setup-signed-cases";

export const DEFAULT_SETUP_SELECTIONS: SetupSelections = {
  "firm-a": {
    reserve: "6-months",
    freshness: "30-days",
    "bank-change": "specialist",
    threshold: "25000",
    expiry: "1d-3d",
  },
  "firm-b": {
    reserve: "12-months",
    freshness: "30-days",
    "bank-change": "block",
    threshold: "100000",
    expiry: "1d-3d",
  },
};

export interface SignedImpactMaterialInput {
  readonly phase: string | null;
  readonly impactId: string;
  readonly caseRef: string;
  readonly scenarioId: string | null;
  readonly firmId: SetupFirmId;
  readonly request: unknown;
  readonly evidence: unknown;
  readonly resolvedConfiguration: unknown;
  readonly authority: unknown;
  readonly dispositionKind: string;
  readonly selectionKey: string | null;
  readonly missingMaterialInputs: readonly string[];
}

export interface SignedImpactCase {
  readonly fixture: SignedSetupCase;
  readonly evaluationEvidence: SetupPolicyEvidence;
  readonly evidenceMaterial: unknown;
  readonly liquidity: SignedLiquidityCase;
}

export interface SignedImpactDescriptor {
  readonly id: string;
  readonly caseRef: string;
  readonly scenarioId: string | null;
}

export function signedImpactMaterialInputHash(
  value: SignedImpactMaterialInput,
): string {
  return hashCanonicalPreimage(
    toJsonValue({
      hashKind: "money-movement-signed-impact-input",
      preimageVersion:
        "money-movement-signed-impact-input/3.0.0",
      phase: value.phase,
      impactId: value.impactId,
      caseRef: value.caseRef,
      scenarioId: value.scenarioId,
      firmId: value.firmId,
      request: value.request,
      evidence: value.evidence,
      resolvedConfiguration: value.resolvedConfiguration,
      authority: value.authority,
      dispositionKind: value.dispositionKind,
      selectionKey: value.selectionKey,
      missingMaterialInputs: value.missingMaterialInputs,
    }),
  );
}

function missingFixtureInputs(
  caseFile: SignedSetupCase,
): readonly string[] {
  const evidenceMaterial =
    signedCaseMaterialEvidence(caseFile);
  const inputs = evidenceMaterial.evaluatorInputs;
  return [
    "phase",
    "request.text",
    "request.purpose",
    "request.deadline",
    "firmConfiguration.freshnessDays",
    "firmConfiguration.approvalClock",
    "selectionKey",
    ...Object.entries(inputs)
      .filter(([, value]) => value === null)
      .map(([key]) => `evidence.${key}`),
  ];
}

export function signedImpactFixtureMaterialInput(
  impact: SignedImpactDescriptor,
  caseFile: SignedSetupCase,
): SignedImpactMaterialInput {
  return {
    phase: null,
    impactId: impact.id,
    caseRef: impact.caseRef,
    scenarioId: caseFile.scenarioRef,
    firmId: caseFile.firm,
    request: signedCaseRequestMaterial(caseFile),
    evidence: signedCaseMaterialEvidence(caseFile),
    resolvedConfiguration:
      signedCaseResolvedConfiguration(caseFile),
    authority: caseFile.expectedAuthority,
    dispositionKind: caseFile.expectedDisposition,
    selectionKey: null,
    missingMaterialInputs: missingFixtureInputs(caseFile),
  };
}

function previewMaterialInput(
  impact: SignedImpactDescriptor,
  signedCase: SignedImpactCase,
  firmId: SetupFirmId,
): SignedImpactMaterialInput {
  const evaluation = evaluateSetupPolicy(
    DEFAULT_SETUP_SELECTIONS,
    firmId,
    signedCase.evaluationEvidence,
    signedCase.liquidity,
    signedCase.fixture.trigger.asOf,
  );
  const firm = setupRuntimeFirm(
    firmId,
    evaluation,
    FIRMS[firmId]!.policyVersion,
  );
  const authorityClaim = decisionAuthorityClaimFor(
    evaluateAuthorityPlan(
      firm,
      evaluation,
      APPROVAL_CLOCKS[
        DEFAULT_SETUP_SELECTIONS[firmId].expiry
      ]!,
      prov("deterministic-engine-output", DEMO_NOW),
    ),
  );
  return {
    phase: "initial",
    impactId: impact.id,
    caseRef: impact.caseRef,
    scenarioId: impact.scenarioId,
    firmId,
    request: {
      trigger: signedCase.fixture.trigger,
      evaluatorRequest: {
        ...CANONICAL_REQUEST,
        amountMinor: signedCase.liquidity.requestMinor,
      },
    },
    evidence: signedCase.evidenceMaterial,
    resolvedConfiguration: {
      policyVersions: {
        domainConfigVersionId: null,
        firmPolicyVersionId: firm.policyVersion,
        householdInstructionVersionIds: [
          DESTINATION_RESTRICTION.ref,
        ],
        regulatoryVersionId: null,
      },
      ...setupResolvedConfiguration(
        DEFAULT_SETUP_SELECTIONS,
        firmId,
        evaluation,
      ),
    },
    authority: {
      claim: authorityClaim,
      requesterMayApprove:
        authorityClaim.mode === "staged"
          ? authorityClaim.requesterParticipation.mode ===
            "excluded"
            ? false
            : null
          : null,
    },
    dispositionKind: evaluation.dispositionKind,
    selectionKey: setupFirmSelectionKey(
      DEFAULT_SETUP_SELECTIONS[firmId],
    ),
    missingMaterialInputs: [
      "resolvedConfiguration.policyVersions.domainConfigVersionId",
    ],
  };
}

export function impactAttribution(
  impact: SignedImpactDescriptor,
  cases: Readonly<Record<SetupFirmId, SignedImpactCase>>,
  signedFirms: readonly SetupFirmId[] = SETUP_FIRM_IDS,
): SignedImpactAttributionVM {
  return Object.fromEntries(
    SETUP_FIRM_IDS.map((firmId) => [
      firmId,
      {
        previewMaterialInputHash:
          signedImpactMaterialInputHash(
            previewMaterialInput(
              impact,
              cases[firmId],
              firmId,
            ),
          ),
        signedMaterialInputHash: signedFirms.includes(
          firmId,
        )
          ? signedImpactMaterialInputHash(
              signedImpactFixtureMaterialInput(
                impact,
                cases[firmId].fixture,
              ),
            )
          : null,
        signedSelectionKey: null,
      },
    ]),
  ) as SignedImpactAttributionVM;
}

function projectedEvidenceMaterial(
  snapshot: DecisionEvidenceSnapshot,
  liquidity: SignedLiquidityCase,
  evaluatedAt: string,
) {
  return {
    source: "demo-projection",
    phase: snapshot.phase,
    ref: snapshot.ref,
    retrievedAt: snapshot.retrievedAt,
    evaluatorInputs: {
      evaluatedAt,
      availableMinor: liquidity.availableMinor,
      pendingMinor: liquidity.pendingMinor,
      requestMinor: liquidity.requestMinor,
      plannedMonthlyMinor:
        snapshot.plannedMonthlyWithdrawal.value,
      plannedObservedAt:
        snapshot.plannedMonthlyWithdrawal.provenance.asOf,
      bankInstructionObservedAt:
        snapshot.bankInstruction.provenance.asOf,
      bankInstructionIndependentlyVerified:
        snapshot.bankInstruction.value
          .independentlyVerified,
    },
    plannedMonthlyWithdrawal:
      snapshot.plannedMonthlyWithdrawal,
    bankInstruction: snapshot.bankInstruction,
  };
}

function canonicalEvidenceMaterial(
  evidence: NonNullable<
    ReturnType<typeof signedCaseEvaluationEvidence>
  >,
  fixture: SignedSetupCase,
  liquidity: SignedLiquidityCase,
) {
  return {
    source: "captain-signed-fixture",
    evaluatorInputs: {
      evaluatedAt: fixture.trigger.asOf,
      availableMinor: liquidity.availableMinor,
      pendingMinor: liquidity.pendingMinor,
      requestMinor: liquidity.requestMinor,
      plannedMonthlyMinor:
        evidence.plannedMonthlyWithdrawal.value,
      plannedObservedAt:
        evidence.plannedMonthlyWithdrawal.canonical
          .observedAt,
      plannedRetrievedAt:
        evidence.plannedMonthlyWithdrawal.canonical
          .retrievedAt,
      bankInstructionObservedAt:
        evidence.bankInstruction.canonical.observedAt,
      bankInstructionRetrievedAt:
        evidence.bankInstruction.canonical.retrievedAt,
      bankInstructionIndependentlyVerified:
        evidence.bankInstruction.value
          .independentlyVerified,
    },
    plannedMonthlyWithdrawal: {
      value: evidence.plannedMonthlyWithdrawal.value,
      canonical:
        evidence.plannedMonthlyWithdrawal.canonical,
    },
    bankInstruction: {
      value: evidence.bankInstruction.value,
      canonical: evidence.bankInstruction.canonical,
    },
  };
}

export function signedImpactCase(
  fixture: SignedSetupCase,
  scenarioId: string | null,
  liquidity: SignedLiquidityCase = SMITHS_LIQUIDITY,
): SignedImpactCase {
  const canonicalEvidence =
    signedCaseEvaluationEvidence(fixture);
  if (canonicalEvidence) {
    return {
      fixture,
      evaluationEvidence: canonicalEvidence,
      evidenceMaterial:
        canonicalEvidenceMaterial(
          canonicalEvidence,
          fixture,
          liquidity,
        ),
      liquidity,
    };
  }
  const projectedEvidence = decisionEvidenceSnapshotFor(
    scenarioById(scenarioId ?? "safe-proceed"),
  );
  return {
    fixture,
    evaluationEvidence: projectedEvidence,
    evidenceMaterial:
      projectedEvidenceMaterial(
        projectedEvidence,
        liquidity,
        fixture.trigger.asOf,
      ),
    liquidity,
  };
}
