"use client";

import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { FreshValue } from "@app/presentation/fresh-value";
import { Metric } from "@app/presentation/metric";
import { StatusBadge } from "@app/presentation/ui";
import { DEV_BADGE_TEXT, DISPOSITION_LABELS } from "../model";
import {
  POSTURE_OPTION_LABEL,
  POSTURE_STATUS,
  type MoneyMovementSetupVM,
  type SetupActivatedSnapshotVM,
  type SetupFirmId,
  type SetupFactVM,
} from "../setup-model";
import { CategoryLabel, DemoNotice } from "./setup-shared";

function RequestFact({ fact }: { fact: SetupFactVM }) {
  return (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
      <CategoryLabel>{fact.category}</CategoryLabel>
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-600">{fact.label}</p>
      <div className="mt-1 min-w-0 text-sm text-slate-900">
        {fact.metric ? <Metric metric={fact.metric} /> : null}
        {fact.value ? <FreshValue provenance={fact.provenance}>{fact.value}</FreshValue> : null}
      </div>
      <p className="mt-2">
        <DevProvenanceBadge label={DEV_BADGE_TEXT[fact.fakeClass]} />
      </p>
    </article>
  );
}

export function RequestBody({
  vm,
  snapshot,
}: {
  vm: MoneyMovementSetupVM;
  snapshot: SetupActivatedSnapshotVM;
}) {
  return (
    <>
      <section aria-labelledby="request-summary-title" className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-600">One immutable request</p>
            <h2 id="request-summary-title" className="mt-1 text-base font-semibold text-slate-900">
              {vm.request.title}
            </h2>
          </div>
          <StatusBadge status="running" label="Ready to evaluate" />
        </div>
        <p className="mt-2 text-sm text-slate-700">{vm.request.summary}</p>
        <dl className="mt-4 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-600">Request identity</dt>
            <dd className="break-all font-mono text-xs text-slate-800">{vm.request.requestRef}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Pinned evidence</dt>
            <dd className="break-all font-mono text-xs text-slate-800">
              {snapshot.evidence.ref}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Evidence retrieved</dt>
            <dd className="break-all font-mono text-xs text-slate-800">
              {snapshot.evidence.retrievedAt}
            </dd>
          </div>
          <div>
            <dt className="sr-only">Evidence source identities</dt>
            <dd>
              <details className="group text-xs text-slate-800">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 font-medium text-slate-700">
                  <span aria-hidden className="group-open:hidden">
                    +
                  </span>
                  <span aria-hidden className="hidden group-open:inline">
                    −
                  </span>
                  View evidence source identities
                </summary>
                <ul className="flex min-w-0 flex-col gap-2 px-3 pb-1 pt-3">
                  {[
                    snapshot.evidence.availableCash,
                    snapshot.evidence.pendingApprovedActivity,
                    snapshot.evidence.plannedMonthlyWithdrawal,
                    snapshot.evidence.bankInstruction,
                    snapshot.evidence.destinationRestriction,
                    ...snapshot.evidence.conflictingFundingInstructions,
                  ].map((datum) => (
                    <li
                      key={`${datum.sourceRef}:${datum.subjectRef}`}
                      className="min-w-0"
                    >
                      <span className="block break-words font-mono">
                        {datum.sourceRef}
                      </span>
                      <span className="block break-words font-mono text-slate-600">
                        {datum.subjectRef}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </dd>
          </div>
          {snapshot.firms.map((firm) => (
            <div key={firm.firmId}>
              <dt className="text-xs text-slate-600">{firm.firmLabel} version</dt>
              <dd
                className="break-all font-mono text-xs text-slate-800"
                data-testid={`request-${firm.firmId}-policy-version`}
              >
                {firm.policyVersion}
              </dd>
              <dd
                className="break-all font-mono text-xs text-slate-600"
                data-testid={`request-${firm.firmId}-configuration-hash`}
              >
                {firm.configurationHash}
              </dd>
            </div>
          ))}
        </dl>
        <dl className="mt-4 grid min-w-0 gap-2 rounded-md border border-slate-200 bg-surface p-3">
          <div>
            <dt className="text-xs text-slate-600">Activated snapshot version</dt>
            <dd
              className="break-all font-mono text-xs text-slate-800"
              data-testid="request-snapshot-version"
            >
              {snapshot.snapshotVersion}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Activated snapshot hash</dt>
            <dd
              className="break-all font-mono text-xs text-slate-800"
              data-testid="request-snapshot-hash"
            >
              {snapshot.snapshotHash}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="request-facts-title" className="flex flex-col gap-3">
        <h2 id="request-facts-title" className="text-base font-semibold text-slate-900">
          Same facts for both profiles
        </h2>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {vm.request.facts.map((fact) => (
            <RequestFact key={fact.label} fact={fact} />
          ))}
        </div>
      </section>

      <section aria-labelledby="derived-reserves-title" className="flex flex-col gap-3">
        <div>
          <CategoryLabel>Derived value</CategoryLabel>
          <h2 id="derived-reserves-title" className="mt-2 text-base font-semibold text-slate-900">
            Reserve floors derived from the signed schedule
          </h2>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {snapshot.firms.map((firm) => (
            <article key={firm.firmId} className="min-w-0 rounded-lg border border-slate-200 bg-surface p-4">
              <h3 className="text-sm font-semibold text-slate-900">{firm.firmLabel}</h3>
              <p className="mt-2"><Metric metric={firm.reserveMetric} /></p>
              <p className="mt-2 text-xs text-slate-600">{firm.reserveDetail}</p>
            </article>
          ))}
        </div>
      </section>

      <DemoNotice
        vm={vm}
        text="The active labels above are local demonstration state. The fake adapter cannot establish Salesforce parity or a production policy lifecycle."
      />
    </>
  );
}

function OutcomeCard({
  snapshot,
  firmId,
}: {
  snapshot: SetupActivatedSnapshotVM;
  firmId: SetupFirmId;
}) {
  const firm = snapshot.firms.find((candidate) => candidate.firmId === firmId)!;

  return (
    <article
      className="min-w-0 rounded-lg border border-slate-200 bg-white p-5"
      data-testid={`outcome-${firmId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{firm.firmLabel}</h2>
          <p className="break-all font-mono text-xs text-slate-700">{firm.policyVersion}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge
              status={POSTURE_STATUS[firm.configurationPosture]}
              label={POSTURE_OPTION_LABEL[firm.configurationPosture]}
            />
            <span className="text-xs text-slate-600" data-testid={`outcome-${firmId}-configuration-provenance`}>
              {firm.configurationProvenance}
            </span>
          </p>
        </div>
        <StatusBadge
          status={firm.disposition.kind}
          label={DISPOSITION_LABELS[firm.disposition.kind]}
        />
      </div>

      <p
        className="mt-4 text-base font-semibold text-slate-900"
        data-testid={`outcome-${firmId}-headline`}
      >
        {firm.disposition.headline}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Disposition code:{" "}
        <span className="font-mono" data-testid={`outcome-${firmId}-disposition`}>
          {firm.disposition.kind}
        </span>
      </p>
      <p
        className="mt-1 text-sm text-slate-700"
        data-testid={`outcome-${firmId}-explanation`}
      >
        {firm.disposition.why.reason}
      </p>

      <dl className="mt-4 grid gap-3">
        <div className="rounded-md border border-slate-200 bg-surface p-3">
          <dt className="text-xs font-medium text-slate-600">Reserve proof</dt>
          <dd className="mt-1"><Metric metric={firm.reserveMetric} /></dd>
          <dd className="mt-1 text-xs text-slate-600">{firm.reserveSummary}</dd>
        </div>
        <div className="rounded-md border border-slate-200 bg-surface p-3">
          <dt className="text-xs font-medium text-slate-600">Evidence freshness</dt>
          <dd className="mt-1 text-sm text-slate-800">{firm.freshnessSummary}</dd>
          <dd className="mt-1 text-xs text-slate-600">{firm.freshnessDetail}</dd>
        </div>
        <div className="rounded-md border border-slate-200 bg-surface p-3">
          <dt className="text-xs font-medium text-slate-600">
            {firm.authorityPlan.mode === "not-reached"
              ? "Resolving condition"
              : "Authority mode"}
          </dt>
          <dd className="mt-1 text-sm text-slate-800">{firm.authorityPlan.summary}</dd>
          <dd className="mt-1 text-xs text-slate-600">{firm.authorityPlan.detail}</dd>
          {firm.authorityPlan.mode === "automatic" ? (
            <dd>
              <dl className="mt-2 grid min-w-0 gap-2 text-xs">
                <div>
                  <dt className="text-slate-600">Dual-approval threshold</dt>
                  <dd className="text-slate-800">
                    <Metric metric={firm.authorityPlan.threshold} />
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-600">Policy source</dt>
                  <dd className="break-all font-mono text-slate-800">
                    {firm.authorityPlan.policySource}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-600">Execution mode</dt>
                  <dd className="text-slate-800">
                    {firm.authorityPlan.executionMode}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-600">Resulting authority state</dt>
                  <dd className="text-slate-800">{firm.authorityPlan.state}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-slate-700">
                {firm.authorityPlan.rule}
              </p>
            </dd>
          ) : firm.authorityPlan.mode === "staged" ? (
            <dd>
              <ol className="mt-2 flex flex-col gap-1 text-xs text-slate-700">
                {firm.authorityPlan.stages.map((stage) => (
                  <li key={stage.title}>{stage.title}</li>
                ))}
              </ol>
            </dd>
          ) : null}
        </div>
      </dl>

      <div className="mt-4 rounded-md border border-slate-300 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Strongest honest proof</p>
        <p className="mt-1 text-sm font-medium text-slate-900">{firm.strongestProofTitle}</p>
        <p className="mt-1 text-xs text-slate-600">{firm.strongestProofDetail}</p>
      </div>
    </article>
  );
}

export function OutcomesBody({
  vm,
  snapshot,
}: {
  vm: MoneyMovementSetupVM;
  snapshot: SetupActivatedSnapshotVM;
}) {
  return (
    <>
      <section aria-label="Outcome comparison" className="flex flex-col gap-4">
        <div className="rounded-lg border border-slate-200 bg-surface p-4" data-testid="outcome-question">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Comparison question</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{vm.comparison.question}</p>
          <p className="mt-1 text-xs text-slate-600">{vm.comparison.fairness}</p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <OutcomeCard snapshot={snapshot} firmId="firm-a" />
          <OutcomeCard snapshot={snapshot} firmId="firm-b" />
        </div>
      </section>
      <DemoNotice
        vm={vm}
        text="Requester participation remains awaiting captain decision. This comparison shows the signed-case preview and does not bind that unresolved rule."
      />
    </>
  );
}
