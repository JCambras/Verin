import {
  hashCanonicalPreimage,
  toJsonValue,
} from "./decision-identity";
import {
  APPROVAL_CLOCKS,
  CANONICAL_REQUEST,
  DEMO_NOW,
  FIRMS,
  GC15_PENDING_DISTRIBUTION,
  LOW_HEADROOM_LIQUIDITY,
  SMITHS_LIQUIDITY,
  pendingDistributionDeltaSentence,
  type SignedLiquidityCase,
} from "./data";
import type { DecisionEvidenceSnapshot } from "./decision-evidence";
import { decisionAuthorityClaimFor } from "./decision-authority-claim";
import { prov } from "./provenance";
import {
  SETUP_FIRM_IDS,
  setupFirmSelectionKey,
  type ChoiceEffectVM,
  type ExactCaseImpactVM,
  type MoneyMovementSetupVM,
  type SignedImpactAttributionVM,
  type SetupFirmId,
  type SetupSelections,
} from "./setup-model";
import { evaluateAuthorityPlan } from "./setup-authority";
import {
  evaluateSetupPolicy,
  setupResolvedConfiguration,
  setupRuntimeFirm,
  type SetupResolvedConfiguration,
} from "./setup-policy";
import {
  SIGNED_SETUP_CASES,
  signedCaseEvidenceSnapshot,
  signedCaseMaterialEvidence,
  type SignedSetupCase,
} from "./setup-signed-cases";

const DEFAULT_SETUP_SELECTIONS: SetupSelections = {
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
  readonly phase: string;
  readonly impactId: string;
  readonly caseRef: string;
  readonly scenarioId: string | null;
  readonly firmId: SetupFirmId;
  readonly request: unknown;
  readonly evidence: unknown;
  readonly resolvedConfiguration: SetupResolvedConfiguration;
  readonly authority: {
    readonly claim: ReturnType<
      typeof decisionAuthorityClaimFor
    >;
    readonly requesterMayApprove: boolean | null;
  };
}

export function signedImpactMaterialInputHash(
  value: SignedImpactMaterialInput,
): string {
  return hashCanonicalPreimage(
    toJsonValue({
      hashKind: "money-movement-signed-impact-input",
      preimageVersion:
        "money-movement-signed-impact-input/2.0.0",
      phase: value.phase,
      impactId: value.impactId,
      caseRef: value.caseRef,
      scenarioId: value.scenarioId,
      firmId: value.firmId,
      request: value.request,
      evidence: value.evidence,
      resolvedConfiguration: value.resolvedConfiguration,
      authority: value.authority,
    }),
  );
}

function usd(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US")}`;
}

function effect(
  status: string,
  label: string,
  summary: string,
  detail: string,
  reachesAuthority?: boolean,
): ChoiceEffectVM {
  return {
    status: { status, label },
    summary,
    detail,
    ...(reachesAuthority === undefined
      ? {}
      : { reachesAuthority }),
  };
}

function factsLine(liquidity: SignedLiquidityCase): string {
  return `${usd(liquidity.availableMinor)} available · ${usd(liquidity.pendingMinor)} pending · same ${usd(liquidity.requestMinor)} request`;
}

interface SignedImpactCase {
  readonly fixture: SignedSetupCase;
  readonly evaluationEvidence: DecisionEvidenceSnapshot;
  readonly liquidity: SignedLiquidityCase;
}

function impactAttribution(
  impact: {
    readonly id: string;
    readonly caseRef: string;
    readonly scenarioId: string | null;
  },
  cases: Readonly<Record<SetupFirmId, SignedImpactCase>>,
  signedFirms: readonly SetupFirmId[] = SETUP_FIRM_IDS,
): SignedImpactAttributionVM {
  const materialInputHash = (
    signedCase: SignedImpactCase,
    firmId: SetupFirmId,
    signed: boolean,
  ) => {
    const evaluation = evaluateSetupPolicy(
      DEFAULT_SETUP_SELECTIONS,
      firmId,
      signedCase.evaluationEvidence,
      signedCase.liquidity,
      signedCase.fixture.trigger.asOf,
    );
    const attributedEvaluation = signed
      ? {
          ...evaluation,
          requesterParticipation:
            FIRMS[firmId]!.requesterParticipation,
        }
      : evaluation;
    const firm = setupRuntimeFirm(
      firmId,
      attributedEvaluation,
      FIRMS[firmId]!.policyVersion,
    );
    const authorityClaim = decisionAuthorityClaimFor(
      evaluateAuthorityPlan(
        firm,
        attributedEvaluation,
        APPROVAL_CLOCKS[
          DEFAULT_SETUP_SELECTIONS[firmId].expiry
        ]!,
        prov("deterministic-engine-output", DEMO_NOW),
      ),
    );
    const authority = {
      claim: authorityClaim,
      requesterMayApprove:
        authorityClaim.mode === "staged"
          ? authorityClaim.requesterParticipation.mode ===
            "excluded"
            ? false
            : null
          : null,
    };
    return signedImpactMaterialInputHash({
      phase: "signed-impact-preview",
      impactId: impact.id,
      caseRef: impact.caseRef,
      scenarioId: impact.scenarioId,
      firmId,
      request: {
        goldenTrigger: signedCase.fixture.trigger,
        evaluatorRequest: CANONICAL_REQUEST,
      },
      evidence: signedCaseMaterialEvidence(
        signedCase.fixture,
        signedCase.evaluationEvidence,
        signedCase.liquidity,
      ),
      resolvedConfiguration: setupResolvedConfiguration(
        DEFAULT_SETUP_SELECTIONS,
        firmId,
        attributedEvaluation,
      ),
      authority,
    });
  };
  return Object.fromEntries(
    SETUP_FIRM_IDS.map((firmId) => [
      firmId,
      {
        previewMaterialInputHash: materialInputHash(
          cases[firmId],
          firmId,
          false,
        ),
        signedMaterialInputHash: signedFirms.includes(firmId)
          ? materialInputHash(
              cases[firmId],
              firmId,
              true,
            )
          : null,
        signedSelectionKey: setupFirmSelectionKey(
          DEFAULT_SETUP_SELECTIONS[firmId],
        ),
      },
    ]),
  ) as SignedImpactAttributionVM;
}

function bankImpactEffect(
  selections: SetupSelections,
  firmId: SetupFirmId,
  evidence: DecisionEvidenceSnapshot,
  evaluatedAt: string,
): ChoiceEffectVM {
  const evaluated = evaluateSetupPolicy(
    selections,
    firmId,
    evidence,
    SMITHS_LIQUIDITY,
    evaluatedAt,
  );
  if (evaluated.dispositionKind === "blocked") {
    return effect(
      "blocked",
      "Blocked",
      "Blocked pending independent verification",
      "No approval authority exists until the resolving evidence is supplied.",
      false,
    );
  }
  if (evaluated.authority.mode === "automatic") {
    return effect(
      "done",
      "Automatic",
      "Proceed automatically at this amount",
      `The request is below the configured ${usd(evaluated.dualApprovalThresholdMinor)} threshold and no approval stage applies.`,
      true,
    );
  }
  const summary =
    evaluated.requiresSpecialist && evaluated.dualApproval
      ? "Specialist review, then two distinct operations approvers"
      : evaluated.requiresSpecialist
        ? "Specialist review; no dual approval at this amount"
        : "Two distinct operations approvers";
  return effect(
    "proceed",
    "Proceed",
    summary,
    evaluated.dualApproval
      ? `The request exceeds the configured ${usd(evaluated.dualApprovalThresholdMinor)} threshold.`
      : `The evaluator creates no standard approval below the configured ${usd(evaluated.dualApprovalThresholdMinor)} threshold.`,
    true,
  );
}

function bankImpactSelectionEffects(
  cases: Readonly<Record<SetupFirmId, SignedImpactCase>>,
): NonNullable<ExactCaseImpactVM["selectionEffects"]> {
  const result = {
    "firm-a": [] as {
      selectionKey: string;
      effect: ChoiceEffectVM;
    }[],
    "firm-b": [] as {
      selectionKey: string;
      effect: ChoiceEffectVM;
    }[],
  };
  for (const firmId of ["firm-a", "firm-b"] as const) {
    for (const reserve of ["6-months", "9-months", "12-months"]) {
      for (const freshness of ["7-days", "14-days", "30-days"]) {
        for (const bankChange of ["specialist", "block"]) {
          for (const threshold of ["25000", "50000", "100000"]) {
            for (const expiry of ["4h-2d", "1d-3d", "2d-5d"]) {
              const firmSelections = {
                reserve,
                freshness,
                "bank-change": bankChange,
                threshold,
                expiry,
              };
              const selections: SetupSelections = {
                "firm-a":
                  firmId === "firm-a"
                    ? firmSelections
                    : DEFAULT_SETUP_SELECTIONS["firm-a"],
                "firm-b":
                  firmId === "firm-b"
                    ? firmSelections
                    : DEFAULT_SETUP_SELECTIONS["firm-b"],
              };
              result[firmId].push({
                selectionKey:
                  setupFirmSelectionKey(firmSelections),
                effect: bankImpactEffect(
                  selections,
                  firmId,
                  cases[firmId].evaluationEvidence,
                  cases[firmId].fixture.trigger.asOf,
                ),
              });
            }
          }
        }
      }
    }
  }
  return result;
}

function signedImpactCase(
  fixture: SignedSetupCase,
  fallback: SignedSetupCase,
  liquidity: SignedLiquidityCase = SMITHS_LIQUIDITY,
): SignedImpactCase {
  return {
    fixture,
    evaluationEvidence: signedCaseEvidenceSnapshot(
      fixture,
      fallback,
      liquidity,
    ),
    liquidity,
  };
}

function evidenceDate(
  caseFile: SignedSetupCase,
  evidenceKind: string,
): string {
  const observedAt = caseFile.householdEvidence.find(
    (datum) => datum.evidenceKind === evidenceKind,
  )?.observedAt;
  if (!observedAt) {
    throw new Error(
      `${caseFile.caseId} has no ${evidenceKind} observation`,
    );
  }
  return observedAt.slice(0, 10);
}

function ageDays(asOf: string, observedAt: string): number {
  return (
    (Date.parse(asOf.slice(0, 10)) -
      Date.parse(observedAt.slice(0, 10))) /
    86_400_000
  );
}

export function buildSetupImpacts(): MoneyMovementSetupVM["impacts"] {
  const recentCases = {
    "firm-a": signedImpactCase(
      SIGNED_SETUP_CASES.recentA,
      SIGNED_SETUP_CASES.recentA,
    ),
    "firm-b": signedImpactCase(
      SIGNED_SETUP_CASES.recentB,
      SIGNED_SETUP_CASES.recentA,
    ),
  };
  const safeCases = {
    "firm-a": signedImpactCase(
      SIGNED_SETUP_CASES.happyA,
      SIGNED_SETUP_CASES.happyA,
    ),
    "firm-b": signedImpactCase(
      SIGNED_SETUP_CASES.happyB,
      SIGNED_SETUP_CASES.happyB,
    ),
  };
  const lowHeadroomCases = {
    "firm-a": signedImpactCase(
      SIGNED_SETUP_CASES.lowHeadroomB,
      SIGNED_SETUP_CASES.happyB,
      LOW_HEADROOM_LIQUIDITY,
    ),
    "firm-b": signedImpactCase(
      SIGNED_SETUP_CASES.lowHeadroomB,
      SIGNED_SETUP_CASES.happyB,
      LOW_HEADROOM_LIQUIDITY,
    ),
  };
  const recentObservedAt = evidenceDate(
    SIGNED_SETUP_CASES.recentA,
    "bank-instruction",
  );
  const staleObservedAt = evidenceDate(
    SIGNED_SETUP_CASES.staleA,
    "planned-withdrawals",
  );
  const staleAvailableObservedAt = evidenceDate(
    SIGNED_SETUP_CASES.staleA,
    "account-balance",
  );
  return [
    {
      attributionKind: "exact-case",
      id: "recent-bank",
      title: "Recent bank change",
      caseRef: "GC-03 / GC-04",
      facts: `Same request · changed ${recentObservedAt} · ${ageDays(SIGNED_SETUP_CASES.recentA.trigger.asOf, recentObservedAt)} days ago · independent verification absent`,
      groupId: "bank-change",
      selectionEffects: bankImpactSelectionEffects(recentCases),
      attribution: impactAttribution(
        {
          id: "recent-bank",
          caseRef: "GC-03 / GC-04",
          scenarioId: "recent-bank-change-block",
        },
        recentCases,
      ),
    },
    {
      attributionKind: "universal-rule",
      id: "stale-withdrawals",
      title: "Stale planned-withdrawal evidence",
      caseRef: "GC-09",
      facts: `Planned-withdrawal evidence observed ${staleObservedAt} · ${ageDays(SIGNED_SETUP_CASES.staleA.trigger.asOf, staleObservedAt)} days old`,
      universalEffect: `Available cash remains fresh as of ${staleAvailableObservedAt}. Refresh the planned-withdrawal snapshot before reevaluation.`,
    },
    {
      attributionKind: "exact-case",
      id: "verified-bank",
      title: "Verified bank instruction",
      caseRef: SMITHS_LIQUIDITY.caseRef,
      facts: `Same ${usd(SMITHS_LIQUIDITY.requestMinor)} request · bank instruction independently verified`,
      groupId: "threshold",
      attribution: impactAttribution(
        {
          id: "verified-bank",
          caseRef: SMITHS_LIQUIDITY.caseRef,
          scenarioId: "safe-proceed",
        },
        safeCases,
      ),
    },
    {
      attributionKind: "exact-case",
      id: "low-headroom",
      title: "Low headroom",
      caseRef: LOW_HEADROOM_LIQUIDITY.caseRef,
      facts: factsLine(LOW_HEADROOM_LIQUIDITY),
      groupId: "reserve",
      attribution: impactAttribution(
        {
          id: "low-headroom",
          caseRef: LOW_HEADROOM_LIQUIDITY.caseRef,
          scenarioId: null,
        },
        lowHeadroomCases,
        ["firm-b"],
      ),
    },
    {
      attributionKind: "universal-rule",
      id: "material-change",
      title: "Material change after approval",
      caseRef: "GC-15",
      facts: pendingDistributionDeltaSentence(
        GC15_PENDING_DISTRIBUTION,
      ),
      universalEffect: `The pending approved amount changes from ${usd(GC15_PENDING_DISTRIBUTION.before.amountMinor)} to ${usd(GC15_PENDING_DISTRIBUTION.after.amountMinor)}. Prior authority is voided for both firms, and evaluation reruns against the changed bundle.`,
    },
  ];
}
