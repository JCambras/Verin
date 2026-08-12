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

/**
 * No column is sortable. Precedence is the claim this register makes - "the order they
 * were applied" - so a viewer who could reorder it would be reading a different claim,
 * exactly as with the append-only ExecutionTimeline.
 */
const COLUMNS: readonly TableColumn[] = [
  { id: "order", header: "#", align: "right" },
  { id: "rule", header: "Rule" },
  { id: "result", header: "Result" },
  { id: "provision", header: "Provision" },
];

export function PolicyTraceSurface({ vm, scenarioId, firmId, journeyContinues }: { vm: PolicyTraceVM; scenarioId: string; firmId: string; journeyContinues: boolean }) {
  const rows: readonly TableRow[] = vm.rows.map((row) => ({
    id: String(row.order),
    cells: {
      order: { content: row.order, className: "text-slate-600" },
      rule: {
        content: (
          <div className="flex flex-col items-start gap-1 text-slate-800">
            {row.rule}
            {row.why ? <WhyBubble reason={row.why.reason} {...(row.why.regulation ? { regulation: row.why.regulation } : {})} /> : null}
          </div>
        ),
      },
      result: { content: row.result },
      provision: { content: row.version, className: "font-mono text-xs whitespace-nowrap text-slate-500" },
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
