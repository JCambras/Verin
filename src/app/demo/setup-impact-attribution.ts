/**
 * Signed-impact attribution: whether what an impact card SHOWS for one firm is the
 * captain-signed case itself, or a projection from it.
 *
 * Both sides of that question are built by the SAME normalizers below - one request
 * shape, one evidence shape, one resolved-configuration shape, one authority shape -
 * so an exact match is detectable rather than structurally impossible. The signed
 * side states only what the fixture binds; whatever it cannot bind is recorded in
 * `missingMaterialInputs` and omitted from BOTH sides, so neither hash quietly
 * carries a value the captain never saw. `signedSelectionKey` comes from the
 * fixture's own configuration (setup-signed-cases), so a case that binds an
 * incomplete configuration truthfully never matches anything.
 */
import {
  hashCanonicalPreimage,
  toJsonValue,
} from "./decision-identity";
import {
  DEMO_NOW,
  DESTINATION_RESTRICTION,
  FIRMS,
  SMITHS_LIQUIDITY,
  scenarioById,
  type SignedLiquidityCase,
} from "./data";
import {
  APPROVAL_CLOCKS,
} from "./closed-choices";
import {
  decisionEvidenceSnapshotFor,
  type DecisionEvidenceSnapshot,
} from "./decision-evidence";
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
  type SignedSetupCase,
} from "./setup-signed-cases";
import {
  authorityPlanMaterial,
  signedCaseAuthorityMaterial,
  signedCaseMaterialGaps,
  signedCaseRequestMaterial,
  signedCaseResolvedConfiguration,
  signedCaseSelections,
  type NormalizedAuthorityMaterial,
  type NormalizedResolvedConfiguration,
} from "./signed-case-binding";

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
        "money-movement-signed-impact-input/5.0.0",
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

/** A signed case is a first (initial) evaluation, never a revalidation. Both sides
 * of the comparison therefore speak the same phase. */
const MATERIAL_PHASE = "initial";

/** Null out the fields the signed case does not bind, so the projected side cannot
 * bind a value the signed side never stated (and then claim they match). */
function withGaps(
  configuration: NormalizedResolvedConfiguration,
  gaps: readonly string[],
): NormalizedResolvedConfiguration {
  return {
    ...configuration,
    freshnessDays: gaps.includes(
      "resolvedConfiguration.freshnessDays",
    )
      ? null
      : configuration.freshnessDays,
    approvalClockId: gaps.includes(
      "resolvedConfiguration.approvalClockId",
    )
      ? null
      : configuration.approvalClockId,
  };
}

export function signedImpactFixtureMaterialInput(
  impact: SignedImpactDescriptor,
  caseFile: SignedSetupCase,
): SignedImpactMaterialInput {
  const gaps = signedCaseMaterialGaps(caseFile);
  const selections = signedCaseSelections(caseFile);
  return {
    phase: MATERIAL_PHASE,
    impactId: impact.id,
    caseRef: impact.caseRef,
    scenarioId: caseFile.scenarioRef,
    firmId: caseFile.firm,
    request: signedCaseRequestMaterial(caseFile),
    evidence: signedCaseEvidenceMaterial(caseFile),
    resolvedConfiguration: withGaps(
      signedCaseResolvedConfiguration(caseFile),
      gaps,
    ),
    authority: signedCaseAuthorityMaterial(caseFile),
    dispositionKind: caseFile.expectedDisposition,
    selectionKey: selections
      ? setupFirmSelectionKey(selections)
      : null,
    missingMaterialInputs: gaps,
  };
}

function previewMaterialInput(
  impact: SignedImpactDescriptor,
  signedCase: SignedImpactCase,
  firmId: SetupFirmId,
): SignedImpactMaterialInput {
  const gaps = signedCaseMaterialGaps(signedCase.fixture);
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
  const authorityPlan = evaluateAuthorityPlan(
    firm,
    evaluation,
    APPROVAL_CLOCKS[
      DEFAULT_SETUP_SELECTIONS[firmId].expiry
    ]!,
    prov("deterministic-engine-output", DEMO_NOW),
  );
  const resolved = setupResolvedConfiguration(
    DEFAULT_SETUP_SELECTIONS,
    firmId,
    evaluation,
  );
  const configuration: NormalizedResolvedConfiguration = {
    policyVersions: {
      firmPolicyVersionId: firm.policyVersion,
      householdInstructionVersionIds: [
        DESTINATION_RESTRICTION.ref,
      ],
      regulatoryVersionId: null,
    },
    reserveMonths: resolved.reserveMonths,
    freshnessDays: resolved.freshnessDays,
    bankChangeHandling: resolved.bankChangeHandling,
    dualApprovalThresholdMinor:
      resolved.dualApprovalThresholdMinor,
    approvalsRequired: resolved.approvalsRequired,
    distinctActorsRequired: resolved.distinctActorsRequired,
    requesterParticipation: resolved.requesterParticipation,
    approvalClockId: resolved.approvalClock.id,
  };
  const authority: NormalizedAuthorityMaterial =
    authorityPlanMaterial(
      authorityPlan,
      evaluation.requesterParticipation,
    );
  return {
    phase: MATERIAL_PHASE,
    impactId: impact.id,
    caseRef: impact.caseRef,
    scenarioId: impact.scenarioId,
    firmId,
    request: {
      trigger: signedCase.fixture.trigger,
      amountMinor: signedCase.liquidity.requestMinor,
    },
    evidence: signedCase.evidenceMaterial,
    resolvedConfiguration: withGaps(configuration, gaps),
    authority,
    dispositionKind: evaluation.dispositionKind,
    selectionKey: setupFirmSelectionKey(
      DEFAULT_SETUP_SELECTIONS[firmId],
    ),
    missingMaterialInputs: gaps,
  };
}

export function impactAttribution(
  impact: SignedImpactDescriptor,
  cases: Readonly<Record<SetupFirmId, SignedImpactCase>>,
  signedFirms: readonly SetupFirmId[] = SETUP_FIRM_IDS,
): SignedImpactAttributionVM {
  return Object.fromEntries(
    SETUP_FIRM_IDS.map((firmId) => {
      const fixture = cases[firmId].fixture;
      const signed = signedFirms.includes(firmId);
      const selections = signed
        ? signedCaseSelections(fixture)
        : null;
      return [
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
          signedMaterialInputHash: signed
            ? signedImpactMaterialInputHash(
                signedImpactFixtureMaterialInput(
                  impact,
                  fixture,
                ),
              )
            : null,
          signedSelectionKey: selections
            ? setupFirmSelectionKey(selections)
            : null,
        },
      ];
    }),
  ) as SignedImpactAttributionVM;
}

function projectedEvidenceMaterial(
  caseFile: SignedSetupCase,
  snapshot: DecisionEvidenceSnapshot,
  liquidity: SignedLiquidityCase,
) {
  return {
    source: "demo-projection",
    caseId: caseFile.caseId,
    canonicalEvidence: null,
    evaluatorInputs: {
      evaluatedAt: caseFile.trigger.asOf,
      availableMinor: liquidity.availableMinor,
      pendingMinor: liquidity.pendingMinor,
      requestMinor: liquidity.requestMinor,
      plannedMonthlyMinor:
        snapshot.plannedMonthlyWithdrawal.value,
      plannedObservedAt:
        snapshot.plannedMonthlyWithdrawal.provenance.asOf,
      plannedRetrievedAt: snapshot.retrievedAt,
      bankInstructionObservedAt:
        snapshot.bankInstruction.provenance.asOf,
      bankInstructionRetrievedAt: snapshot.retrievedAt,
      bankInstructionIndependentlyVerified:
        snapshot.bankInstruction.value
          .independentlyVerified,
    },
  };
}

function signedCaseEvidenceMaterial(caseFile: SignedSetupCase) {
  return {
    source: "captain-signed-fixture",
    ...signedCaseMaterialEvidence(caseFile),
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
      evidenceMaterial: signedCaseEvidenceMaterial(fixture),
      liquidity,
    };
  }
  const projectedEvidence = decisionEvidenceSnapshotFor(
    scenarioById(scenarioId ?? "safe-proceed"),
  );
  return {
    fixture,
    evaluationEvidence: projectedEvidence,
    evidenceMaterial: projectedEvidenceMaterial(
      fixture,
      projectedEvidence,
      liquidity,
    ),
    liquidity,
  };
}
