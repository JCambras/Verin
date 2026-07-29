/**
 * The demo route: one dynamic segment per journey station (the twelve contract
 * surfaces). The page resolves the recorded branch (scenario + firm from the URL),
 * asks the fake service for the typed journey view model, and hands the right slice
 * to the surface component. Surfaces never see the contract data or the service -
 * only view models (Gate 0: the UI does not invent decisions).
 */
import { notFound } from "next/navigation";
import { getJourney } from "@app/demo/journey";
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
  const approved = first(sp.approved) === "1";
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
  const journey = getJourney(
    scenarioId,
    firmId,
    pass,
    sourceCaseId ?? undefined,
  );
  if (
    station === "policy-authoring" &&
    approved &&
    journey.policyAuthoring.approval.kind === "unavailable"
  ) {
    notFound();
  }
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
      return <PolicyAuthoringSurface vm={journey.policyAuthoring} routeContext={routeContext} approved={approved} />;
    case "record":
      return <RecordSurface vm={journey.record} routeContext={routeContext} />;
  }
}
