/**
 * The demo route: one dynamic segment per journey station (the twelve contract
 * surfaces). The page resolves the recorded branch (scenario + firm from the URL),
 * asks the fake service for the typed journey view model, and hands the right slice
 * to the surface component. Surfaces never see the contract data or the service -
 * only view models (Gate 0: the UI does not invent decisions).
 */
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getJourney } from "@app/demo/journey";
import { getDb } from "@infra/store/db";
import { resolveSession, SESSION_COOKIE } from "@infra/identity/session";
import { demoPolicyApprovalEventFor } from "@app/demo/policy-approval-events";
import {
  bindExactSourceCase,
  hasSignedInvalidationAuthority,
  resolveFirmId,
  resolveScenarioId,
  resolveSourceCaseId,
  scenarioById,
  sourceCaseIdsFor,
  type JourneyPass,
} from "@app/demo/data";
import { DEMO_SEQUENCE, type DemoStation } from "@app/demo/surfaces/shared";
import { WorkspaceSurface } from "@app/demo/surfaces/workspace";
import { IntentSurface } from "@app/demo/surfaces/intent";
import { EvidenceSurface } from "@app/demo/surfaces/evidence";
import { RecommendationSurface } from "@app/demo/surfaces/recommendation";
import { PolicyTraceSurface } from "@app/demo/surfaces/policy-trace";
import { AuthoritySurface } from "@app/demo/surfaces/authority";
import { SafetySurface } from "@app/demo/surfaces/safety";
import { ExecutionSurface } from "@app/demo/surfaces/execution";
import { VerificationSurface } from "@app/demo/surfaces/verification";
import { ComparisonSurface } from "@app/demo/surfaces/comparison";
import { PolicyAuthoringSurface } from "@app/demo/surfaces/policy-authoring";
import { RecordSurface } from "@app/demo/surfaces/record";

export const runtime = "nodejs";

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DemoStationPage({
  params,
  searchParams,
}: {
  params: Promise<{ station: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { station } = await params;
  if (!(DEMO_SEQUENCE as readonly string[]).includes(station)) notFound();
  const sp = await searchParams;
  const scenarioId = resolveScenarioId(first(sp.scenario));
  const firmId = resolveFirmId(first(sp.firm));
  if (!scenarioId || !firmId) notFound();
  const scenario = scenarioById(scenarioId);
  const requestedCaseId = first(sp.case);
  const sourceCaseId = resolveSourceCaseId(
    scenario,
    firmId,
    requestedCaseId,
  );
  if (
    (requestedCaseId === undefined &&
      sourceCaseIdsFor(scenario, firmId).length > 0) ||
    (requestedCaseId !== undefined && sourceCaseId === null)
  ) {
    notFound();
  }
  if (sp.approved !== undefined) notFound();
  const requestedPass = first(sp.pass);
  if (requestedPass !== undefined && requestedPass !== "revalidated") notFound();
  if (
    requestedPass === "revalidated" &&
    !hasSignedInvalidationAuthority(
      sourceCaseId
        ? bindExactSourceCase(
            scenario,
            firmId,
            sourceCaseId,
          )
        : scenario,
      firmId,
    )
  ) {
    notFound();
  }
  const pass: JourneyPass = requestedPass === "revalidated" ? "revalidated" : "initial";
  const approvalEventId = first(sp.approvalEvent);
  if (approvalEventId !== undefined && approvalEventId.length === 0) notFound();
  if (
    approvalEventId !== undefined &&
    station !== "policy-authoring" &&
    station !== "record"
  ) {
    notFound();
  }
  let policyApproval = null;
  if (approvalEventId) {
    const cookieStore = await cookies();
    const principal = await resolveSession(
      await getDb(),
      cookieStore.get(SESSION_COOKIE)?.value,
    );
    if (!principal.ok) notFound();
    policyApproval = demoPolicyApprovalEventFor(
      approvalEventId,
      principal.value.orgId,
      { scenarioId, firmId, sourceCaseId, pass },
    );
    if (!policyApproval) notFound();
  }
  const journey = getJourney(
    scenarioId,
    firmId,
    pass,
    sourceCaseId ?? undefined,
    policyApproval,
  );
  const routeContext = {
    scenarioId: journey.scenarioId,
    firmId: journey.firmId,
    sourceCaseId,
    pass,
  };

  switch (station as DemoStation) {
    case "workspace":
      return <WorkspaceSurface vm={journey.workspace} routeContext={routeContext} />;
    case "intent":
      return <IntentSurface vm={journey.intent} routeContext={routeContext} />;
    case "evidence":
      return <EvidenceSurface vm={journey.evidence} routeContext={routeContext} />;
    case "decision":
      return <RecommendationSurface vm={journey.recommendation} routeContext={routeContext} />;
    case "policy-trace":
      return <PolicyTraceSurface vm={journey.policyTrace} routeContext={routeContext} journeyContinues={journey.approvals !== null} />;
    case "authority":
      return <AuthoritySurface vm={journey.approvals} routeContext={routeContext} stopNote={journey.stopNote} journeyContinues={journey.safety !== null} />;
    case "safety":
      return <SafetySurface vm={journey.safety} routeContext={routeContext} stopNote={journey.stopNote} journeyContinues={journey.execution !== null} />;
    case "execution":
      return <ExecutionSurface vm={journey.execution} routeContext={routeContext} stopNote={journey.stopNote} />;
    case "verification":
      return <VerificationSurface vm={journey.verification} routeContext={routeContext} stopNote={journey.stopNote} />;
    case "comparison":
      return <ComparisonSurface vm={journey.comparison} routeContext={routeContext} />;
    case "policy-authoring":
      return <PolicyAuthoringSurface vm={journey.policyAuthoring} routeContext={routeContext} approvalEvent={policyApproval} />;
    case "record":
      return <RecordSurface vm={journey.record} routeContext={routeContext} />;
  }
}
