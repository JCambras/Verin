/**
 * Surface 8 - Execution timeline (demo contract §4.8; design §3 row 8, §8). Renders
 * fake-adapter data with the deferral stated in plain words (ADR-0024): the surface
 * is built now; only "real" is deferred. Honest status: submitted is never settled,
 * the duplicate-suppressed row says "Verin did not send it again" with byte-matching
 * keys inspectable.
 */
import { ExecutionTimeline } from "@app/presentation/execution-timeline";
import { DEV_BADGE_TEXT, type ExecutionVM } from "../model";
import { JourneyNav, NotReached, SurfaceShell, demoHref } from "./shared";

export function ExecutionSurface({
  vm,
  scenarioId,
  firmId,
  stopNote,
}: {
  vm: ExecutionVM | null;
  scenarioId: string;
  firmId: string;
  stopNote: string | null;
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
      <ExecutionTimeline
        caption="Execution timeline"
        rows={vm.rows.map((r) => ({
          step: r.step,
          target: r.target,
          status: r.status,
          statusLabel: r.statusLabel,
          timestamp: r.timestamp,
          ...(r.honestyLine ? { honestyLine: r.honestyLine } : {}),
          ...(r.plainClaim ? { plainClaim: r.plainClaim } : {}),
          ...(r.affordanceLabel ? { affordanceLabel: r.affordanceLabel } : {}),
          identifiers: r.identifiers.map((i) => ({ label: i.label, value: i.value, mono: true })),
          devBadgeLabel: DEV_BADGE_TEXT[r.fakeClass],
        }))}
      />
      <JourneyNav
        back={{ href: demoHref("safety", scenarioId, firmId), label: "Back to the safety check" }}
        forward={{ href: demoHref("verification", scenarioId, firmId), label: "View verification" }}
      />
    </SurfaceShell>
  );
}
