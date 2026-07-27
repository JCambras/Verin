/**
 * Surface 2 - Contextual intent panel (demo contract §4.2; design §3 row 2). An
 * anchored panel attached to the workspace context - never a 50/50 chat layout. The
 * request renders with its user-input provenance; the interpreted intent echoes back
 * as typed slots INSIDE the set-apart drafted panel (§6.5: LLM-drafted wording is
 * visually set apart and labeled; figures are never LLM-drafted - the amount renders
 * through Metric at full weight).
 */
import { Metric } from "@app/presentation/metric";
import { FreshValue } from "@app/presentation/fresh-value";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type IntentVM } from "../model";
import { JourneyNav, SurfaceShell, demoHref } from "./shared";

export function IntentSurface({ vm, scenarioId, firmId }: { vm: IntentVM; scenarioId: string; firmId: string }) {
  return (
    <SurfaceShell
      spine={vm.spine}
      title="What does this household need?"
      description={`${vm.household} · the request below controls the software without replacing it.`}
    >
      <section aria-label="Advisor request" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Advisor request</p>
        <p className="flex flex-wrap items-baseline gap-2 text-base text-slate-900">
          <FreshValue provenance={vm.requestProvenance}>“{vm.requestText}”</FreshValue>
          <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.requestFakeClass]} />
        </p>
      </section>

      <section aria-label="Interpreted intent" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">Interpreted intent</h2>
        {/* LLM-drafted wording renders inside the WhyBubble panel recipe, set apart
            and labeled (§6.5). */}
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="flex items-center gap-2 text-xs text-slate-600">
            {vm.interpreted.draftLabel}
            <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.interpreted.fakeClass]} />
          </p>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {vm.interpreted.slots.map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5">
                <dt className="text-xs text-slate-600">{s.label}</dt>
                <dd className="text-sm text-slate-700">{s.metric ? <Metric metric={s.metric} /> : s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <JourneyNav
        back={{ href: demoHref("workspace", scenarioId, firmId), label: "Back to the workspace" }}
        forward={{ href: demoHref("evidence", scenarioId, firmId), label: "Gather evidence" }}
      />
    </SurfaceShell>
  );
}
