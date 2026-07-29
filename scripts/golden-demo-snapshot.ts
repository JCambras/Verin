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
import { DRAFT_RESERVE_MONTHS, buildPolicyAuthoring } from "../src/app/demo/build-summary";
import {
  CANONICAL_REQUEST,
  FIRMS,
  PLANNED_WITHDRAWAL_MONTHLY_MINOR,
  SCENARIOS,
  dispositionFor,
  firmById,
  liquidityAuthorityFor,
} from "../src/app/demo/data";
import { formatDemoInstant } from "../src/app/demo/timeline";
import type {
  DemoSemanticSnapshot,
  DisplayedDecision,
  RenderedMoney,
  SourceTimeline,
  SourceTimelineEvent,
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
function draftSimulation(scenarioId: string, firmId: string) {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const rows = buildPolicyAuthoring(scenario, firmById(firmId)).simulationDelta;
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

/** Every decision the demo actually renders, with the liquidity arithmetic behind it. */
function displayedDecisions(): DisplayedDecision[] {
  return SCENARIOS.flatMap((scenario) =>
    Object.values(FIRMS).flatMap((firm) => {
      const simulated = draftSimulation(scenario.id, firm.id);
      const authority = liquidityAuthorityFor(scenario, firm.id);
      const initial = authority.kind === "signed" ? authority.initialDecision : null;
      const revalidation = authority.kind === "signed" ? authority.preExecutionRevalidation : undefined;
      const reserveFloor = reserveFloorMinor(firm);
      const primary: DisplayedDecision = {
        scenarioId: scenario.id,
        firmId: firm.id,
        decisionRole: "primary",
        disposition: dispositionFor(scenario, firm.id),
        sourceCaseId: authority.kind === "signed" ? authority.sourceCaseId : null,
        requestAt: authority.kind === "signed" ? authority.requestAt : null,
        liquidityAuthorityMissing: authority.kind === "missing" ? authority.reason : null,
        availableCashMinor: initial?.availableCashMinor ?? null,
        pendingActivityMinor: initial?.pendingActivityMinor ?? null,
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
          ? (authority.relatedDecisions ?? []).map(
              (decision): DisplayedDecision => ({
                scenarioId: scenario.id,
                firmId: firm.id,
                decisionRole: "competing-sibling",
                disposition: decision.disposition,
                sourceCaseId: decision.sourceCaseId,
                requestAt: decision.requestAt,
                liquidityAuthorityMissing: null,
                availableCashMinor: decision.initialDecision.availableCashMinor,
                pendingActivityMinor:
                  decision.initialDecision.pendingActivityMinor,
                reserveFloorMinor: reserveFloor,
                headroomMinor: calculateHeadroomMinor(
                  decision.initialDecision.availableCashMinor,
                  decision.initialDecision.pendingActivityMinor,
                  reserveFloor,
                ),
                revalidationAvailableCashMinor: null,
                revalidationPendingActivityMinor: null,
                simulatedFloorMinor: null,
                simulatedHeadroomMinor: null,
                simulatedDisposition: null,
              }),
            )
          : [];
      return [primary, ...related];
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
  return SCENARIOS.flatMap((scenario) =>
    Object.values(FIRMS).flatMap((firm) => {
      const authority = liquidityAuthorityFor(scenario, firm.id);
      if (authority.kind === "missing") return [];
      const journey = getJourney(scenario.id, firm.id);
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
              journey.intent.requestAt.provenance.asOf,
              journey.intent.requestAt.display,
            ),
            ...lifecycleEvents,
          ]
        : [
            event(
              "request",
              journey.intent.requestAt.provenance.asOf,
              journey.intent.requestAt.display,
            ),
            ...[
              event(
                "decision-recorded",
                journey.record.header.createdAtIso,
                journey.record.header.createdAt,
                true,
              ),
              ...(journey.record.approvalStages ?? []).flatMap((stage) => [
                ...stage.actors.flatMap((actor) =>
                  actor.timestampIso
                    ? [
                        event(
                          "approval",
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
                            "reservation",
                            journey.safety.reservationAtIso,
                            journey.safety.reservationAt,
                            true,
                          ),
                        ]
                      : []),
                  ]
                : []),
              ...(journey.execution?.rows ?? []).map((row) =>
                event("execution", row.timestampIso, row.timestamp),
              ),
              ...(journey.verification?.appended ?? []).map((row) =>
                event("verification-appended", row.timestampIso, row.timestamp),
              ),
            ].sort(
              (left, right) =>
                new Date(left.instant).getTime() -
                new Date(right.instant).getTime(),
            ),
          ];
      const primary: SourceTimeline = {
        sourceCaseId: authority.sourceCaseId,
        scenarioId: scenario.id,
        firmId: firm.id,
        requestAt: authority.requestAt,
        events: primaryEvents,
      };
      const related = (authority.relatedDecisions ?? []).flatMap(
        (relatedAuthority) => {
          const relatedDecision = journey.safety?.checks.find(
            (check) =>
              check.relatedDecision?.sourceCaseId ===
              relatedAuthority.sourceCaseId,
          )?.relatedDecision;
          if (!relatedDecision) return [];
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
                  "decision-recorded",
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
    }),
  );
}

/** Project the actual demo constants and emitted rows into the pure fence. */
export function loadDemoSemanticSnapshot(): DemoSemanticSnapshot {
  const firms = Object.values(FIRMS);
  const moneyMetrics = [
    amountMetric(),
    ...firms.map((firm) => reserveFloorMetric(firm)),
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
    invalidationJourney.workspace.plannedMonthlyWithdrawal.value,
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
        row.label.includes("pending approved distribution"),
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
          eligibleRoleIds: [...stage.eligibleRoleIds],
          approvalsRequired: stage.approvalsRequired,
          distinctActorsRequired: stage.distinctActorsRequired,
          requesterMayApprove: stage.requesterMayApprove,
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
  ).simulationDelta;
  const policyHeadroom = policyRows.find(
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
        const executionAt = journey.execution?.rows[0]?.timestampIso;
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
    plannedWithdrawalMonthlyMinor: PLANNED_WITHDRAWAL_MONTHLY_MINOR,
    moneyUnits: [...new Set(moneyMetrics.map((money) => money.format))],
    moneyRenders: moneyMetrics.map(renderMoney),
    currency: MONEY_CURRENCY,
    cadence: RESERVE_CADENCE,
    firms: firms.map((firm) => ({
      id: firm.id,
      reserveMonths: firm.reserveMonths,
      reserveFloorMinor: reserveFloorMinor(firm),
    })),
    decisions: displayedDecisions(),
    sourceTimelines: sourceTimelines(),
    draftedReserveMonths: DRAFT_RESERVE_MONTHS,
    draftedReserveFloorMinor: draftSimulation(SCENARIOS[0]!.id, "firm-a").floorMinor,
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
        const journey = getJourney(scenario.id, firm.id);
        const authority = liquidityAuthorityFor(scenario, firm.id);
        return {
          scenarioId: scenario.id,
          firmId: firm.id,
          signedLiquidityAuthority: authority.kind === "signed",
          reservationVisible: Boolean(journey.safety?.reservationId),
          executionReached: journey.execution !== null,
          verificationReached: journey.verification !== null,
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
      eventTypes: invalidationJourney.record.lifecycle.map((event) => event.type),
      eventInstants: invalidationJourney.record.lifecycle.map(
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
      recordBindings: invalidationJourney.record.decisionBindings.map(
        (binding) => ({ ...binding }),
      ),
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
    },
    invalidationPolicySimulation: {
      currentHeadroomMinor:
        typeof policyHeadroom?.before.metric?.value === "number"
          ? policyHeadroom.before.metric.value
          : null,
      draftedHeadroomMinor:
        typeof policyHeadroom?.after.metric?.value === "number"
          ? policyHeadroom.after.metric.value
          : null,
    },
  };
}
