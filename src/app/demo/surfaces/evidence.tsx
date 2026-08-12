/**
 * Surface 3 - Evidence and conflict view (demo contract §4.3; design §3 row 3, §6).
 * FreshValue everywhere: source and observed time on every item, retrieved time as
 * trailing metadata, conflicts render BOTH values with the survivorship rule named,
 * gaps render as explicit missing rows. No unexplained AI-confidence anywhere. The
 * list fades in as ONE calm unit (no per-row stagger - §12.2).
 */
import { WhyBubble } from "@app/presentation/why-bubble";
import { EvidenceConflict, EvidenceMetricRow, EvidenceMissing, EvidenceRow } from "@app/presentation/evidence-row";
import { Button, Card } from "@app/presentation/ui";
import { DEV_BADGE_TEXT, type EvidenceRowVM, type EvidenceVM } from "../model";
import { JourneyNav, SurfaceShell, demoHref } from "./shared";

function Row({ row }: { row: EvidenceRowVM }) {
  switch (row.kind) {
    case "metric":
      return (
        <EvidenceMetricRow label={row.label} metric={row.metric} retrievedAt={row.retrievedAt} badgeLabel={DEV_BADGE_TEXT[row.fakeClass]}>
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
              <Button type="button" variant="secondary" className="self-start">
                {row.blockerAffordance}
              </Button>
            ) : null
          }
        />
      );
    case "missing":
      return <EvidenceMissing text={row.text} />;
  }
}

export function EvidenceSurface({ vm, scenarioId, firmId }: { vm: EvidenceVM; scenarioId: string; firmId: string }) {
  return (
    <SurfaceShell
      spine={vm.spine}
      title="Evidence"
      description="Every item names its source, when it was observed, and when Verin retrieved it. Gaps and conflicts are stated, never hidden."
    >
      <Card padding="none" className="flex flex-col divide-y divide-slate-100 px-4 py-2">
        {vm.rows.map((row, i) => (
          <Row key={i} row={row} />
        ))}
      </Card>
      <JourneyNav
        back={{ href: demoHref("intent", scenarioId, firmId), label: "Back to the request" }}
        forward={{ href: demoHref("decision", scenarioId, firmId), label: "View the recommendation" }}
      />
    </SurfaceShell>
  );
}
