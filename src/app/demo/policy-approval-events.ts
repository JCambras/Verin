import { createHash, randomUUID } from "node:crypto";
import { assertActionGrant, type ActionGrant } from "@contracts/authz";
import { appError } from "@contracts/errors";
import { err, ok, type Result } from "@contracts/result";
import { DEMO_WATERMARK } from "@contracts/provenance";
import { buildPolicyAuthoring, DRAFT_RESERVE_MONTHS } from "./build-policy-authoring";
import { evaluatePolicyRerun } from "./policy-rerun";
import {
  bindExactSourceCase,
  firmById,
  hasSignedInvalidationAuthority,
  resolveFirmId,
  resolveScenarioId,
  resolveSourceCaseId,
  scenarioById,
  sourceCaseIdsFor,
  type JourneyPass,
} from "./data";
import { formatDemoInstant } from "./timeline";
import type { DemoPolicyApprovalEventVM } from "./model";

export interface DemoPolicyApprovalRequest {
  readonly scenarioId: string;
  readonly firmId: string;
  readonly sourceCaseId: string | null;
  readonly pass: JourneyPass;
}

interface StoredDemoPolicyApproval extends DemoPolicyApprovalEventVM {
  readonly scenarioId: string;
  readonly firmId: string;
  readonly sourceCaseId: string | null;
  readonly pass: JourneyPass;
}

const approvalStore = globalThis as typeof globalThis & {
  __verinDemoPolicyApprovals?: Map<string, StoredDemoPolicyApproval>;
};

function store(): Map<string, StoredDemoPolicyApproval> {
  approvalStore.__verinDemoPolicyApprovals ??= new Map();
  return approvalStore.__verinDemoPolicyApprovals;
}

function policyHash(
  fromVersion: string,
  toVersion: string,
  sentence: string,
): string {
  return createHash("sha256")
    .update("verin-demo-policy-v1")
    .update("\u0000")
    .update(JSON.stringify({ fromVersion, toVersion, sentence, reserveMonths: DRAFT_RESERVE_MONTHS }))
    .digest("hex");
}

export function recordDemoPolicyApproval(
  grant: ActionGrant<"policy.approve">,
  request: DemoPolicyApprovalRequest,
): Result<StoredDemoPolicyApproval> {
  assertActionGrant(grant, "policy.approve");
  const scenarioId = resolveScenarioId(request.scenarioId);
  const firmId = resolveFirmId(request.firmId);
  if (!scenarioId || !firmId) {
    return err(appError("VALIDATION", "Unknown demo policy context."));
  }
  const baseScenario = scenarioById(scenarioId);
  const sourceCaseId = resolveSourceCaseId(
    baseScenario,
    firmId,
    request.sourceCaseId ?? undefined,
  );
  if (
    (request.sourceCaseId === null && sourceCaseIdsFor(baseScenario, firmId).length > 0) ||
    (request.sourceCaseId !== null && sourceCaseId === null)
  ) {
    return err(appError("VALIDATION", "The demo policy context lacks an exact signed case."));
  }
  const scenario = sourceCaseId
    ? bindExactSourceCase(baseScenario, firmId, sourceCaseId)
    : baseScenario;
  if (
    request.pass === "revalidated" &&
    !hasSignedInvalidationAuthority(scenario, firmId)
  ) {
    return err(appError("VALIDATION", "The requested rerun pass has no signed authority."));
  }
  const policy = buildPolicyAuthoring(
    scenario,
    firmById(firmId),
    request.pass,
  );
  if (policy.approval.kind === "unavailable") {
    return err(appError("VALIDATION", policy.approval.reason));
  }
  const rerun = evaluatePolicyRerun(
    scenario,
    firmById(firmId),
    request.pass,
    policy.approval.activation.toVersion,
  );
  if (!rerun) {
    return err(appError("VALIDATION", "The activated policy rerun could not be computed."));
  }
  const approvedAtIso = new Date().toISOString();
  const decisionRecordedAtIso = new Date(Date.parse(approvedAtIso) + 1).toISOString();
  const event: StoredDemoPolicyApproval = Object.freeze({
    eventId: randomUUID(),
    actorId: grant.actorId,
    actorRole: grant.role,
    tenantOrgId: grant.tenant.orgId,
    approvedAt: formatDemoInstant(approvedAtIso, undefined, true),
    approvedAtIso,
    decisionRecordedAt: formatDemoInstant(decisionRecordedAtIso, undefined, true),
    decisionRecordedAtIso,
    policyHash: policyHash(
      policy.approval.activation.fromVersion,
      policy.approval.activation.toVersion,
      policy.sentence,
    ),
    fromVersion: policy.approval.activation.fromVersion,
    toVersion: policy.approval.activation.toVersion,
    reserveMonths: DRAFT_RESERVE_MONTHS,
    rerun,
    fakeClass: "deterministic-engine-output",
    watermark: DEMO_WATERMARK,
    scenarioId,
    firmId,
    sourceCaseId,
    pass: request.pass,
  });
  const events = store();
  const oldest = events.size >= 256 ? events.keys().next().value : undefined;
  if (oldest) events.delete(oldest);
  events.set(event.eventId, event);
  return ok(event);
}

export function demoPolicyApprovalEventFor(
  eventId: string,
  tenantOrgId: string,
  context: DemoPolicyApprovalRequest,
): DemoPolicyApprovalEventVM | null {
  const event = store().get(eventId);
  return event &&
    event.tenantOrgId === tenantOrgId &&
    event.scenarioId === context.scenarioId &&
    event.firmId === context.firmId &&
    event.sourceCaseId === context.sourceCaseId &&
    event.pass === context.pass
    ? event
    : null;
}
