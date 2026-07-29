/**
 * Surface 3 - Evidence and conflict view (demo contract §4.3; design §3 row 3, §6).
 * FreshValue everywhere: source and observed time on every item, retrieved time as
 * trailing metadata, conflicts render BOTH values with the survivorship rule named,
 * gaps render as explicit missing rows. No unexplained AI-confidence anywhere. The
 * list fades in as ONE calm unit (no per-row stagger - §12.2).
 */
import { WhyBubble } from "@app/presentation/why-bubble";
import { EvidenceConflict, EvidenceMetricRow, EvidenceMissing, EvidenceRow } from "@app/presentation/evidence-row";
import { FreshValue } from "@app/presentation/fresh-value";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type EvidenceRowVM, type EvidenceVM } from "../model";
import { JourneyNav, SurfaceShell, demoHref, type DemoRouteContext } from "./shared";

function Row({ row }: { row: EvidenceRowVM }) {
  switch (row.kind) {
    case "metric":
      return (
        <EvidenceMetricRow label={row.label} metric={row.metric} retrievedAt={row.retrievedAt} badgeLabel={DEV_BADGE_TEXT[row.fakeClass]}>
          <p className="text-sm text-slate-700">{row.summary}</p>
          {row.why ? <WhyBubble reason={row.why.reason} {...(row.why.regulation ? { regulation: row.why.regulation } : {})} /> : null}
        </EvidenceMetricRow>
      );
    case "fact":
      return (
        <EvidenceRow label={row.label} fact={row.fact} badgeLabel={DEV_BADGE_TEXT[row.fakeClass]}>
          {row.why ? <WhyBubble reason={row.why.reason} {...(row.why.regulation ? { regulation: row.why.regulation } : {})} /> : null}
        </EvidenceRow>
      );
    case "conflict":
      return (
        <EvidenceConflict
          label={row.label}
          rule={row.rule}
          a={row.a}
          b={row.b}
          badgeLabel={DEV_BADGE_TEXT[row.fakeClass]}
          affordance={
            row.blockerAffordance ? (
              <button type="button" className="inline-flex items-center justify-center self-start rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
                {row.blockerAffordance}
              </button>
            ) : null
          }
        />
      );
    case "missing":
      return <EvidenceMissing text={row.text} />;
  }
}

export function EvidenceSurface({
  vm,
  routeContext,
}: {
  vm: EvidenceVM;
  routeContext: DemoRouteContext;
}) {
  return (
    <SurfaceShell
      spine={vm.spine}
      title="Evidence"
      description="Every item names its source, when it was observed, and when Verin retrieved it. Gaps and conflicts are stated, never hidden."
    >
      {vm.refreshNotice ? (
        <p
          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-surface p-4 text-sm text-slate-800"
          data-testid="refreshed-evidence"
        >
          <FreshValue provenance={vm.refreshNotice.fact.provenance}>
            {vm.refreshNotice.fact.display}
          </FreshValue>
          <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.refreshNotice.fakeClass]} />
        </p>
      ) : null}
      <div className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-surface px-4 py-2">
        {vm.rows.map((row, i) => (
          <Row key={i} row={row} />
        ))}
      </div>
      <JourneyNav
        back={{ href: demoHref("intent", routeContext), label: "Back to the request" }}
        forward={{ href: demoHref("decision", routeContext), label: "View the recommendation" }}
      />
    </SurfaceShell>
  );
}
