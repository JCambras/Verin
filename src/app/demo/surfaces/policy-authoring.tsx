/**
 * Surface 11 - Policy draft and simulation impact (demo contract §4.11; design §3
 * row 11). The natural-language sentence becomes a structured draft (LLM-drafted,
 * set apart and labeled - §6.5), a deterministic interpretation, a simulation delta
 * in aligned rows, and a human approval gate. Activation and the changed rerun
 * result appear only in the approved state - the gate is real choreography, not
 * decoration. A number is never LLM-drafted: every figure renders through Metric.
 */
import { Metric } from "@app/presentation/metric";
import { Card, StatusBadge } from "@app/presentation/ui";
import { Table, type TableColumn, type TableRow } from "@app/presentation/table";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import type { ComparisonCellVM, PolicyAuthoringVM } from "../model";
import { DEV_BADGE_TEXT } from "../model";
import { JourneyNav, PrimaryLink, SurfaceShell, demoHref } from "./shared";

/**
 * The simulation delta is a SET of affected cases, not a causal sequence: no row is a
 * consequence of the one above it, and a reviewer legitimately asks to see the changed
 * dimensions together. It is therefore sortable under D-194 - but only because the case
 * number below is visible and sortable, so the authored order is reconstructible from
 * data the reader can see rather than from the position a row happens to hold.
 */
const SIMULATION_COLUMNS: readonly TableColumn[] = [
  { id: "case", header: "#", align: "right", sortable: true },
  { id: "dimension", header: "Dimension", sortable: true },
  { id: "today", header: "Today", sortable: true },
  { id: "draft", header: "Under the draft", sortable: true },
];

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
  scenarioId,
  firmId,
  approved,
}: {
  vm: PolicyAuthoringVM;
  scenarioId: string;
  firmId: string;
  approved: boolean;
}) {
  const simulationRows: readonly TableRow[] = vm.simulationDelta.map((row, index) => ({
    id: row.label,
    cells: {
      case: { content: index + 1, sortValue: index + 1 },
      dimension: { content: row.label, sortValue: row.label },
      today: { content: <Cell cell={row.before} />, sortValue: row.before.display },
      draft: { content: <Cell cell={row.after} />, sortValue: row.after.display },
    },
  }));
  return (
    <SurfaceShell
      spine={vm.spine}
      title="Policy authoring"
      description="A policy sentence becomes structured, simulated, and humanly approved before it governs anything."
    >
      <Card as="section" aria-label="Policy sentence" className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Proposed policy</p>
        <p className="text-base text-slate-900">“{vm.sentence}”</p>
      </Card>

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
        <Table caption="Simulated impact of the drafted policy" columns={SIMULATION_COLUMNS} rows={simulationRows} />
      </section>

      {approved ? (
        <Card as="section" variant="white" aria-label="Activation" role="status" className="flex flex-col gap-2 animate-fade-in" data-testid="policy-activated">
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
            <StatusBadge status="done" label="Approved and activated" />
            <span className="font-mono text-xs text-slate-800">
              {vm.activation.fromVersion} → {vm.activation.toVersion}
            </span>
          </p>
          <p className="text-sm text-slate-700">{vm.changedRerunResult}</p>
          <PrimaryLink href={demoHref("record", scenarioId, firmId)}>View the printable decision record</PrimaryLink>
        </Card>
      ) : (
        <Card as="section" aria-label="Approval gate" className="flex flex-col gap-2">
          <p className="text-sm text-slate-600">Activation requires attributed human approval. Nothing governs until a person says go.</p>
          <PrimaryLink href={demoHref("policy-authoring", scenarioId, firmId, "&approved=1")}>{vm.gateLabel}</PrimaryLink>
        </Card>
      )}

      <JourneyNav back={{ href: demoHref("comparison", scenarioId, firmId), label: "Back to the comparison" }} />
    </SurfaceShell>
  );
}
