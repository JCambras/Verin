/**
 * Surface 4 - Recommendation and alternatives (demo contract §4.4; design §3 row 4,
 * §5). The DispositionNotice heads the view; proceed routes forward, blocked shows
 * its resolving affordances (and no forward), prohibited shows the solid slate badge,
 * its versioned source, and ZERO resolving affordances - only inspective links. The
 * disposition arrives on the typed view model; nothing here decides anything.
 */
import { FreshValue } from "@app/presentation/fresh-value";
import { Metric } from "@app/presentation/metric";
import { WhyBubble } from "@app/presentation/why-bubble";
import { DispositionNotice, InspectiveLinks } from "@app/presentation/disposition-notice";
import { DEV_BADGE_TEXT, DISPOSITION_LABELS, type RecommendationVM } from "../model";
import { JourneyNav, SurfaceShell, demoHref } from "./shared";

const SOURCE_KIND_LABELS = { "firm-policy": "firm policy", "household-instruction": "household instruction", regulatory: "regulatory" } as const;

export function RecommendationSurface({
  vm,
  scenarioId,
  firmId,
  querySuffix,
}: {
  vm: RecommendationVM;
  scenarioId: string;
  firmId: string;
  querySuffix?: string;
}) {
  const d = vm.disposition;
  return (
    <SurfaceShell spine={vm.spine} title="Decision" description="The governed action, the alternatives considered, and why they were rejected.">
      {vm.derivedDecision ? (
        <p
          className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-950"
          data-testid="derived-decision"
        >
          Derived decision on the refreshed evidence bundle
        </p>
      ) : null}
      <DispositionNotice
        kind={d.kind}
        headline={d.headline}
        why={d.why}
        badgeLabel={DISPOSITION_LABELS[d.kind]}
        devBadgeLabel={DEV_BADGE_TEXT[d.fakeClass]}
        {...(d.figures ? { figures: d.figures } : {})}
        {...(d.authoritySummary ? { authoritySummary: d.authoritySummary } : {})}
        {...(d.blockers ? { blockers: d.blockers } : {})}
        {...(d.prohibitedScope ? { prohibitedScope: d.prohibitedScope } : {})}
        {...(d.source ? { source: { ref: d.source.ref, provenance: d.source.provenance, kindLabel: SOURCE_KIND_LABELS[d.source.kind] } } : {})}
        {...(d.doctrine ? { doctrine: d.doctrine } : {})}
        {...(d.kind === "prohibited"
          ? {
              inspective: (
                <InspectiveLinks
                  links={[
                    { label: "View the policy trace", href: demoHref("policy-trace", scenarioId, firmId, querySuffix) },
                    { label: "View the printable record", href: demoHref("record", scenarioId, firmId) },
                  ]}
                />
              ),
            }
          : {})}
      />

      {vm.recommendation ? (
        <section aria-label="Recommended source" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4">
          <h2 className="text-base font-semibold text-slate-900">Recommended source</h2>
          <p className="flex flex-wrap items-baseline gap-2 text-sm text-slate-800">
            <FreshValue provenance={vm.recommendation.source.provenance}>{vm.recommendation.source.display}</FreshValue>
            <span className="text-xs text-slate-500">retrieved {vm.recommendation.source.retrievedAt}</span>
          </p>
          <p className="text-sm">
            <Metric metric={vm.recommendation.amount} />
          </p>
        </section>
      ) : null}

      {vm.alternatives.length > 0 ? (
        <section aria-label="Alternatives considered" className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-slate-900">Alternatives considered</h2>
          <ul className="flex flex-col gap-3">
            {vm.alternatives.map((a) => (
              <li key={a.title} className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-surface p-4">
                <p className="text-sm font-medium text-slate-800">{a.title}</p>
                <p className="text-sm text-slate-600">Rejected: {a.rejectedReason}</p>
                {a.why ? <WhyBubble reason={a.why.reason} {...(a.why.regulation ? { regulation: a.why.regulation } : {})} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <JourneyNav
        back={{ href: demoHref("evidence", scenarioId, firmId, querySuffix), label: "Back to the evidence" }}
        {...(d.kind === "proceed"
          ? { forward: { href: demoHref("policy-trace", scenarioId, firmId, querySuffix), label: "View the policy trace" } }
          : d.kind === "blocked"
            ? { forward: { href: demoHref("policy-trace", scenarioId, firmId, querySuffix), label: "View the policy trace" } }
            : {})}
      />
    </SurfaceShell>
  );
}
