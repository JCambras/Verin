/**
 * Surface 8 - Execution timeline (demo contract §4.8; design §3 row 8, §8). Renders
 * fake-adapter data with the deferral stated in plain words (ADR-0024): the surface
 * is built now; only "real" is deferred. Honest status: submitted is never settled,
 * the duplicate-suppressed row says "Verin did not send it again" with byte-matching
 * keys inspectable.
 */
import { ExecutionTimeline } from "@app/presentation/execution-timeline";
import type { ExecutionVM } from "../model";
import { JourneyNav, NotReached, SurfaceShell, demoHref, toTimelineRow, type DemoRouteContext } from "./shared";

export function ExecutionSurface({
  vm,
  stopNote,
  routeContext,
}: {
  vm: ExecutionVM | null;
  stopNote: string | null;
  routeContext: DemoRouteContext;
}) {
  if (!vm) {
    return (
      <SurfaceShell title="Execution" description="The external instruction timeline for an in-flight decision.">
        <NotReached title="Execution not reached" stopNote={stopNote} backHref={demoHref("decision", routeContext)} />
      </SurfaceShell>
    );
  }
  return (
    <SurfaceShell spine={vm.spine} title="Execution" description={vm.deferredNote}>
      <ExecutionTimeline caption="Execution timeline" rows={vm.rows.map((r) => toTimelineRow(r))} />
      <JourneyNav
        back={{ href: demoHref("safety", routeContext), label: "Back to the safety check" }}
        forward={{ href: demoHref("verification", routeContext), label: "View verification" }}
      />
    </SurfaceShell>
  );
}
