/**
 * Surface 5 - Policy and precedence trace (demo contract §4.5; design §3 row 5). The
 * register idiom: ordered precedence rows, policy and instruction versions in
 * font-mono, a WhyBubble per precedence step. The trace explains the decision that
 * was made elsewhere; it decides nothing.
 */
import { WhyBubble } from "@app/presentation/why-bubble";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { Table, type TableColumn, type TableRow } from "@app/presentation/table";
import { DEV_BADGE_TEXT, type PolicyTraceVM } from "../model";
import { JourneyNav, SurfaceShell, demoHref } from "./shared";

const COLUMNS: readonly TableColumn[] = [
  { id: "order", header: "#", align: "right", sortable: true },
  { id: "rule", header: "Rule", sortable: true },
  { id: "result", header: "Result", sortable: true },
  { id: "provision", header: "Provision", sortable: true },
];

export function PolicyTraceSurface({ vm, scenarioId, firmId, journeyContinues }: { vm: PolicyTraceVM; scenarioId: string; firmId: string; journeyContinues: boolean }) {
  const rows: readonly TableRow[] = vm.rows.map((row) => ({
    id: String(row.order),
    cells: {
      order: { content: row.order, sortValue: row.order, className: "text-slate-600" },
      rule: {
        content: (
          <div className="flex flex-col items-start gap-1 text-slate-800">
            {row.rule}
            {row.why ? <WhyBubble reason={row.why.reason} {...(row.why.regulation ? { regulation: row.why.regulation } : {})} /> : null}
          </div>
        ),
        sortValue: row.rule,
      },
      result: { content: row.result, sortValue: row.result },
      provision: { content: row.version, sortValue: row.version, className: "font-mono text-xs whitespace-nowrap text-slate-500" },
    },
  }));
  return (
    <SurfaceShell spine={vm.spine} title="Policy and precedence" description="The rules that governed this decision, in the order they were applied.">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700">
        <span>
          Firm policy <span className="font-mono text-xs text-slate-800">{vm.firmPolicyVersion}</span>
        </span>
        <span>
          Household instructions <span className="font-mono text-xs text-slate-800">{vm.householdInstructionVersion}</span>
        </span>
        <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
      </p>

      <Table caption="Precedence trace, in application order" columns={COLUMNS} rows={rows} />

      <JourneyNav
        back={{ href: demoHref("decision", scenarioId, firmId), label: "Back to the decision" }}
        {...(journeyContinues ? { forward: { href: demoHref("authority", scenarioId, firmId), label: "Continue to authority" } } : {})}
      />
    </SurfaceShell>
  );
}
