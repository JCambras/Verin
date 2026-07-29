/**
 * Surface 11 - Policy draft and simulation impact (demo contract §4.11; design §3
 * row 11). The natural-language sentence becomes a structured draft (LLM-drafted,
 * set apart and labeled - §6.5), a deterministic interpretation, a simulation delta
 * in aligned rows, and a human approval gate. Activation and the changed rerun
 * result appear only in the approved state - the gate is real choreography, not
 * decoration. A number is never LLM-drafted: every figure renders through Metric.
 */
import { Metric } from "@app/presentation/metric";
import { StatusBadge } from "@app/presentation/ui";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import type { ComparisonCellVM, PolicyAuthoringVM } from "../model";
import { DEV_BADGE_TEXT } from "../model";
import { JourneyNav, PrimaryLink, SurfaceShell, demoHref, type DemoRouteContext } from "./shared";

function Cell({ cell }: { cell: ComparisonCellVM }) {
  return (
    <span className="text-sm text-slate-800">
      {cell.badge ? <StatusBadge status={cell.badge.status} label={cell.badge.label} /> : null}
      {cell.metric ? <Metric metric={cell.metric} /> : null}
      {cell.display}
    </span>
  );
}

export function PolicyAuthoringSurface({
  vm,
  approved,
  routeContext,
}: {
  vm: PolicyAuthoringVM;
  approved: boolean;
  routeContext: DemoRouteContext;
}) {
  return (
    <SurfaceShell
      spine={vm.spine}
      title="Policy authoring"
      description="A policy sentence becomes structured, simulated, and humanly approved before it governs anything."
    >
      <section aria-label="Policy sentence" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Proposed policy</p>
        <p className="text-base text-slate-900">“{vm.sentence}”</p>
      </section>

      <section aria-label="Structured draft" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">Structured draft</h2>
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="flex items-center gap-2 text-xs text-slate-600">
            {vm.draft.label}
            <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.draft.fakeClass]} />
          </p>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {vm.draft.rows.map((r) => (
              <div key={r.field} className="flex flex-col gap-0.5">
                <dt className="text-xs text-slate-600">{r.field}</dt>
                <dd className="text-sm text-slate-700">{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-sm text-slate-800">{vm.interpretation}</p>
      </section>

      <section aria-label="Simulation impact" className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          Simulation impact
          <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
        </h2>
        <div
          role="region"
          aria-label="Simulation delta"
          tabIndex={0}
          className="overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-slate-600"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Simulated impact of the drafted policy</caption>
            <thead className="bg-surface text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">Dimension</th>
                <th scope="col" className="px-3 py-2">Today</th>
                <th scope="col" className="px-3 py-2">Under the draft</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vm.simulationDelta.map((r) => (
                <tr key={r.label}>
                  <td className="px-3 py-2 align-top text-slate-700">{r.label}</td>
                  <td className="px-3 py-2 align-top"><Cell cell={r.before} /></td>
                  <td className="px-3 py-2 align-top"><Cell cell={r.after} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {approved ? (
        <section aria-label="Activation" role="status" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 animate-fade-in" data-testid="policy-activated">
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
            <StatusBadge status="done" label="Approved and activated" />
            <span className="font-mono text-xs text-slate-800">
              {vm.activation.fromVersion} → {vm.activation.toVersion}
            </span>
          </p>
          <p className="text-sm text-slate-700">{vm.changedRerunResult}</p>
          <PrimaryLink href={demoHref("record", routeContext)}>View the printable decision record</PrimaryLink>
        </section>
      ) : (
        <section aria-label="Approval gate" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4">
          <p className="text-sm text-slate-600">Activation requires attributed human approval. Nothing governs until a person says go.</p>
          <PrimaryLink href={demoHref("policy-authoring", routeContext, { approved: true })}>{vm.gateLabel}</PrimaryLink>
        </section>
      )}

      <JourneyNav back={{ href: demoHref("comparison", routeContext), label: "Back to the comparison" }} />
    </SurfaceShell>
  );
}
