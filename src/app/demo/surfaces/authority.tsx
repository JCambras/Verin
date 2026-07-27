/**
 * Surface 6 - Approval stages and actor status (demo contract §4.6; design §3 row 6,
 * §7). Stages through ProgressSteps; one ApprovalStagePanel per stage; the binding
 * line ties approval to the exact decision and input-bundle hashes; the gate restates
 * the PAYLOAD (dollars and names), and its approve control is the surface's one
 * primary. The requester's approve control is absent, not disabled.
 */
import { ProgressSteps } from "@app/presentation/progress-steps";
import { ApprovalStagePanel } from "@app/presentation/approval-stage-panel";
import { Metric } from "@app/presentation/metric";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type ApprovalVM } from "../model";
import { JourneyNav, NotReached, PrimaryLink, SurfaceShell, demoHref } from "./shared";

function shortHash(h: string): string {
  return `${h.slice(0, 8)}…`;
}

export function AuthoritySurface({
  vm,
  scenarioId,
  firmId,
  stopNote,
  journeyContinues,
}: {
  vm: ApprovalVM | null;
  scenarioId: string;
  firmId: string;
  stopNote: string | null;
  journeyContinues: boolean;
}) {
  if (!vm) {
    return (
      <SurfaceShell title="Authority" description="Approval stages for an in-flight decision.">
        <NotReached title="Authority not reached" stopNote={stopNote} backHref={demoHref("decision", scenarioId, firmId)} />
      </SurfaceShell>
    );
  }
  return (
    <SurfaceShell spine={vm.spine} title="Authority" description="Who must approve this movement, in what order, and what their approval binds to.">
      <div className="flex flex-col gap-2">
        <ProgressSteps steps={vm.stages.map((s, i) => ({ id: `stage-${i}`, name: s.title, state: s.stepState }))} />
        <p className="flex items-center gap-2 text-xs text-slate-600">
          <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
        </p>
      </div>

      {vm.stages.map((s) => (
        <ApprovalStagePanel
          key={s.title}
          stage={{
            title: s.title,
            requirement: s.requirement,
            actors: s.actors,
            ...(s.expiry ? { expiry: s.expiry } : {}),
            ...(s.escalation ? { escalation: s.escalation } : {}),
          }}
        />
      ))}

      <p className="font-mono text-xs text-slate-500">
        Approval binds to decision {shortHash(vm.binding.decisionHash)} · input bundle {shortHash(vm.binding.bundleHash)}
      </p>

      {journeyContinues ? (
        <section aria-label="Approve" className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-surface p-4">
          <p className="text-sm text-slate-800">{vm.gate.restatement}</p>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {vm.gate.figures.map((f) => (
              <div key={f.label} className="flex flex-col gap-0.5">
                <dt className="text-xs text-slate-600">{f.label}</dt>
                <dd className="text-sm">
                  <Metric metric={f.metric} />
                </dd>
              </div>
            ))}
          </dl>
          <PrimaryLink href={demoHref("safety", scenarioId, firmId)}>{vm.gate.primaryLabel}</PrimaryLink>
        </section>
      ) : (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{stopNote}</p>
      )}

      <JourneyNav back={{ href: demoHref("policy-trace", scenarioId, firmId), label: "Back to the policy trace" }} />
    </SurfaceShell>
  );
}
