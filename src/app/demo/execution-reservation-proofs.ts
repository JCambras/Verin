import { decisionBindingFor } from "./decision-bindings";
import type { FirmData, JourneyPass, ScenarioData } from "./data";
import {
  activeDecisionProof,
  approvalProofResult,
  evidenceProofResult,
} from "./execution-binding-proofs";
import {
  eventInstant,
  eventLabel,
  fieldGap,
  proof,
  sameStrings,
  type ProofResult,
} from "./execution-proof-shared";
import type { SignedCaseVariant } from "./signed-case-types";

function durationMilliseconds(value: string): number | null {
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;
  const [days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  const total = (((days! * 24 + hours!) * 60 + minutes!) * 60 + seconds!) * 1_000;
  return total > 0 ? total : null;
}

export function reservationProofResult(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
): ProofResult {
  const decision = activeDecisionProof(scenario, firm, sourceCase, pass);
  const binding = decisionBindingFor(scenario, firm, pass);
  const eligibility = sourceCase.executionEligibility;
  const gaps = [...decision.gaps];
  if (!eligibility.idempotencyKey) {
    gaps.push("Signed execution eligibility lacks an idempotencyKey");
  }
  if (eligibility.reservations.length === 0) {
    gaps.push("Signed execution eligibility has no reservation definitions");
  }
  const starts = sourceCase.ledgerEvents.filter(
    (event) =>
      event.type === "ExecutionStarted" &&
      (event.lifecyclePass === pass || event.lifecyclePass === null),
  );
  const exactStarts = starts.filter((event) => {
    const eventGaps = [
      ...fieldGap(sourceCase, event, `lifecyclePass=${pass}`, event.lifecyclePass === pass),
      ...fieldGap(sourceCase, event, "recordedAt", eventInstant(event) !== null),
      ...fieldGap(sourceCase, event, "decisionHash", event.decisionHash === binding.decisionHash),
      ...fieldGap(sourceCase, event, "inputBundleHash", event.inputBundleHash === binding.bundleHash),
      ...fieldGap(
        sourceCase,
        event,
        "idempotencyKey",
        Boolean(eligibility.idempotencyKey && event.idempotencyKey === eligibility.idempotencyKey),
      ),
      ...fieldGap(
        sourceCase,
        event,
        "reservationIds",
        sameStrings(
          event.reservationIds,
          eligibility.reservations.map(({ reservationId }) => reservationId),
        ),
      ),
    ];
    gaps.push(...eventGaps);
    return eventGaps.length === 0;
  });
  if (starts.length === 0) {
    gaps.push(`No ExecutionStarted event carries structured lifecyclePass=${pass}`);
  }
  if (exactStarts.length > 1) {
    gaps.push(`Multiple ExecutionStarted events carry the ${pass} execution binding`);
  }
  const start = exactStarts.length === 1 ? exactStarts[0]! : null;
  const startAt = start ? eventInstant(start) : null;
  const createdEvents = sourceCase.ledgerEvents.filter(
    (event) =>
      event.type === "ReservationCreated" &&
      (event.lifecyclePass === pass || event.lifecyclePass === null),
  );
  for (const reservation of eligibility.reservations) {
    const candidates = createdEvents.filter(
      (event) => !event.reservationId || event.reservationId === reservation.reservationId,
    );
    const exact = candidates.filter((event) => {
      const createdAt = eventInstant(event);
      const ttl = durationMilliseconds(reservation.expiresAfter);
      const expectedExpiry = createdAt !== null && ttl !== null
        ? new Date(createdAt + ttl).toISOString()
        : null;
      const eventGaps = [
        ...fieldGap(sourceCase, event, `lifecyclePass=${pass}`, event.lifecyclePass === pass),
        ...fieldGap(sourceCase, event, "recordedAt", createdAt !== null),
        ...fieldGap(sourceCase, event, "decisionHash", event.decisionHash === binding.decisionHash),
        ...fieldGap(sourceCase, event, "inputBundleHash", event.inputBundleHash === binding.bundleHash),
        ...fieldGap(sourceCase, event, "reservationId", event.reservationId === reservation.reservationId),
        ...fieldGap(sourceCase, event, "conflictKeys", sameStrings(event.conflictKeys, reservation.conflictKeys)),
        ...fieldGap(sourceCase, event, "reservationExpiresAt", expectedExpiry !== null && event.reservationExpiresAt === expectedExpiry),
      ];
      if (
        createdAt !== null &&
        startAt !== null &&
        expectedExpiry !== null &&
        !(createdAt <= startAt && startAt <= Date.parse(expectedExpiry))
      ) {
        eventGaps.push(`${eventLabel(sourceCase, event)} is not held through execution`);
      }
      gaps.push(...eventGaps);
      return eventGaps.length === 0;
    });
    if (candidates.length === 0) {
      gaps.push(`No ReservationCreated event carries structured reservationId=${reservation.reservationId}`);
    }
    if (exact.length > 1) {
      gaps.push(`Multiple ReservationCreated events carry reservationId=${reservation.reservationId}`);
    }
  }
  for (const released of sourceCase.ledgerEvents.filter(
    (event) =>
      event.type === "ReservationReleased" &&
      (event.lifecyclePass === pass || event.lifecyclePass === null),
  )) {
    const releasedAt = eventInstant(released);
    gaps.push(
      ...fieldGap(sourceCase, released, `lifecyclePass=${pass}`, released.lifecyclePass === pass),
      ...fieldGap(sourceCase, released, "recordedAt", releasedAt !== null),
      ...fieldGap(sourceCase, released, "reservationId", Boolean(released.reservationId)),
    );
    const created = createdEvents.find(
      (event) => event.reservationId === released.reservationId,
    );
    const createdAt = created ? eventInstant(created) : null;
    if (
      releasedAt !== null &&
      createdAt !== null &&
      startAt !== null &&
      releasedAt > createdAt &&
      releasedAt < startAt
    ) {
      gaps.push(`${eventLabel(sourceCase, released)} releases ${released.reservationId} before execution`);
    }
  }
  return proof(gaps);
}

export function refreshedBundleProofResult(
  scenario: ScenarioData,
  firm: FirmData,
  sourceCase: SignedCaseVariant,
  pass: JourneyPass,
  requiredEvidence: readonly string[],
): ProofResult {
  if (pass !== "revalidated") {
    return proof(["Refreshed input-bundle proof requires lifecyclePass=revalidated"]);
  }
  const original = activeDecisionProof(scenario, firm, sourceCase, "initial");
  const refreshed = activeDecisionProof(scenario, firm, sourceCase, "revalidated");
  const originalBinding = decisionBindingFor(scenario, firm, "initial");
  const refreshedBinding = decisionBindingFor(scenario, firm, "revalidated");
  const evidence = evidenceProofResult(scenario, firm, sourceCase, pass, requiredEvidence);
  const originalApproval = approvalProofResult(scenario, firm, sourceCase, "initial");
  const refreshedApproval = approvalProofResult(scenario, firm, sourceCase, "revalidated");
  const gaps = [
    ...original.gaps,
    ...refreshed.gaps,
    ...evidence.gaps,
    ...originalApproval.gaps,
    ...refreshedApproval.gaps,
  ];
  const candidates = sourceCase.ledgerEvents.filter(
    (event) => event.type === "ApprovalInvalidated",
  );
  const exact = candidates.filter((event) => {
    const invalidatedAt = eventInstant(event);
    const originalAt = original.event ? eventInstant(original.event) : null;
    const refreshedAt = refreshed.event ? eventInstant(refreshed.event) : null;
    const eventGaps = [
      ...fieldGap(sourceCase, event, "recordedAt", invalidatedAt !== null),
      ...fieldGap(sourceCase, event, "priorDecisionHash", event.priorDecisionHash === originalBinding.decisionHash),
      ...fieldGap(sourceCase, event, "priorInputBundleHash", event.priorInputBundleHash === originalBinding.bundleHash),
      ...fieldGap(sourceCase, event, "replacementDecisionHash", event.replacementDecisionHash === refreshedBinding.decisionHash),
      ...fieldGap(sourceCase, event, "replacementInputBundleHash", event.replacementInputBundleHash === refreshedBinding.bundleHash),
    ];
    if (
      invalidatedAt !== null &&
      originalAt !== null &&
      refreshedAt !== null &&
      !(originalAt < invalidatedAt && invalidatedAt < refreshedAt)
    ) {
      eventGaps.push(`${eventLabel(sourceCase, event)} does not fall between bound decisions`);
    }
    gaps.push(...eventGaps);
    return eventGaps.length === 0;
  });
  if (candidates.length === 0) {
    gaps.push("No ApprovalInvalidated event carries structured replacement bindings");
  }
  if (
    originalBinding.bundleHash === refreshedBinding.bundleHash ||
    originalBinding.decisionHash === refreshedBinding.decisionHash
  ) {
    gaps.push("Revalidated decision bindings do not differ from the original bindings");
  }
  if (exact.length > 1) {
    gaps.push("Multiple ApprovalInvalidated events carry replacement bindings");
  }
  return proof(gaps);
}
