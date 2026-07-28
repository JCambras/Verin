/**
 * Surface 5 - Policy and precedence trace (demo contract §4.5; design §3 row 5). The
 * register idiom: ordered precedence rows, policy and instruction versions in
 * font-mono, a WhyBubble per precedence step. The trace explains the decision that
 * was made elsewhere; it decides nothing.
 */
import { WhyBubble } from "@app/presentation/why-bubble";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type PolicyTraceVM } from "../model";
import { JourneyNav, SurfaceShell, demoHref } from "./shared";

export function PolicyTraceSurface({
  vm,
  scenarioId,
  firmId,
  journeyContinues,
  querySuffix,
}: {
  vm: PolicyTraceVM;
  scenarioId: string;
  firmId: string;
  journeyContinues: boolean;
  querySuffix?: string;
}) {
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

      <div
        role="region"
        aria-label="Precedence trace"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-slate-600"
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Precedence trace, in application order</caption>
          <thead className="bg-surface text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">#</th>
              <th scope="col" className="px-3 py-2">Rule</th>
              <th scope="col" className="px-3 py-2">Result</th>
              <th scope="col" className="px-3 py-2">Provision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vm.rows.map((r) => (
              <tr key={r.order}>
                <td className="px-3 py-2 align-top text-slate-600">{r.order}</td>
                <td className="px-3 py-2 align-top text-slate-800">
                  <div className="flex flex-col items-start gap-1">
                    {r.rule}
                    {r.why ? <WhyBubble reason={r.why.reason} {...(r.why.regulation ? { regulation: r.why.regulation } : {})} /> : null}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-slate-700">{r.result}</td>
                <td className="px-3 py-2 align-top font-mono text-xs whitespace-nowrap text-slate-500">{r.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <JourneyNav
        back={{ href: demoHref("decision", scenarioId, firmId, querySuffix), label: "Back to the decision" }}
        {...(journeyContinues ? { forward: { href: demoHref("authority", scenarioId, firmId, querySuffix), label: "Continue to authority" } } : {})}
      />
    </SurfaceShell>
  );
}
