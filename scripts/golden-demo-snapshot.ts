import { formatMetricValue, type DisplayMetric } from "@contracts/metric";
import {
  MONEY_CURRENCY,
  RESERVE_CADENCE,
  headroomMinor as calculateHeadroomMinor,
} from "@contracts/money-movement";
import { buildExecution, buildVerification } from "../src/app/demo/build-outcome";
import { getJourney } from "../src/app/demo/journey";
import {
  amountMetric,
  headroomMetric,
  headroomMinor,
  reserveFloorMetric,
  reserveFloorMinor,
  buildStages,
} from "../src/app/demo/build-decision";
import {
  DRAFT_RESERVE_MONTHS,
  buildPolicyAuthoring,
} from "../src/app/demo/build-policy-authoring";
import { buildComparison } from "../src/app/demo/build-summary";
import {
  CANONICAL_REQUEST,
  FIRMS,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SCENARIOS,
  bindExactSourceCase,
  dispositionFor,
  hasSignedInvalidationAuthority,
  launcherVariantsFor,
  liquidityAuthorityFor,
  plannedWithdrawalEvidenceFor,
  requestFor,
  sourceCaseFor,
  sourceCaseIdsFor,
} from "../src/app/demo/data";
import { formatDemoInstant, timelineFor } from "../src/app/demo/timeline";
import {
  SIGNED_CASE_VARIANTS,
  type SignedCaseVariant,
} from "../src/app/demo/signed-cases";
import type {
  DemoSemanticSnapshot,
  DisplayedDecision,
  RenderedMoney,
  SourceTimeline,
  SourceTimelineEvent,
  VisibleEvidenceProjection,
} from "./golden-demo-semantics.lib";

const DRAFT_FLOOR_LABEL = "Smith household reserve floor";
const DRAFT_HEADROOM_LABEL = "Available after reserve";
const DRAFT_REQUEST_LABEL = "This request";

/** Run a real demo money metric through the SHIPPED renderer and carry both sides
 * across to the fence. Reading the constant would only prove the constant; the
 * fence inverts this rendered string with integer arithmetic, so a divisor changed
 * anywhere on the display path shows up as a mismatch rather than a rounding blur. */
function renderMoney(money: DisplayMetric): RenderedMoney {
  return { minor: Number(money.value), rendered: formatMetricValue(money) };
}

/** Surface 11's simulated policy draft, as it is actually emitted for a branch. */
function draftSimulation(
  policyAuthoring: ReturnType<typeof buildPolicyAuthoring>,
) {
  const rows = policyAuthoring.simulationDelta;
  const numberAt = (label: string): number | null => {
    const value = rows.find((row) => row.label === label)?.after.metric?.value;
    return typeof value === "number" ? value : null;
  };
  return {
    floorMinor: numberAt(DRAFT_FLOOR_LABEL),
    headroomMinor: numberAt(DRAFT_HEADROOM_LABEL),
    disposition: rows.find((row) => row.label === DRAFT_REQUEST_LABEL)?.after.badge?.status ?? null,
  };
}

function signedTrigger(sourceCase: SignedCaseVariant | null) {
  return sourceCase ? { ...sourceCase.trigger } : null;
}

function visibleEvidenceProjection(
  sourceBinding: {
    evidenceKind: string;
    subjectRef: string;
    observedAt: string;
    retrievedAt: string;
    freshness: string;
    source: string;
    provenance: string;
    summary: string;
    liquidityPhase: string | null;
    observedAbsent: boolean;
    displayValue: {
      valueMinor: number;
      unit: "USD" | "USD/month";
    } | null;
  },
  renderedValueMinor: number | null,
  renderedFormat: DisplayMetric["format"] | null,
): VisibleEvidenceProjection {
  return {
    evidenceKind: sourceBinding.evidenceKind,
    subjectRef: sourceBinding.subjectRef,
    observedAt: sourceBinding.observedAt,
    retrievedAt: sourceBinding.retrievedAt,
    freshness: sourceBinding.freshness,
    source: sourceBinding.source,
    provenance: sourceBinding.provenance,
    summary: sourceBinding.summary,
    liquidityPhase: sourceBinding.liquidityPhase,
    observedAbsent: sourceBinding.observedAbsent,
    displayValueMinor: sourceBinding.displayValue?.valueMinor ?? null,
    displayUnit: sourceBinding.displayValue?.unit ?? null,
    renderedValueMinor,
    renderedFormat,
  };
}

/** Every decision the demo actually renders, with the liquidity arithmetic behind it. */
function displayedDecisions(): DisplayedDecision[] {
  return SCENARIOS.flatMap((baseScenario) =>
    Object.values(FIRMS).flatMap((firm) => {
      const caseIds = sourceCaseIdsFor(baseScenario, firm.id);
      return (caseIds.length ? caseIds : [undefined]).flatMap((caseId) => {
      const scenario = caseId
        ? bindExactSourceCase(baseScenario, firm.id, caseId)
        : baseScenario;
      const authority = liquidityAuthorityFor(scenario, firm.id);
      const sourceCase = sourceCaseFor(scenario, firm.id);
      const journey = getJourney(
        scenario.id,
        firm.id,
        "initial",
        caseId,
      );
      const simulated = draftSimulation(journey.policyAuthoring);
      const visibleEvidence = journey.evidence.rows.flatMap((row) =>
        row.kind === "fact" || row.kind === "metric"
          ? [
              visibleEvidenceProjection(
                row.sourceBinding,
                row.kind === "metric" &&
                  typeof row.metric.value === "number"
                  ? row.metric.value
                  : null,
                row.kind === "metric" ? row.metric.format : null,
              ),
            ]
          : [],
      );
      const workspaceAccounts = journey.workspace.accounts.map((account) => {
        const row = account.evidence;
        return {
          evidence: visibleEvidenceProjection(
            row.sourceBinding,
            row.kind === "metric" &&
              typeof row.metric.value === "number"
              ? row.metric.value
              : null,
            row.kind === "metric" ? row.metric.format : null,
          ),
          unavailableFields: [...account.unavailableFields],
        };
      });
      const dispositionSource = journey.recommendation.disposition.source;
      const prohibition = dispositionSource
        ? {
            kind: dispositionSource.kind,
            id: dispositionSource.id,
            versionId: dispositionSource.ref,
            scope: dispositionSource.scope,
            reasonCode: dispositionSource.reasonCode,
            explanation: journey.recommendation.disposition.why.reason,
          }
        : null;
      const initial = authority.kind === "signed" ? authority.initialDecision : null;
      const revalidation = authority.kind === "signed" ? authority.preExecutionRevalidation : undefined;
      const planned = plannedWithdrawalEvidenceFor(
        scenario,
        firm.id,
      );
      const reserveFloor = reserveFloorMinor(scenario, firm);
      const primary: DisplayedDecision = {
        scenarioId: scenario.id,
        firmId: firm.id,
        decisionRole: "primary",
        disposition: dispositionFor(scenario, firm.id),
        sourceCaseId: sourceCase?.caseId ?? null,
        requestAt: journey.intent.requestAt.provenance.asOf,
        requestAmountMinor: requestFor(scenario, firm.id).amountMinor,
        signedTrigger: signedTrigger(sourceCase),
        visibleEvidence,
        workspaceAccounts,
        prohibition,
        policyTraceRows: journey.policyTrace.rows.map(
          ({ rule, result, version }) => ({ rule, result, version }),
        ),
        recordPrecedenceRows: journey.record.precedence.map(
          ({ rule, result, version }) => ({ rule, result, version }),
        ),
        policyBindings: {
          domainConfigVersion: journey.policyTrace.domainConfigVersion,
          firmPolicyVersion: journey.policyTrace.firmPolicyVersion,
          householdInstructionVersions: [
            ...journey.policyTrace.householdInstructionVersions,
          ],
          regulatoryVersion: journey.policyTrace.regulatoryVersion,
          recordPolicyVersion: journey.record.hashes.policyVersion,
          recordInstructionVersion:
            journey.record.hashes.instructionVersion,
        },
        comparisonDescription: journey.comparison.description,
        comparisonDispositionReason:
          journey.comparison.rows.find(
            (row) => row.dimension === "Disposition for this request",
          )?.why?.reason ?? null,
        approvalGateRestatement:
          journey.approvals?.gate.restatement ?? null,
        liquidityAuthorityMissing: authority.kind === "missing" ? authority.reason : null,
        availableCashMinor: initial?.availableCashMinor ?? null,
        pendingActivityMinor: initial?.pendingActivityMinor ?? null,
        plannedWithdrawalMonthlyMinor:
          planned?.displayValue?.valueMinor ?? null,
        reserveFloorMinor: reserveFloor,
        headroomMinor: headroomMinor(scenario, firm),
        revalidationAvailableCashMinor: revalidation?.availableCashMinor ?? null,
        revalidationPendingActivityMinor: revalidation?.pendingActivityMinor ?? null,
        simulatedFloorMinor: simulated.floorMinor,
        simulatedHeadroomMinor: simulated.headroomMinor,
        simulatedDisposition: simulated.disposition,
      };
      const related =
        authority.kind === "signed"
          ? (authority.relatedDecisions ?? [])
              .filter(
                (decision) =>
                  !sourceCaseIdsFor(baseScenario, firm.id).includes(
                    decision.sourceCaseId as SignedCaseVariant["caseId"],
                  ),
              )
              .map(
              (decision): DisplayedDecision => {
                const relatedSource = SIGNED_CASE_VARIANTS.find(
                  (variant) => variant.caseId === decision.sourceCaseId,
                );
                const relatedScenario = bindExactSourceCase(
                  baseScenario,
                  firm.id,
                  decision.sourceCaseId as SignedCaseVariant["caseId"],
                );
                const relatedPlanned = plannedWithdrawalEvidenceFor(
                  relatedScenario,
                  firm.id,
                );
                const relatedFloor = reserveFloorMinor(
                  relatedScenario,
                  firm,
                );
                return {
                  scenarioId: scenario.id,
                  firmId: firm.id,
                  decisionRole: "competing-sibling",
                  disposition: decision.disposition,
                  sourceCaseId: decision.sourceCaseId,
                  requestAt: decision.requestAt,
                  requestAmountMinor: decision.requestAmountMinor,
                  signedTrigger: signedTrigger(relatedSource ?? null),
                  visibleEvidence: [],
                  workspaceAccounts: [],
                  prohibition: null,
                  policyTraceRows: [],
                  recordPrecedenceRows: [],
                  policyBindings: {
                    domainConfigVersion:
                      relatedSource?.policyVersions
                        .domainConfigVersionId ??
                      "Exact signed source unavailable",
                    firmPolicyVersion:
                      relatedSource?.policyVersions.firmPolicyVersionId ??
                      "Exact signed source unavailable",
                    householdInstructionVersions: [
                      ...(relatedSource?.policyVersions
                        .householdInstructionVersionIds ?? []),
                    ],
                    regulatoryVersion:
                      relatedSource?.policyVersions.regulatoryVersionId ??
                      null,
                    recordPolicyVersion:
                      relatedSource?.policyVersions.firmPolicyVersionId ??
                      "Exact signed source unavailable",
                    recordInstructionVersion:
                      relatedSource?.policyVersions
                        .householdInstructionVersionIds.join(", ") ||
                      "Exact signed source unavailable",
                  },
                  comparisonDescription: null,
                  comparisonDispositionReason: null,
                  approvalGateRestatement: null,
                  liquidityAuthorityMissing: null,
                  availableCashMinor:
                    decision.initialDecision.availableCashMinor,
                  pendingActivityMinor:
                    decision.initialDecision.pendingActivityMinor,
                  plannedWithdrawalMonthlyMinor:
                    relatedPlanned?.displayValue?.valueMinor ?? null,
                  reserveFloorMinor: relatedFloor,
                  headroomMinor:
                    relatedFloor === null
                      ? null
                      : calculateHeadroomMinor(
                          decision.initialDecision.availableCashMinor,
                          decision.initialDecision.pendingActivityMinor,
                          relatedFloor,
                        ),
                  revalidationAvailableCashMinor: null,
                  revalidationPendingActivityMinor: null,
                  simulatedFloorMinor: null,
                  simulatedHeadroomMinor: null,
                  simulatedDisposition: null,
                };
              },
            )
          : [];
      return [primary, ...related];
      });
    }),
  );
}

function sourceTimelines(): SourceTimeline[] {
  const event = (
    kind: string,
    instant: string,
    display: string,
    includeSeconds = false,
  ): SourceTimelineEvent => ({
    kind,
    instant,
    display,
    renderedInstant: formatDemoInstant(instant, undefined, includeSeconds),
  });
  return SCENARIOS.flatMap((baseScenario) =>
    Object.values(FIRMS).flatMap((firm) => {
      const caseIds = sourceCaseIdsFor(baseScenario, firm.id);
      return (caseIds.length ? caseIds : [undefined]).flatMap((caseId) => {
      const scenario = caseId
        ? bindExactSourceCase(baseScenario, firm.id, caseId)
        : baseScenario;
      const authority = liquidityAuthorityFor(scenario, firm.id);
      const sourceCase = sourceCaseFor(scenario, firm.id);
      if (!sourceCase) return [];
      const journey = getJourney(
        scenario.id,
        firm.id,
        hasSignedInvalidationAuthority(scenario, firm.id)
          ? "revalidated"
          : "initial",
        caseId,
      );
      const lifecycleEvents = journey.record.lifecycle.map((lifecycleEvent, index) =>
        event(
          lifecycleEvent.type === "EvidenceSnapshotRecorded" && index > 0
            ? "revalidation"
            : lifecycleEvent.type,
          lifecycleEvent.timestampIso,
          `${lifecycleEvent.display} · ${lifecycleEvent.note}`,
          true,
        ),
      );
      const primaryEvents: SourceTimelineEvent[] = lifecycleEvents.length > 0
        ? [
            event(
              "request",
              sourceCase.trigger.requestAt,
              `Signed trigger ${formatDemoInstant(sourceCase.trigger.requestAt)}`,
            ),
            ...lifecycleEvents,
          ]
        : [
            event(
              "request",
              sourceCase.trigger.requestAt,
              `Signed trigger ${formatDemoInstant(sourceCase.trigger.requestAt)}`,
            ),
            ...[
              event(
                "DecisionRecorded",
                journey.record.header.createdAtIso,
                journey.record.header.createdAt,
                true,
              ),
              ...(journey.record.approvalStages ?? []).flatMap((stage) => [
                ...stage.actors.flatMap((actor) =>
                  actor.timestampIso
                    ? [
                        event(
                          "ApprovalRecorded",
                          actor.timestampIso,
                          actor.statusLabel,
                        ),
                      ]
                    : [],
                ),
                ...(stage.authorityEvents ?? []).map((authorityEvent) =>
                  event(
                    authorityEvent.type,
                    authorityEvent.timestamp,
                    authorityEvent.display,
                  ),
                ),
              ]),
              ...(journey.safety
                ? [
                    event(
                      "revalidation",
                      journey.safety.revalidatedAtIso,
                      journey.safety.revalidatedAt.display,
                    ),
                    ...(journey.safety.reservationAtIso &&
                    journey.safety.reservationAt
                      ? [
                          event(
                            "ReservationCreated",
                            journey.safety.reservationAtIso,
                            journey.safety.reservationAt,
                            true,
                          ),
                        ]
                      : []),
                  ]
                : []),
              ...(scenario.spec.partial && journey.execution
                ? [
                    event(
                      "ExecutionStarted",
                      journey.execution.rows[0]!.timestampIso,
                      journey.execution.rows[0]!.timestamp,
                    ),
                    event(
                      "ExecutionPartiallySucceeded",
                      journey.execution.rows[1]!.timestampIso,
                      `${journey.execution.rows[0]!.timestamp} · ${journey.execution.rows[1]!.timestamp}`,
                    ),
                    event(
                      "StatusObserved",
                      journey.execution.rows[1]!.timestampIso,
                      journey.execution.rows[1]!.timestamp,
                    ),
                  ]
                : (journey.execution?.rows ?? []).map((row, index) =>
                    event(
                      index === 0
                        ? "ExecutionStarted"
                        : "execution-receipt",
                      row.timestampIso,
                      row.timestamp,
                    ),
                  )),
              ...(journey.verification?.exceptionDecision
                ? [
                    event(
                      journey.verification.exceptionDecision.eventType,
                      journey.verification.exceptionDecision.requestedAtIso,
                      `${journey.verification.exceptionDecision.requestedAt} · ${journey.verification.exceptionDecision.summary}`,
                      true,
                    ),
                  ]
                : []),
              ...(journey.verification?.appended ?? []).map((row) =>
                event("verification-appended", row.timestampIso, row.timestamp),
              ),
            ],
          ];
      const primary: SourceTimeline = {
        sourceCaseId: sourceCase.caseId,
        scenarioId: scenario.id,
        firmId: firm.id,
        requestAt: sourceCase.trigger.requestAt,
        events: primaryEvents,
      };
      const related = (
        authority.kind === "signed"
          ? (authority.relatedDecisions ?? [])
          : []
      )
        .filter(
          (relatedAuthority) =>
            !sourceCaseIdsFor(baseScenario, firm.id).includes(
              relatedAuthority.sourceCaseId as SignedCaseVariant["caseId"],
            ),
        )
        .flatMap(
        (relatedAuthority) => {
          const relatedSource = SIGNED_CASE_VARIANTS.find(
            (variant) => variant.caseId === relatedAuthority.sourceCaseId,
          );
          const relatedDecision = journey.safety?.checks.find(
            (check) =>
              check.relatedDecision?.sourceCaseId ===
              relatedAuthority.sourceCaseId,
          )?.relatedDecision;
          const latestEvidenceAt = relatedSource?.evidence
            .map((evidence) => evidence.retrievedAt)
            .sort()
            .at(-1);
          if (!relatedDecision || !latestEvidenceAt) return [];
          return [
            {
              sourceCaseId: relatedAuthority.sourceCaseId,
              scenarioId: scenario.id,
              firmId: firm.id,
              requestAt: relatedAuthority.requestAt,
              events: [
                event(
                  "request",
                  relatedDecision.requestAtIso,
                  relatedDecision.requestAt,
                  true,
                ),
                event(
                  "EvidenceSnapshotRecorded",
                  latestEvidenceAt,
                  formatDemoInstant(latestEvidenceAt, undefined, true),
                  true,
                ),
                event(
                  "DecisionRecorded",
                  relatedDecision.decidedAtIso,
                  relatedDecision.decidedAt,
                  true,
                ),
              ],
            } satisfies SourceTimeline,
          ];
        },
      );
      return [primary, ...related];
      });
    }),
  );
}

function recordIdentities(): DemoSemanticSnapshot["recordIdentities"] {
  return SCENARIOS.flatMap((scenario) =>
    launcherVariantsFor(scenario).flatMap(
      ({ firmId, sourceCaseId }) => {
        const selected = sourceCaseId
          ? bindExactSourceCase(scenario, firmId, sourceCaseId)
          : scenario;
        const passes: Array<"initial" | "revalidated"> =
          hasSignedInvalidationAuthority(selected, firmId)
            ? ["initial", "revalidated"]
            : ["initial"];
        return passes.map((pass) => {
          const journey = getJourney(
            scenario.id,
            firmId,
            pass,
            sourceCaseId ?? undefined,
          );
          const record = journey.record;
          return {
            routeScenarioId: scenario.id,
            routeFirmId: firmId,
            routeSourceCaseId: sourceCaseId,
            routePass: pass,
            headerScenarioId: record.header.scenarioId,
            headerFirmId: record.header.firmId,
            headerSourceCaseId: record.header.sourceCaseId,
            headerPass: record.header.pass,
            decisionId: record.header.decisionId,
            auditPosition: record.hashes.auditPosition,
            headerCreatedAtIso: record.header.createdAtIso,
            decisionEventInstants: record.lifecycle
              .filter((event) => event.type === "DecisionRecorded")
              .map((event) => event.timestampIso),
            decisionBindings: record.decisionBindings.map((binding) => ({
              ...binding,
            })),
            approvalBinding: journey.approvals?.binding ?? null,
          };
        });
      },
    ),
  );
}

/** Project the actual demo constants and emitted rows into the pure fence. */
export function loadDemoSemanticSnapshot(): DemoSemanticSnapshot {
  const firms = Object.values(FIRMS);
  const safeScenario = SCENARIOS.find(
    (scenario) => scenario.id === "safe-proceed",
  )!;
  const comparison = buildComparison(safeScenario);
  const comparisonRow = (dimension: string) =>
    comparison.rows.find((row) => row.dimension === dimension);
  const renderedFirmPolicies = comparison.columns.map(
    (column, index) => {
      const side = index === 0 ? "a" : "b";
      const cell = (dimension: string) =>
        comparisonRow(dimension)?.[side];
      const metricValue = (dimension: string) => {
        const value = cell(dimension)?.metric?.value;
        return typeof value === "number" ? value : null;
      };
      return {
        firmId: column.firmId,
        reserveFloorMinor: metricValue("Cash-reserve requirement"),
        dualApprovalThresholdMinor: metricValue(
          "Dual-approval threshold",
        ),
        quorum: cell("Quorum at this amount")?.display ?? null,
        bankChangeHandling:
          cell("Recent bank-change handling")?.display ?? null,
      };
    },
  );
  const reserveMetrics = SCENARIOS.flatMap((scenario) =>
    firms.flatMap((firm) => {
      const floor = reserveFloorMetric(firm, scenario);
      return floor ? [floor] : [];
    }),
  );
  const moneyMetrics = [
    amountMetric(safeScenario, FIRMS["firm-a"]!),
    ...reserveMetrics,
    ...SCENARIOS.flatMap((scenario) =>
      firms.flatMap((firm) => {
        const headroom = headroomMetric(scenario, firm);
        return headroom ? [headroom] : [];
      }),
    ),
  ];
  const lapseScenario = SCENARIOS.find((scenario) => scenario.id === "specialist-review-expiration")!;
  const authorityLapseEvents = buildStages(lapseScenario, FIRMS["firm-a"]!, "final")
    .flatMap((stage) => stage.authorityEvents ?? [])
    .map(({ type, timestamp }) => ({ type, timestamp }));
  const invalidationJourney = getJourney("approval-invalidation", "firm-a");
  const initialSurfaceMoneyMinor = [
    invalidationJourney.workspace.liquidity?.value,
    invalidationJourney.workspace.plannedMonthlyWithdrawal?.value,
    ...invalidationJourney.evidence.rows.flatMap((row) => row.kind === "metric" ? [row.metric.value] : []),
    ...(invalidationJourney.recommendation.disposition.figures ?? []).map((figure) => figure.metric.value),
    ...(invalidationJourney.approvals?.gate.figures ?? []).map((figure) => figure.metric.value),
  ].flatMap((value) => typeof value === "number" ? [value] : []);
  const invalidation = invalidationJourney.safety?.invalidation;
  const revalidatedInvalidationJourney = getJourney(
    "approval-invalidation",
    "firm-a",
    "revalidated",
  );
  const unsupportedInvalidationJourney = getJourney(
    "approval-invalidation",
    "firm-b",
  );
  const refreshedEvidencePendingMinor =
    revalidatedInvalidationJourney.evidence.rows.find(
      (row) =>
        row.kind === "metric" &&
        row.sourceBinding.evidenceKind === "pending-actions" &&
        row.sourceBinding.liquidityPhase ===
          "pre-execution-revalidation",
    );
  const authorityPlan = (
    scenarioId: string,
    firmId: string,
    pass: "initial" | "revalidated",
  ): DemoSemanticSnapshot["authorityPlans"][number] => {
    const journey = getJourney(scenarioId, firmId, pass);
    return {
      scenarioId,
      firmId,
      pass,
      mode: journey.approvals?.mode ?? "staged",
      automaticAuthorityVisible:
        journey.approvals?.automaticAuthority !== null &&
        journey.approvals?.automaticAuthority !== undefined,
      bindingVisible:
        journey.approvals?.binding !== null &&
        journey.approvals?.binding !== undefined,
      satisfied: journey.approvals?.satisfied ?? false,
      stages: (journey.approvals?.stages ?? []).map((stage) => {
        const completed = stage.actors.filter((actor) => actor.status === "done");
        return {
          stageId: stage.stageId,
          order: stage.order,
          executionMode: stage.executionMode,
          eligibleRoleIds: [...stage.eligibleRoleIds],
          approvalsRequired: stage.approvalsRequired,
          distinctActorsRequired: stage.distinctActorsRequired,
          requesterMayApprove: stage.requesterMayApprove,
          expiresAfter: stage.expiresAfter,
          escalationPath: stage.escalationPath.map((escalation) => ({
            after: escalation.after,
            roleIds: [...escalation.roleIds],
            reasonCode: escalation.reasonCode,
          })),
          satisfied: stage.satisfied,
          completedActorIds: completed.map((actor) => actor.actorId),
          completedRoleIds: completed.map((actor) => actor.roleId),
        };
      }),
    };
  };
  const partialJourney = getJourney(
    "partial-salesforce-success",
    "firm-a",
  );
  const policyRows = buildPolicyAuthoring(
    SCENARIOS.find((scenario) => scenario.id === "approval-invalidation")!,
    FIRMS["firm-a"]!,
    "initial",
  ).simulationDelta;
  const policyHeadroom = policyRows.find(
    (row) => row.label === DRAFT_HEADROOM_LABEL,
  );
  const revalidatedPolicyHeadroom = buildPolicyAuthoring(
    SCENARIOS.find((scenario) => scenario.id === "approval-invalidation")!,
    FIRMS["firm-a"]!,
    "revalidated",
  ).simulationDelta.find(
    (row) => row.label === DRAFT_HEADROOM_LABEL,
  );
  const reservationCausality =
    SCENARIOS.flatMap((scenario) =>
      firms.flatMap((firm) => {
        const authority = liquidityAuthorityFor(scenario, firm.id);
        if (
          authority.kind !== "signed" ||
          !authority.relatedDecisions?.length
        ) {
          return [];
        }
        const journey = getJourney(scenario.id, firm.id);
        const reservationAt = journey.safety?.reservationAtIso;
        const executionAt =
          journey.execution === null
            ? null
            : timelineFor(scenario, firm).executionAt;
        if (!reservationAt || !executionAt) return [];
        return authority.relatedDecisions.map((related) => ({
          scenarioId: scenario.id,
          firmId: firm.id,
          sourceCaseId: authority.sourceCaseId,
          requestAt: authority.requestAt,
          decisionAt: journey.record.header.createdAtIso,
          reservationAt,
          executionAt,
          relatedSourceCaseId: related.sourceCaseId,
          relatedRequestAt: related.requestAt,
        }));
      }),
    );
  return {
    requestAmountMinor: CANONICAL_REQUEST.amountMinor,
    canonicalRequestAt: CANONICAL_REQUEST.requestedAt,
    canonicalRequest: { ...CANONICAL_REQUEST },
    plannedWithdrawalMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    moneyUnits: [...new Set(moneyMetrics.map((money) => money.format))],
    moneyRenders: moneyMetrics.map(renderMoney),
    currency: MONEY_CURRENCY,
    cadence: RESERVE_CADENCE,
    firms: firms.map((firm) => ({
      id: firm.id,
      reserveMonths: firm.reserveMonths,
      dualApprovalThresholdMinor: firm.dualApprovalThresholdMinor,
      approvalsRequired: firm.approvalsRequired,
      distinctActorsRequired: firm.distinctActorsRequired,
      eligibleRole: firm.eligibleRole,
      requesterConstraint: firm.requesterConstraint,
      bankChangeHandling: firm.bankChangeHandling,
      policyVersion: firm.policyVersion,
    })),
    renderedFirmPolicies,
    signedCaseVariants: SIGNED_CASE_VARIANTS.map((variant) => variant),
    decisions: displayedDecisions(),
    sourceTimelines: sourceTimelines(),
    recordIdentities: recordIdentities(),
    draftedReserveMonths: DRAFT_RESERVE_MONTHS,
    draftedReserveFloorMinor: draftSimulation(
      getJourney(SCENARIOS[0]!.id, "firm-a").policyAuthoring,
    ).floorMinor,
    executionTimelineStatuses: SCENARIOS.flatMap((scenario) =>
      firms.flatMap((firm) =>
        buildExecution(scenario, firm)?.rows.map((row) => row.status) ?? [],
      ),
    ),
    verificationTimelineStatuses: SCENARIOS.flatMap((scenario) =>
      firms.flatMap((firm) =>
        buildVerification(scenario, firm)?.appended.map((row) => row.status) ?? [],
      ),
    ),
    authorityLapseEvents,
    approvalInvalidationPhases: {
      initialSurfaceMoneyMinor,
      safetyBeforePendingMinor:
        typeof invalidation?.before.metric.value === "number" ? invalidation.before.metric.value : null,
      safetyAfterPendingMinor:
        typeof invalidation?.after.metric.value === "number" ? invalidation.after.metric.value : null,
      refreshedEvidencePendingMinor:
        refreshedEvidencePendingMinor?.kind === "metric" &&
        typeof refreshedEvidencePendingMinor.metric.value === "number"
          ? refreshedEvidencePendingMinor.metric.value
          : null,
    },
    executionGuards: SCENARIOS.flatMap((scenario) =>
      firms.map((firm) => {
        const initialJourney = getJourney(scenario.id, firm.id);
        const sourceCase = sourceCaseFor(scenario, firm.id);
        const journey =
          scenario.spec.invalidation &&
          sourceCase?.verification.reached === true
            ? getJourney(scenario.id, firm.id, "revalidated")
            : initialJourney;
        const authority = liquidityAuthorityFor(scenario, firm.id);
        return {
          scenarioId: scenario.id,
          firmId: firm.id,
          sourceCaseId: sourceCase?.caseId ?? null,
          signedLiquidityAuthority: authority.kind === "signed",
          exactBankInstructionEvidence:
            sourceCase?.evidence.some(
              (entry) => entry.evidenceKind === "bank-instruction",
            ) ?? false,
          safetyChecks:
            journey.safety?.checks.map(
              ({ label, status, statusLabel }) => ({
                label,
                status,
                statusLabel,
              }),
            ) ?? [],
          recordSafetyChecks:
            journey.record.safety?.checks.map(
              ({ label, status, statusLabel }) => ({
                label,
                status,
                statusLabel,
              }),
            ) ?? [],
          reservationVisible: Boolean(journey.safety?.reservationId),
          executionReached: journey.execution !== null,
          verificationReached: journey.verification !== null,
          executionEligibility: journey.safety?.executionEligibility
            ? {
                ...journey.safety.executionEligibility,
                reservations:
                  journey.safety.executionEligibility.reservations.map(
                    (reservation) => ({
                      ...reservation,
                      conflictKeys: [...reservation.conflictKeys],
                    }),
                  ),
                preconditions:
                  journey.safety.executionEligibility.preconditions.map(
                    (precondition) => ({
                      ...precondition,
                      requiredEvidence: [...precondition.requiredEvidence],
                    }),
                  ),
              }
            : sourceCase?.executionEligibility
              ? {
                  ...sourceCase.executionEligibility,
                  reservations: sourceCase.executionEligibility.reservations.map((reservation) => ({
                    ...reservation,
                    conflictKeys: [...reservation.conflictKeys],
                  })),
                  preconditions: sourceCase.executionEligibility.preconditions.map((precondition) => ({
                    ...precondition,
                    requiredEvidence: [...precondition.requiredEvidence],
                  })),
                }
              : null,
          polling: journey.verification
            ? {
                state: journey.verification.polling.state,
                latestObservationAtIso:
                  journey.verification.polling.latestObservationAtIso,
                nextPollAtIso: journey.verification.polling.nextPollAtIso,
                ...(journey.verification.polling.state === "stopped"
                  ? { reason: journey.verification.polling.reason }
                  : {}),
              }
            : null,
          exceptionDecision: journey.verification?.exceptionDecision
            ? {
                eventType: journey.verification.exceptionDecision.eventType,
                reason: journey.verification.exceptionDecision.reason,
                triggeringLedgerEvent:
                  journey.verification.exceptionDecision
                    .triggeringLedgerEvent,
              }
            : null,
          verificationProves:
            journey.verification?.proves.map((proof) => ({
              display: proof.display,
              ledgerEvent: proof.ledgerEvent,
              observedAtIso: proof.provenance.asOf,
            })) ?? [],
          verificationNotProvenYet: [
            ...(journey.verification?.notProvenYet ?? []),
          ],
          executionRows:
            journey.execution?.rows.map((row) => ({
              status: row.status,
              timestampIso: row.timestampIso,
            })) ?? [],
          verificationState: journey.verification
            ? { ...journey.verification.state }
            : null,
        };
      }),
    ),
    authorityPlans: [
      ...SCENARIOS.flatMap((scenario) =>
        firms.map((firm) => authorityPlan(scenario.id, firm.id, "initial")),
      ),
      authorityPlan("approval-invalidation", "firm-a", "revalidated"),
    ],
    reservationCausality,
    approvalInvalidationLifecycle: {
      initialEventTypes: invalidationJourney.record.lifecycle.map(
        (event) => event.type,
      ),
      initialEventInstants: invalidationJourney.record.lifecycle.map(
        (event) => event.timestampIso,
      ),
      revalidatedEventTypes:
        revalidatedInvalidationJourney.record.lifecycle.map(
          (event) => event.type,
        ),
      revalidatedEventInstants:
        revalidatedInvalidationJourney.record.lifecycle.map(
        (event) => event.timestampIso,
      ),
      originalApprovals:
        invalidationJourney.approvals?.stages.flatMap((stage) =>
          stage.actors.filter((actor) => actor.status === "done"),
        ).length ?? 0,
      freshApprovals:
        revalidatedInvalidationJourney.approvals?.stages.flatMap((stage) =>
          stage.actors.filter((actor) => actor.status === "done"),
        ).length ?? 0,
      freshPlanSatisfied:
        revalidatedInvalidationJourney.approvals?.satisfied ?? false,
      freshActorIds:
        revalidatedInvalidationJourney.approvals?.stages.flatMap((stage) =>
          stage.actors
            .filter((actor) => actor.status === "done")
            .map((actor) => actor.actorId),
        ) ?? [],
      freshRoleIds:
        revalidatedInvalidationJourney.approvals?.stages.flatMap((stage) =>
          stage.actors
            .filter((actor) => actor.status === "done")
            .map((actor) => actor.roleId),
        ) ?? [],
      initialReservationVisible:
        Boolean(invalidationJourney.safety?.reservationId),
      initialExecutionReached: invalidationJourney.execution !== null,
      initialVerificationReached: invalidationJourney.verification !== null,
      revalidatedReservationVisible:
        Boolean(revalidatedInvalidationJourney.safety?.reservationId),
      revalidatedExecutionReached:
        revalidatedInvalidationJourney.execution !== null,
      revalidatedVerificationReached:
        revalidatedInvalidationJourney.verification !== null,
      revalidatedExecutionStatuses:
        revalidatedInvalidationJourney.execution?.rows.map(
          (row) => row.status,
        ) ?? [],
      revalidatedVerificationProves:
        revalidatedInvalidationJourney.verification?.proves.map(
          (proof) => proof.display,
        ) ?? [],
      initialComparisonHeadroomMinor:
        invalidationJourney.comparison.rows.find(
          (row) =>
            row.dimension === "Available after reserve" &&
            row.a.metric !== undefined,
        )?.a.metric?.value ?? null,
      revalidatedComparisonHeadroomMinor:
        revalidatedInvalidationJourney.comparison.rows.find(
          (row) =>
            row.dimension === "Available after reserve" &&
            row.a.metric !== undefined,
        )?.a.metric?.value ?? null,
      initialRecordBindings: invalidationJourney.record.decisionBindings.map(
        (binding) => ({ ...binding }),
      ),
      revalidatedRecordBindings:
        revalidatedInvalidationJourney.record.decisionBindings.map(
        (binding) => ({ ...binding }),
      ),
      initialRecordEvidencePhases:
        invalidationJourney.record.evidence.flatMap((row) =>
          row.kind === "metric" || row.kind === "fact"
            ? [row.sourceBinding.liquidityPhase]
            : [],
        ),
      revalidatedRecordEvidencePhases:
        revalidatedInvalidationJourney.record.evidence.flatMap((row) =>
          row.kind === "metric" || row.kind === "fact"
            ? [row.sourceBinding.liquidityPhase]
            : [],
        ),
      initialRecordExecutionReached:
        invalidationJourney.record.execution !== null,
      initialRecordVerificationReached:
        invalidationJourney.record.verification !== null,
      initialRecordEligibilityVisible:
        invalidationJourney.record.executionEligibility !== null ||
        Boolean(invalidationJourney.record.safety?.executionEligibility),
      revalidatedRecordExecutionReached:
        revalidatedInvalidationJourney.record.execution !== null,
      revalidatedRecordVerificationReached:
        revalidatedInvalidationJourney.record.verification !== null,
      revalidatedRecordEligibilityVisible:
        revalidatedInvalidationJourney.record.executionEligibility !== null ||
        Boolean(
          revalidatedInvalidationJourney.record.safety?.executionEligibility,
        ),
      initialRecommendationSource:
        invalidationJourney.recommendation.recommendation?.source.display ??
        null,
      revalidatedRecommendationSource:
        revalidatedInvalidationJourney.recommendation.recommendation?.source
          .display ?? null,
      initialRecommendationAlternativeCount:
        invalidationJourney.recommendation.alternatives.length,
      revalidatedRecommendationAlternativeCount:
        revalidatedInvalidationJourney.recommendation.alternatives.length,
      originalApprovalBinding:
        invalidationJourney.approvals?.binding ?? null,
      freshApprovalBinding:
        revalidatedInvalidationJourney.approvals?.binding ?? null,
      unsupportedFirmEventCount:
        unsupportedInvalidationJourney.record.lifecycle.length,
    },
    partialReceipt: {
      completedParts:
        partialJourney.execution?.rows
          .filter((row) => row.status === "completed")
          .map((row) => row.step) ?? [],
      incompleteParts:
        partialJourney.execution?.rows
          .filter((row) => row.status === "unknown")
          .map((row) => row.step) ?? [],
      observedStatuses:
        partialJourney.execution?.rows.map((row) => row.status) ?? [],
      statusLabels:
        partialJourney.execution?.rows.map((row) => row.statusLabel) ?? [],
      proves:
        partialJourney.verification?.proves.map((proof) => proof.display) ?? [],
      notProvenYet: [...(partialJourney.verification?.notProvenYet ?? [])],
      exceptionDecision: partialJourney.verification?.exceptionDecision ?? null,
      recordExceptionDecision:
        partialJourney.record.verification?.exceptionDecision ?? null,
    },
    invalidationPolicySimulation: {
      initialCurrentHeadroomMinor:
        typeof policyHeadroom?.before.metric?.value === "number"
          ? policyHeadroom.before.metric.value
          : null,
      initialDraftedHeadroomMinor:
        typeof policyHeadroom?.after.metric?.value === "number"
          ? policyHeadroom.after.metric.value
          : null,
      revalidatedCurrentHeadroomMinor:
        typeof revalidatedPolicyHeadroom?.before.metric?.value === "number"
          ? revalidatedPolicyHeadroom.before.metric.value
          : null,
      revalidatedDraftedHeadroomMinor:
        typeof revalidatedPolicyHeadroom?.after.metric?.value === "number"
          ? revalidatedPolicyHeadroom.after.metric.value
          : null,
    },
  };
}
