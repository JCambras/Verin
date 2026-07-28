"use client";

import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { FreshValue } from "@app/presentation/fresh-value";
import { Metric } from "@app/presentation/metric";
import { StatusBadge } from "@app/presentation/ui";
import { DEV_BADGE_TEXT, DISPOSITION_LABELS } from "../model";
import type {
  MoneyMovementSetupVM,
  SetupActivatedSnapshotVM,
  SetupFirmId,
  SetupFactVM,
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
            <dd className="break-all font-mono text-xs text-slate-800">{vm.request.evidenceRef}</dd>
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
          <p className="mt-1 text-xs text-slate-600">{firm.configurationProvenance}</p>
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
            {firm.authorityPlan.reached ? "Authority path" : "Resolving condition"}
          </dt>
          <dd className="mt-1 text-sm text-slate-800">{firm.authorityPlan.summary}</dd>
          <dd className="mt-1 text-xs text-slate-600">{firm.authorityPlan.detail}</dd>
          {firm.authorityPlan.stages.length > 0 ? (
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
          <p className="mt-1 text-sm font-semibold text-slate-900">
            What does each active profile require for the same recent, unverified bank instruction?
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Firm A is not the winner and Firm B is not wrong. Both outcomes honor the same safety contract.
          </p>
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

function Trail({
  vm,
  snapshot,
  firmId,
}: {
  vm: MoneyMovementSetupVM;
  snapshot: SetupActivatedSnapshotVM;
  firmId: SetupFirmId;
}) {
  const identity = snapshot.firms.find((candidate) => candidate.firmId === firmId)!;
  const reserve = identity.selectedOptions.find(
    (option) => option.groupId === "reserve",
  )!;
  const bank = identity.selectedOptions.find(
    (option) => option.groupId === "bank-change",
  )!;
  return (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5" data-testid={`proof-${firmId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{identity.firmLabel} trail</h2>
          <p className="break-all font-mono text-xs text-slate-700">{identity.decisionId}</p>
        </div>
        <StatusBadge
          status={identity.disposition.kind}
          label={DISPOSITION_LABELS[identity.disposition.kind]}
        />
      </div>
      <ol className="mt-4 flex flex-col gap-3">
        <li className="rounded-md border border-slate-200 bg-surface p-3">
          <CategoryLabel>Synthetic fixture</CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">1. Evidence pinned</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-600">{vm.request.evidenceRef}</p>
        </li>
        <li className="rounded-md border border-slate-200 bg-surface p-3">
          <CategoryLabel>Firm policy</CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">2. Policy evaluated</p>
          <p className="mt-1 text-xs text-slate-600">
            {reserve.label}. {bank.label}.
          </p>
        </li>
        <li className="rounded-md border border-slate-200 bg-surface p-3">
          <CategoryLabel>Derived value</CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">3. Disposition recorded</p>
          <p className="mt-1 text-xs text-slate-600">{identity.disposition.headline}</p>
        </li>
        <li className="rounded-md border border-slate-200 bg-surface p-3">
          <CategoryLabel>{identity.authorityPlan.reached ? "Adapter fact" : "Universal safety"}</CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">
            4. {identity.authorityPlan.reached ? "Authority, revalidation, and one submission" : "Path stops safely"}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {identity.strongestProofDetail}
          </p>
        </li>
      </ol>
      <dl className="mt-4 grid min-w-0 gap-2 rounded-md border border-slate-200 bg-surface p-3" data-testid={`identity-${firmId}`}>
        <div>
          <dt className="text-xs text-slate-600">Activated snapshot version</dt>
          <dd className="break-all font-mono text-xs text-slate-800" data-testid={`identity-${firmId}-snapshot-version`}>
            {snapshot.snapshotVersion}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Activated snapshot hash</dt>
          <dd className="break-all font-mono text-xs text-slate-800" data-testid={`identity-${firmId}-snapshot-hash`}>
            {snapshot.snapshotHash}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Scenario</dt>
          <dd className="break-words text-sm text-slate-800" data-testid={`identity-${firmId}-scenario`}>
            {`${identity.scenarioLabel} · ${identity.scenarioId}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Firm</dt>
          <dd className="break-words text-sm text-slate-800" data-testid={`identity-${firmId}-firm`}>
            {`${identity.firmLabel} · ${identity.firmId}`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Decision id</dt>
          <dd className="break-all font-mono text-xs text-slate-800" data-testid={`identity-${firmId}-decision-id`}>
            {identity.decisionId}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Shared request/evidence input hash</dt>
          <dd className="break-all font-mono text-xs text-slate-800" data-testid={`identity-${firmId}-input-hash`}>
            {identity.inputHash}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Policy version</dt>
          <dd className="break-all font-mono text-xs text-slate-800" data-testid={`identity-${firmId}-policy-version`}>
            {identity.policyVersion}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Configuration hash</dt>
          <dd className="break-all font-mono text-xs text-slate-800" data-testid={`identity-${firmId}-configuration-hash`}>
            {identity.configurationHash}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Configuration provenance</dt>
          <dd className="break-words text-sm text-slate-800" data-testid={`identity-${firmId}-configuration-provenance`}>
            {identity.configurationProvenance}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Approval clock</dt>
          <dd className="break-words text-sm text-slate-800">
            {identity.approvalClock.id} · {identity.approvalClock.escalation} · {identity.approvalClock.expiry}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Disposition</dt>
          <dd className="break-words text-sm text-slate-800" data-testid={`identity-${firmId}-disposition`}>
            {identity.disposition.kind}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Explanation</dt>
          <dd className="break-words text-sm text-slate-800" data-testid={`identity-${firmId}-explanation`}>
            {identity.disposition.why.reason}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Decision hash</dt>
          <dd className="break-all font-mono text-xs text-slate-800" data-testid={`identity-${firmId}-decision-hash`}>
            {identity.decisionHash}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-600">Policy-bearing bundle hash</dt>
          <dd className="break-all font-mono text-xs text-slate-800" data-testid={`identity-${firmId}-bundle-hash`}>
            {identity.bundleHash}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function ProofBody({
  vm,
  snapshot,
  exportFirmId,
  onExportFirm,
  exportError,
}: {
  vm: MoneyMovementSetupVM;
  snapshot: SetupActivatedSnapshotVM;
  exportFirmId: SetupFirmId | null;
  onExportFirm: (firmId: SetupFirmId) => void;
  exportError: string | null;
}) {
  return (
    <>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Trail vm={vm} snapshot={snapshot} firmId="firm-a" />
        <Trail vm={vm} snapshot={snapshot} firmId="firm-b" />
      </div>
      <section aria-labelledby="immutable-identifiers-title" className="rounded-lg border border-slate-200 bg-surface p-4">
        <h2 id="immutable-identifiers-title" className="text-base font-semibold text-slate-900">
          Immutable identifiers and provenance
        </h2>
        <dl className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-600">Evaluation source</dt>
            <dd className="text-sm text-slate-800">{vm.proof.engineLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Data provenance</dt>
            <dd className="text-sm text-slate-800">Synthetic Smiths fixture · as of Jul 26, 2026</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Execution provenance</dt>
            <dd className="text-sm text-slate-800">Labeled fake adapter · no Salesforce sandbox claim</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Activated snapshot</dt>
            <dd className="break-all font-mono text-xs text-slate-800">{snapshot.snapshotVersion}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Canonical configuration</dt>
            <dd className="break-all font-mono text-xs text-slate-800">{snapshot.canonicalConfiguration}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Frozen selected option ids</dt>
            <dd className="break-all font-mono text-xs text-slate-800">{JSON.stringify(snapshot.selections)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Activated at</dt>
            <dd className="text-sm text-slate-800">{snapshot.activatedAt}</dd>
          </div>
        </dl>
      </section>
      <fieldset className="rounded-lg border border-slate-200 bg-white p-4" data-testid="export-choice">
        <legend className="px-1 text-base font-semibold text-slate-900">{vm.proof.exportQuestion}</legend>
        <p className="text-sm text-slate-700">{vm.proof.exportHint}</p>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
          {snapshot.firms.map((firm) => (
            <label
              key={firm.firmId}
              htmlFor={`export-${firm.firmId}`}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${
                exportFirmId === firm.firmId ? "border-slate-900 bg-surface" : "border-slate-200 bg-white"
              }`}
            >
              <input
                id={`export-${firm.firmId}`}
                type="radio"
                name="export-firm"
                value={firm.firmId}
                checked={exportFirmId === firm.firmId}
                onChange={() => onExportFirm(firm.firmId)}
                className="mt-1 size-4 shrink-0 accent-slate-900"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{firm.exportLabel}</span>
                <span className="mt-1 block break-words font-mono text-xs text-slate-700">{firm.decisionId}</span>
              </span>
            </label>
          ))}
        </div>
        {exportError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {exportError}
          </p>
        ) : null}
      </fieldset>
      <DemoNotice
        vm={vm}
        text="The export remains watermarked demonstration evidence. It cannot enter the real examiner export or feed a compliance decision."
      />
    </>
  );
}
