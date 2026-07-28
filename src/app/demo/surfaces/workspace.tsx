/**
 * Surface 1 - Household workspace (demo contract §4.1; design §3 row 1). The
 * household is already the primary context; every figure carries provenance; the
 * intent panel is the EmptyState on-ramp (its action is this surface's one primary).
 * No DecisionSpine: no decision is in flight yet.
 */
import { Metric } from "@app/presentation/metric";
import { FreshValue } from "@app/presentation/fresh-value";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { EvidenceMissing } from "@app/presentation/evidence-row";
import { EmptyState } from "@app/presentation/ui";
import { DEV_BADGE_TEXT, type WorkspaceVM } from "../model";
import { PrimaryLink, SurfaceShell, demoHref } from "./shared";

export function WorkspaceSurface({ vm, scenarioId, firmId }: { vm: WorkspaceVM; scenarioId: string; firmId: string }) {
  return (
    <SurfaceShell
      title={vm.household.name}
      description={`Advised by ${vm.household.advisor}`}
    >
      <p className="flex items-center gap-2 text-xs text-slate-600">
        <FreshValue provenance={vm.household.provenance}>Household record</FreshValue>
        <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.household.fakeClass]} />
      </p>

      <section aria-label="Accounts" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">Accounts</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {vm.accounts.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-surface p-4">
              <p className="text-sm font-medium text-slate-800">{a.name}</p>
              <p className="text-xs text-slate-600">{a.kind}</p>
              <p className="text-sm">
                <Metric metric={a.balance} />
              </p>
              <p className="flex items-center gap-2 text-xs text-slate-600">
                Custodian: <FreshValue provenance={a.custodian.provenance}>{a.custodian.display}</FreshValue>
                <DevProvenanceBadge label={DEV_BADGE_TEXT[a.fakeClass]} />
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Liquidity" className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-surface p-4">
        <h2 className="text-base font-semibold text-slate-900">Liquidity</h2>
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          {vm.liquidity ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-slate-600">Available cash</dt>
              <dd className="text-sm">
                <Metric metric={vm.liquidity} />
              </dd>
            </div>
          ) : null}
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-slate-600">Planned monthly withdrawal</dt>
            <dd className="text-sm">
              <Metric metric={vm.plannedMonthlyWithdrawal} />
            </dd>
          </div>
        </dl>
        {vm.pendingActivity ? (
          <p className="text-sm text-slate-700">
            <FreshValue provenance={vm.pendingActivity.provenance}>{vm.pendingActivity.display}</FreshValue>
          </p>
        ) : null}
        {vm.liquidityAuthorityMissing ? (
          <EvidenceMissing text={`Missing signed liquidity authority - ${vm.liquidityAuthorityMissing}. No unrelated case was substituted.`} />
        ) : null}
      </section>

      <EmptyState
        title={vm.onRamp.title}
        description={vm.onRamp.description}
        action={<PrimaryLink href={demoHref("intent", scenarioId, firmId)}>Ask Verin about this household</PrimaryLink>}
      />
    </SurfaceShell>
  );
}
