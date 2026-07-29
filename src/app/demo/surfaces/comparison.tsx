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
import { JourneyNav, SecondaryLink, SurfaceShell, demoHref, type DemoRouteContext } from "./shared";

export function ComparisonSurface({
  vm,
  routeContext,
}: {
  vm: ComparisonVM;
  routeContext: DemoRouteContext;
}) {
  const otherFirm = routeContext.firmId === "firm-a" ? "firm-b" : "firm-a";
  const otherName = routeContext.firmId === "firm-a" ? "Firm B" : "Firm A";
  const target = vm.columns.find((column) => column.firmId === otherFirm);
  return (
    <SurfaceShell
      title="Firm A / Firm B"
      description={vm.description}
    >
      <p className="flex items-center gap-2 text-xs text-slate-600">
        <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
      </p>
      <ComparisonColumns columns={vm.columns} rows={vm.rows} />
      {target?.sourceCaseId ? (
        <SecondaryLink
          href={demoHref("decision", {
            ...routeContext,
            firmId: otherFirm,
            sourceCaseId: target.sourceCaseId,
            pass: "initial",
          })}
        >
          Rerun this request under {otherName}
        </SecondaryLink>
      ) : (
        <p className="text-sm text-slate-600">
          No exact signed {otherName} case is available for this rerun.
        </p>
      )}
      <JourneyNav
        back={{ href: demoHref("verification", routeContext), label: "Back to verification" }}
        forward={{ href: demoHref("policy-authoring", routeContext), label: "Author a policy change" }}
      />
    </SurfaceShell>
  );
}
