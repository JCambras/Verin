import {
  hashCanonicalPreimage,
  toJsonValue,
} from "./decision-identity";
import {
  APPROVAL_CLOCKS,
  BANK_INSTRUCTION,
  CANONICAL_REQUEST,
  DEMO_NOW,
  FIRMS,
  GC15_PENDING_DISTRIBUTION,
  LOW_HEADROOM_LIQUIDITY,
  OBSERVED_GC09_BALANCE,
  OBSERVED_STALE,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  PLANNED_WITHDRAWAL_STALE_AGE_DAYS,
  SMITHS_LIQUIDITY,
  pendingDistributionDeltaSentence,
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
  type ChoiceEffectVM,
  type MoneyMovementSetupVM,
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

function impactAttribution(
  impact: {
    readonly id: string;
    readonly caseRef: string;
    readonly scenarioId: string | null;
    readonly request: unknown;
    readonly evidence: unknown;
    readonly evaluationEvidence: DecisionEvidenceSnapshot;
    readonly liquidity?: SignedLiquidityCase;
  },
  signedImpact: typeof impact = impact,
  signedFirms: readonly SetupFirmId[] = SETUP_FIRM_IDS,
): NonNullable<
  MoneyMovementSetupVM["impacts"][number]["attribution"]
> {
  const materialInputHash = (
    value: typeof impact,
    firmId: SetupFirmId,
    signed: boolean,
  ) => {
    const evaluation = evaluateSetupPolicy(
      DEFAULT_SETUP_SELECTIONS,
      firmId,
      value.evaluationEvidence,
      value.liquidity,
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
      impactId: value.id,
      caseRef: value.caseRef,
      scenarioId: value.scenarioId,
      firmId,
      request: value.request,
      evidence: value.evidence,
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
          impact,
          firmId,
          false,
        ),
        signedMaterialInputHash: signedFirms.includes(firmId)
          ? materialInputHash(
              signedImpact,
              firmId,
              true,
            )
          : null,
        signedSelectionKey: setupFirmSelectionKey(
          DEFAULT_SETUP_SELECTIONS[firmId],
        ),
      },
    ]),
  ) as NonNullable<
    MoneyMovementSetupVM["impacts"][number]["attribution"]
  >;
}

function bankImpactEffect(
  selections: SetupSelections,
  firmId: SetupFirmId,
  evidence: DecisionEvidenceSnapshot,
): ChoiceEffectVM {
  const evaluated = evaluateSetupPolicy(
    selections,
    firmId,
    evidence,
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
  evidence: DecisionEvidenceSnapshot,
): NonNullable<
  MoneyMovementSetupVM["impacts"][number]["selectionEffects"]
> {
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
                  evidence,
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

export function buildSetupImpacts(
  evidence: DecisionEvidenceSnapshot,
): MoneyMovementSetupVM["impacts"] {
  const signedRecentBankEvidence = decisionEvidenceSnapshotFor(
    scenarioById("recent-bank-change-block"),
  );
  const signedSafeEvidence = decisionEvidenceSnapshotFor(
    scenarioById("safe-proceed"),
  );
  return [
    {
      id: "recent-bank",
      title: "Recent bank change",
      caseRef: "GC-03 / GC-04",
      facts: `Same request · changed ${BANK_INSTRUCTION.changedOn} · ${BANK_INSTRUCTION.changedAgeDays} days ago · independent verification absent`,
      groupId: "bank-change",
      selectionEffects: bankImpactSelectionEffects(evidence),
      attribution: impactAttribution(
        {
          id: "recent-bank",
          caseRef: "GC-03 / GC-04",
          scenarioId: "recent-bank-change-block",
          request: CANONICAL_REQUEST,
          evidence,
          evaluationEvidence: evidence,
        },
        {
          id: "recent-bank",
          caseRef: "GC-03 / GC-04",
          scenarioId: "recent-bank-change-block",
          request: CANONICAL_REQUEST,
          evidence: signedRecentBankEvidence,
          evaluationEvidence: signedRecentBankEvidence,
        },
      ),
    },
    {
      id: "stale-withdrawals",
      title: "Stale planned-withdrawal evidence",
      caseRef: "GC-09",
      facts: `Planned-withdrawal evidence observed ${OBSERVED_STALE} · ${PLANNED_WITHDRAWAL_STALE_AGE_DAYS} days old`,
      groupId: null,
      universalEffect: `Available cash remains fresh as of ${OBSERVED_GC09_BALANCE}. Refresh the planned-withdrawal snapshot before reevaluation.`,
    },
    {
      id: "verified-bank",
      title: "Verified bank instruction",
      caseRef: SMITHS_LIQUIDITY.caseRef,
      facts: `Same ${usd(SMITHS_LIQUIDITY.requestMinor)} request · bank instruction independently verified`,
      groupId: "threshold",
      attribution: impactAttribution({
        id: "verified-bank",
        caseRef: SMITHS_LIQUIDITY.caseRef,
        scenarioId: "safe-proceed",
        request: CANONICAL_REQUEST,
        evidence: signedSafeEvidence,
        evaluationEvidence: signedSafeEvidence,
      }),
    },
    {
      id: "low-headroom",
      title: "Low headroom",
      caseRef: LOW_HEADROOM_LIQUIDITY.caseRef,
      facts: factsLine(LOW_HEADROOM_LIQUIDITY),
      groupId: "reserve",
      attribution: impactAttribution({
        id: "low-headroom",
        caseRef: LOW_HEADROOM_LIQUIDITY.caseRef,
        scenarioId: null,
        request: {
          ...CANONICAL_REQUEST,
          amountMinor: LOW_HEADROOM_LIQUIDITY.requestMinor,
        },
        evidence: {
          availableMinor: LOW_HEADROOM_LIQUIDITY.availableMinor,
          pendingMinor: LOW_HEADROOM_LIQUIDITY.pendingMinor,
          plannedMonthlyMinor:
            PLANNED_WITHDRAWAL_MONTHLY_MINOR,
        },
        evaluationEvidence: signedSafeEvidence,
        liquidity: LOW_HEADROOM_LIQUIDITY,
      }, undefined, ["firm-b"]),
    },
    {
      id: "material-change",
      title: "Material change after approval",
      caseRef: "GC-15",
      facts: pendingDistributionDeltaSentence(
        GC15_PENDING_DISTRIBUTION,
      ),
      groupId: null,
      universalEffect: `The pending approved amount changes from ${usd(GC15_PENDING_DISTRIBUTION.before.amountMinor)} to ${usd(GC15_PENDING_DISTRIBUTION.after.amountMinor)}. Prior authority is voided for both firms, and evaluation reruns against the changed bundle.`,
    },
  ];
}
