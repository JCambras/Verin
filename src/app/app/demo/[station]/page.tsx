/**
 * The demo route: one dynamic segment per journey station (the twelve contract
 * surfaces). The page resolves the recorded branch (scenario + firm from the URL),
 * asks the fake service for the typed journey view model, and hands the right slice
 * to the surface component. Surfaces never see the contract data or the service -
 * only view models (Gate 0: the UI does not invent decisions).
 */
import { notFound } from "next/navigation";
import { getJourney } from "@app/demo/journey";
import { demoVocabulary } from "@app/demo/vocabulary";
import { DemoUnavailable } from "@app/demo/surfaces/unavailable";
import { resolveFirmId, resolveScenarioId } from "@app/demo/data";
import { DEMO_SEQUENCE, type DemoStation } from "@app/demo/model";
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

function renderStation(
  station: DemoStation,
  journey: ReturnType<typeof getJourney>,
  ids: { scenarioId: string; firmId: string },
  approved: boolean,
) {
  switch (station) {
    case "workspace":
      return <WorkspaceSurface vm={journey.workspace} {...ids} />;
    case "intent":
      return <IntentSurface vm={journey.intent} {...ids} />;
    case "evidence":
      return <EvidenceSurface vm={journey.evidence} {...ids} />;
    case "decision":
      return <RecommendationSurface vm={journey.recommendation} {...ids} />;
    case "policy-trace":
      return <PolicyTraceSurface vm={journey.policyTrace} {...ids} journeyContinues={journey.approvals !== null} />;
    case "authority":
      return <AuthoritySurface vm={journey.approvals} {...ids} stopNote={journey.stopNote} journeyContinues={journey.safety !== null} />;
    case "safety":
      return <SafetySurface vm={journey.safety} {...ids} stopNote={journey.stopNote} journeyContinues={journey.execution !== null} />;
    case "execution":
      return <ExecutionSurface vm={journey.execution} {...ids} stopNote={journey.stopNote} />;
    case "verification":
      return <VerificationSurface vm={journey.verification} {...ids} stopNote={journey.stopNote} />;
    case "comparison":
      return <ComparisonSurface vm={journey.comparison} {...ids} />;
    case "policy-authoring":
      return <PolicyAuthoringSurface vm={journey.policyAuthoring} {...ids} approved={approved} />;
    case "record":
      return <RecordSurface vm={journey.record} {...ids} />;
  }
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
  const approved = first(sp.approved) === "1";
  // THE CONFIGURED VOCABULARY IS RESOLVED BEFORE THE JOURNEY IS BUILT, and a
  // deployment that cannot supply it renders the refusal instead (D-251). This is
  // the X-9 honesty check on the demo side: removing the published document breaks
  // this journey visibly, with the quotable reference its own operator line
  // carries, rather than with a server stack trace.
  const vocabulary = demoVocabulary(firmId);
  if (!vocabulary.ok) return <DemoUnavailable error={vocabulary.error} />;
  const journey = getJourney(scenarioId, firmId, vocabulary.value);
  const ids = { scenarioId: journey.scenarioId, firmId: journey.firmId };
  const resolvedStation = station as DemoStation;
  return (
    <div data-demo-surface={resolvedStation}>
      {renderStation(resolvedStation, journey, ids, approved)}
    </div>
  );
}
