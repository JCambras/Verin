/**
 * Surface 8 - Execution timeline (demo contract §4.8; design §3 row 8, §8). Renders
 * fake-adapter data with the deferral stated in plain words (ADR-0024): the surface
 * is built now; only "real" is deferred. Honest status: submitted is never settled,
 * the duplicate-suppressed row says "Verin did not send it again" with byte-matching
 * keys inspectable.
 */
import { ExecutionTimeline } from "@app/presentation/execution-timeline";
import type { ExecutionVM } from "../model";
import { JourneyNav, NotReached, SurfaceShell, demoHref, toTimelineRow } from "./shared";

export function ExecutionSurface({
  vm,
  scenarioId,
  firmId,
  stopNote,
  querySuffix,
}: {
  vm: ExecutionVM | null;
  scenarioId: string;
  firmId: string;
  stopNote: string | null;
  querySuffix?: string;
}) {
  if (!vm) {
    return (
      <SurfaceShell title="Execution" description="The external instruction timeline for an in-flight decision.">
        <NotReached title="Execution not reached" stopNote={stopNote} backHref={demoHref("decision", scenarioId, firmId)} />
      </SurfaceShell>
    );
  }
  return (
    <SurfaceShell spine={vm.spine} title="Execution" description={vm.deferredNote}>
      <ExecutionTimeline caption="Execution timeline" rows={vm.rows.map((r) => toTimelineRow(r))} />
      <JourneyNav
        back={{ href: demoHref("safety", scenarioId, firmId, querySuffix), label: "Back to the safety check" }}
        forward={{ href: demoHref("verification", scenarioId, firmId, querySuffix), label: "View verification" }}
      />
    </SurfaceShell>
  );
}
