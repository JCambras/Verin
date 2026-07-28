"use client";

import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { StatusBadge } from "@app/presentation/ui";
import { DEV_BADGE_TEXT } from "../model";
import type {
  MoneyMovementSetupVM,
  SetupFirmId,
  SetupPolicyGroupVM,
  SetupSelections,
} from "../setup-model";
import {
  CategoryLabel,
  DemoNotice,
  PolicyChoiceGroup,
  selectedOption,
} from "./setup-shared";

export function ChoicesBody({
  vm,
  selections,
  onSelect,
}: {
  vm: MoneyMovementSetupVM;
  selections: SetupSelections;
  onSelect: (firmId: SetupFirmId, groupId: SetupPolicyGroupVM["id"], optionId: string) => void;
}) {
  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="Same for both firms">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status="done" label="Same for both" />
          <CategoryLabel>Universal safety</CategoryLabel>
        </div>
        <p className="mt-2 text-sm text-slate-700">
          Deterministic evaluation, immutable versions, exact-input approval, distinct humans, revalidation,
          conflict control, idempotency, and proof-based status remain locked.
        </p>
      </section>

      <div className="flex flex-col gap-4">
        {vm.policyGroups.map((group) => (
          <PolicyChoiceGroup key={group.id} group={group} selections={selections} onSelect={onSelect} />
        ))}
      </div>

      <section
        aria-labelledby="requester-decision-title"
        className="rounded-lg border border-amber-200 bg-amber-50 p-4"
        data-testid="requester-awaiting-decision"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status="suspended" label="Awaiting decision" />
          <CategoryLabel>Requester participation</CategoryLabel>
        </div>
        <h2 id="requester-decision-title" className="mt-2 text-sm font-semibold text-amber-900">
          This setup does not bind a requester-participation rule
        </h2>
        <p className="mt-1 text-sm text-amber-900">{vm.activation.requesterDecisionNotice}</p>
      </section>

      <DemoNotice
        vm={vm}
        text="Each choice is closed and presentation-ready. No free-form rule, script, regex, precedence editor, or unsupported adapter toggle exists in this path."
      />
    </>
  );
}

function ImpactFirmCard({
  firmId,
  summary,
  detail,
  status,
  signed,
}: {
  firmId: SetupFirmId;
  summary: string;
  detail: string;
  status: { status: string; label: string };
  signed: boolean;
}) {
  const firmLabel = firmId === "firm-a" ? "Firm A" : "Firm B";
  return (
    <article
      className="min-w-0 rounded-lg border border-slate-200 bg-white p-4"
      data-testid={`impact-${firmId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{firmLabel}</h3>
        <StatusBadge status={status.status} label={status.label} />
      </div>
      <p className="mt-2 text-sm font-medium text-slate-900">{summary}</p>
      <p className="mt-1 text-xs text-slate-600">{detail}</p>
      {signed ? null : (
        <p className="mt-2 text-xs text-slate-800" data-testid={`impact-${firmId}-varied`}>
          Projected under the current selection. This outcome is not the one the signed case records.
        </p>
      )}
    </article>
  );
}

export function ImpactBody({
  vm,
  selections,
}: {
  vm: MoneyMovementSetupVM;
  selections: SetupSelections;
}) {
  return (
    <>
      <DemoNotice
        vm={vm}
        text="Signed-case impact is a labeled presentation preview until the deterministic evaluator and policy simulation lifecycle land."
      />
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        {vm.impacts.map((impact) => {
          const a = impact.groupId
            ? selectedOption(vm.policyGroups, selections, impact.groupId, "firm-a")
            : null;
          const b = impact.groupId
            ? selectedOption(vm.policyGroups, selections, impact.groupId, "firm-b")
            : null;
          const varied = (a !== null && a.truthLabel !== "Signed") || (b !== null && b.truthLabel !== "Signed");
          return (
            <section
              key={impact.id}
              aria-labelledby={`impact-${impact.id}-title`}
              className="min-w-0 rounded-lg border border-slate-200 bg-surface p-4"
              data-testid={`signed-impact-${impact.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-700">{impact.caseRef}</span>
                <StatusBadge status="done" label="Captain-signed case" />
                {varied ? <StatusBadge status="pending" label="Varied from signed selection" /> : null}
              </div>
              <h2 id={`impact-${impact.id}-title`} className="mt-2 text-base font-semibold text-slate-900">
                {impact.title}
              </h2>
              <p className="mt-1 text-xs text-slate-600">{impact.facts}</p>
              {a && b ? (
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                  <ImpactFirmCard
                    firmId="firm-a"
                    summary={a.signedCaseEffect.summary}
                    detail={a.signedCaseEffect.detail}
                    status={a.signedCaseEffect.status}
                    signed={a.truthLabel === "Signed"}
                  />
                  <ImpactFirmCard
                    firmId="firm-b"
                    summary={b.signedCaseEffect.summary}
                    detail={b.signedCaseEffect.detail}
                    status={b.signedCaseEffect.status}
                    signed={b.truthLabel === "Signed"}
                  />
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                  <StatusBadge status="done" label="Same safety rule" />
                  <p className="mt-2 text-sm text-slate-700">{impact.universalEffect}</p>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
        16 signed cases are available to the future real simulation lifecycle. Four high-signal cases are shown here.
      </p>
    </>
  );
}

export function ActivationBody({
  vm,
  selections,
  attested,
  onAttested,
  error,
}: {
  vm: MoneyMovementSetupVM;
  selections: SetupSelections;
  attested: boolean;
  onAttested: (checked: boolean) => void;
  error: string | null;
}) {
  return (
    <>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        {vm.profiles.map((profile) => (
          <article
            key={profile.firmId}
            className="min-w-0 rounded-lg border border-slate-200 bg-white p-5"
            data-testid={`activation-${profile.firmId}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">{profile.firmLabel}</h2>
              <StatusBadge status="pending" label="In review" />
            </div>
            <p className="mt-1 break-all font-mono text-xs text-slate-800">{profile.draftVersion}</p>
            <dl className="mt-4 grid gap-3 text-sm">
              {vm.policyGroups.map((group) => {
                const option = selectedOption(vm.policyGroups, selections, group.id, profile.firmId);
                return (
                  <div key={group.id}>
                    <dt className="text-xs text-slate-600">{group.title}</dt>
                    <dd className="text-slate-900">{option.label}</dd>
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>

      <section aria-labelledby="review-binding-title" className="rounded-lg border border-slate-200 bg-surface p-4">
        <h2 id="review-binding-title" className="text-base font-semibold text-slate-900">
          Distinct-human review
        </h2>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-600">Proposed by</dt>
            <dd className="text-slate-900">
              {vm.activation.proposer} · {vm.activation.proposerRole}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Reviewed by</dt>
            <dd className="text-slate-900">
              {vm.activation.approver} · {vm.activation.approverRole}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Signed-case snapshot</dt>
            <dd className="break-all font-mono text-xs text-slate-800">{vm.activation.simulationRef}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Demonstration effective time</dt>
            <dd className="text-slate-900">{vm.activation.effectiveAt}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-dashed border-slate-400 bg-white p-4">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
          <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
          Demonstration activation
        </p>
        <p className="mt-2 text-sm text-slate-700">{vm.activation.demonstrationNotice}</p>
        <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-slate-300 p-3">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => onAttested(event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-slate-900"
          />
          <span className="text-sm text-slate-800">
            I am the named demonstration approver, I reviewed both visible profiles, and I understand that
            this acknowledgment cannot activate production policy.
          </span>
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </>
  );
}
