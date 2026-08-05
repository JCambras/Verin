"use client";

/**
 * Setup step 9 - the complete proof trail and the per-firm export choice. Split out of
 * setup-run.tsx when the trail grew the frozen selection list; it renders the activated
 * snapshot verbatim and derives nothing (design §10, RULE B).
 */
import { StatusBadge } from "@app/presentation/ui";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { Metric } from "@app/presentation/metric";
import { DEV_BADGE_TEXT, DISPOSITION_LABELS } from "../model";
import {
  POSTURE_OPTION_LABEL,
  POSTURE_STATUS,
  type SetupActivatedSnapshotVM,
  type SetupFirmId,
} from "../setup-model";
import { CategoryLabel, DemoNotice } from "./setup-shared";

function Trail({
  snapshot,
  firmId,
}: {
  snapshot: SetupActivatedSnapshotVM;
  firmId: SetupFirmId;
}) {
  const identity = snapshot.firms.find((candidate) => candidate.firmId === firmId)!;
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
          <CategoryLabel>User-entered demo input</CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">1. Request pinned</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-600">{snapshot.presentation.request.requestRef}</p>
          <p className="mt-2">
            <DevProvenanceBadge
              label={DEV_BADGE_TEXT["user-entered-demo-input"]}
            />
          </p>
        </li>
        <li className="rounded-md border border-slate-200 bg-surface p-3">
          <CategoryLabel>Synthetic fixture</CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">2. Evidence pinned</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-600">{snapshot.presentation.request.evidenceRef}</p>
        </li>
        <li className="rounded-md border border-slate-200 bg-surface p-3">
          <CategoryLabel>Firm policy</CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">3. Policy evaluated</p>
          {/* Every frozen choice with the authority it actually carries: an examiner
              sees WHICH of the five the captain signed, not a single summary claim. */}
          <dl className="mt-2 grid gap-2" data-testid={`proof-${firmId}-selections`}>
            {identity.selectedOptions.map((option) => (
              <div key={option.groupId} className="min-w-0">
                <dt className="text-xs text-slate-600">{option.groupTitle}</dt>
                <dd className="flex flex-wrap items-center gap-2 text-xs text-slate-800">
                  {option.label}
                  <StatusBadge
                    status={POSTURE_STATUS[option.posture]}
                    label={POSTURE_OPTION_LABEL[option.posture]}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </li>
        <li className="rounded-md border border-slate-200 bg-surface p-3">
          <CategoryLabel>Derived value</CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">4. Disposition recorded</p>
          <p className="mt-1 text-xs text-slate-600">{identity.disposition.headline}</p>
        </li>
        <li className="rounded-md border border-slate-200 bg-surface p-3">
          <CategoryLabel>
            {identity.authorityPlan.mode === "not-reached"
              ? "Universal safety"
              : "Authority result"}
          </CategoryLabel>
          <p className="mt-2 text-sm font-medium text-slate-900">
            5.{" "}
            {identity.authorityPlan.mode === "not-reached"
              ? "Path stops safely"
              : identity.authorityPlan.mode === "automatic"
                ? "Automatic authority, revalidation, and one submission"
                : "Staged authority, revalidation, and one submission"}
          </p>
          <p className="mt-1 text-xs font-medium text-slate-800">
            {identity.authorityPlan.summary}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {identity.authorityPlan.detail}
          </p>
          <dl className="mt-2 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-600">Configured standard-approval role</dt>
              <dd
                className="text-slate-800"
                data-testid={`proof-${firmId}-standard-approval-role`}
              >
                {identity.standardApprovalRole === "operations"
                  ? "Operations"
                  : "None configured for this authority mode"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Requester participation</dt>
              <dd
                className="text-slate-800"
                data-testid={`proof-${firmId}-requester-participation`}
              >
                {identity.requesterParticipation.mode === "unbound"
                  ? "Unbound in this demonstration"
                  : "Requester excluded"}
              </dd>
            </div>
          </dl>
          {identity.authorityPlan.mode === "automatic" ? (
            <dl className="mt-2 grid min-w-0 gap-2 text-xs">
              <div>
                <dt className="text-slate-600">Dual-approval threshold</dt>
                <dd className="text-slate-800">
                  <Metric metric={identity.authorityPlan.threshold} />
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">Policy source</dt>
                <dd className="break-all font-mono text-slate-800">
                  {identity.authorityPlan.policySource}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">Execution mode</dt>
                <dd className="text-slate-800">
                  {identity.authorityPlan.executionMode}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">Resulting authority state</dt>
                <dd className="text-slate-800">
                  {identity.authorityPlan.state}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">Signed automatic rule</dt>
                <dd className="text-slate-800">{identity.authorityPlan.rule}</dd>
              </div>
            </dl>
          ) : identity.authorityPlan.mode === "staged" ? (
            <ol className="mt-2 flex flex-col gap-1 text-xs text-slate-700">
              {identity.authorityPlan.stages.map((stage) => (
                <li key={stage.title}>
                  {stage.title}: {stage.requirement}
                </li>
              ))}
            </ol>
          ) : null}
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
          <dd className="flex flex-wrap items-center gap-2 break-words text-sm text-slate-800">
            <StatusBadge
              status={identity.configurationPostureStatus}
              label={identity.configurationPostureLabel}
            />
            <span data-testid={`identity-${firmId}-configuration-provenance`}>
              {identity.configurationProvenance}
            </span>
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
  snapshot,
  exportFirmId,
  onExportFirm,
  exportError,
}: {
  snapshot: SetupActivatedSnapshotVM;
  exportFirmId: SetupFirmId | null;
  onExportFirm: (firmId: SetupFirmId) => void;
  exportError: string | null;
}) {
  const { proof, fakeClass } = snapshot.presentation;
  return (
    <>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Trail snapshot={snapshot} firmId="firm-a" />
        <Trail snapshot={snapshot} firmId="firm-b" />
      </div>
      <section aria-labelledby="immutable-identifiers-title" className="rounded-lg border border-slate-200 bg-surface p-4">
        <h2 id="immutable-identifiers-title" className="text-base font-semibold text-slate-900">
          Immutable identifiers and provenance
        </h2>
        <dl className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-600">Evaluation source</dt>
            <dd className="text-sm text-slate-800">{proof.engineLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Data provenance</dt>
            <dd className="text-sm text-slate-800">{proof.dataProvenance}</dd>
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
            <dt className="text-xs text-slate-600">Authenticated activation actor</dt>
            <dd className="break-all font-mono text-xs text-slate-800">
              {snapshot.activationAcknowledgment.actor.opaqueId}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Authenticated role</dt>
            <dd className="text-sm text-slate-800">
              {snapshot.activationAcknowledgment.actor.role}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Attestation statement version</dt>
            <dd className="break-all font-mono text-xs text-slate-800">
              {snapshot.activationAcknowledgment.statementVersion}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Acknowledged draft generation</dt>
            <dd className="font-mono text-xs text-slate-800">
              {snapshot.activationAcknowledgment.draftGeneration}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-xs text-slate-600">Acknowledged selections hash</dt>
            <dd className="break-all font-mono text-xs text-slate-800">
              {snapshot.activationAcknowledgment.selectionsHash}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-xs text-slate-600">Acknowledged setup version digest</dt>
            <dd className="break-all font-mono text-xs text-slate-800">
              {snapshot.activationAcknowledgment.setupVersionDigest}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-xs text-slate-600">Demonstration acknowledgment</dt>
            <dd className="text-sm text-slate-800">
              {snapshot.activationAcknowledgment.statement}
            </dd>
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
        <legend className="px-1 text-base font-semibold text-slate-900">{proof.exportQuestion}</legend>
        <p className="text-sm text-slate-700">{proof.exportHint}</p>
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
        fakeClass={fakeClass}
        text="The export remains watermarked demonstration evidence. It cannot enter the real examiner export or feed a compliance decision."
      />
    </>
  );
}
