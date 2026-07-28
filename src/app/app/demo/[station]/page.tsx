/**
 * The demo route: one dynamic segment per branch-proof station plus two legacy
 * aliases that redirect to setup. The page resolves the recorded branch,
 * asks the fake service for the typed journey view model, and hands the right slice
 * to the surface component. Surfaces never see the contract data or the service -
 * only view models (Gate 0: the UI does not invent decisions).
 */
import { notFound, redirect } from "next/navigation";
import { getJourney } from "@app/demo/journey";
import { resolveFirmId, resolveScenarioId } from "@app/demo/data";
import { activatedSetupSnapshot } from "@app/demo/setup-activation-store";
import { buildActivatedRecord } from "@app/demo/setup-evaluator";
import type { SetupFirmId } from "@app/demo/setup-model";
import {
  DEMO_SEQUENCE,
  LEGACY_SETUP_ALIASES,
  type DemoStation,
} from "@app/demo/surfaces/shared";
import { WorkspaceSurface } from "@app/demo/surfaces/workspace";
import { IntentSurface } from "@app/demo/surfaces/intent";
import { EvidenceSurface } from "@app/demo/surfaces/evidence";
import { RecommendationSurface } from "@app/demo/surfaces/recommendation";
import { PolicyTraceSurface } from "@app/demo/surfaces/policy-trace";
import { AuthoritySurface } from "@app/demo/surfaces/authority";
import { SafetySurface } from "@app/demo/surfaces/safety";
import { ExecutionSurface } from "@app/demo/surfaces/execution";
import { VerificationSurface } from "@app/demo/surfaces/verification";
import { RecordSurface } from "@app/demo/surfaces/record";
import { SurfaceShell } from "@app/demo/surfaces/shared";

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
  // A legacy alias redirects BEFORE anything else is resolved: an old rehearsal link
  // must reach setup even when its query string names a branch that no longer exists,
  // and no journey is built for a station that never renders one.
  if ((LEGACY_SETUP_ALIASES as readonly string[]).includes(station)) {
    redirect("/app/demo/setup");
  }
  if (!(DEMO_SEQUENCE as readonly string[]).includes(station)) {
    notFound();
  }
  const sp = await searchParams;
  const scenarioId = resolveScenarioId(first(sp.scenario));
  const firmId = resolveFirmId(first(sp.firm));
  if (!scenarioId || !firmId) notFound();
  const activation = first(sp.activation);
  if (station === "record" && activation) {
    const snapshot = activatedSetupSnapshot(activation);
    const snapshotFirm = snapshot?.firms.find(
      (candidate) => candidate.firmId === firmId,
    );
    if (
      !snapshot ||
      !snapshotFirm ||
      snapshotFirm.scenarioId !== scenarioId
    ) {
      return (
        <SurfaceShell
          title="Decision record unavailable"
          description="The export failed closed before any unrelated signed record could be substituted."
        >
          <p role="alert" className="rounded-lg border border-destructive bg-white p-4 text-sm text-destructive">
            Activated setup snapshot {activation} does not match scenario {scenarioId} and firm {firmId}.
          </p>
        </SurfaceShell>
      );
    }
    return (
      <RecordSurface
        vm={buildActivatedRecord(snapshot, firmId as SetupFirmId)}
      />
    );
  }
  const journey = getJourney(scenarioId, firmId);
  const ids = { scenarioId: journey.scenarioId, firmId: journey.firmId };

  switch (station as DemoStation) {
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
    case "record":
      return <RecordSurface vm={journey.record} />;
  }
}
