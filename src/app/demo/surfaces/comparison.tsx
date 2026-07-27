/**
 * Surface 10 - Firm A / Firm B comparison (demo contract §4.10; design §3 row 10,
 * §10). Same household, same request, different approved policy version, materially
 * different outcome, zero code change. Difference is hierarchy, not highlighter; the
 * cause is policy-version provenance, one tap away per differing row. No spine: this
 * surface compares journeys rather than sitting inside one.
 */
import { ComparisonColumns } from "@app/presentation/comparison-columns";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { DEV_BADGE_TEXT, type ComparisonVM } from "../model";
import { JourneyNav, SecondaryLink, SurfaceShell, demoHref } from "./shared";

export function ComparisonSurface({ vm, scenarioId, firmId }: { vm: ComparisonVM; scenarioId: string; firmId: string }) {
  const otherFirm = firmId === "firm-a" ? "firm-b" : "firm-a";
  const otherName = firmId === "firm-a" ? "Firm B" : "Firm A";
  return (
    <SurfaceShell
      title="Firm A / Firm B"
      description="The same household and the same request under two approved policy versions. The differences below are driven by policy provenance, not code."
    >
      <p className="flex items-center gap-2 text-xs text-slate-600">
        <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
      </p>
      <ComparisonColumns columns={vm.columns} rows={vm.rows} />
      <SecondaryLink href={demoHref("decision", scenarioId, otherFirm)}>Rerun this request under {otherName}</SecondaryLink>
      <JourneyNav
        back={{ href: demoHref("verification", scenarioId, firmId), label: "Back to verification" }}
        forward={{ href: demoHref("policy-authoring", scenarioId, firmId), label: "Author a policy change" }}
      />
    </SurfaceShell>
  );
}
