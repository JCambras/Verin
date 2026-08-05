"use client";

import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { StatusBadge } from "@app/presentation/ui";
import { DEV_BADGE_TEXT } from "../model";
import {
  isCaptainSignedImpact,
  setupFirmSelectionKey,
} from "../setup-model";
import type {
  ChoiceEffectVM,
  MoneyMovementSetupVM,
  SetupAttestationChallengeVM,
  SetupFirmId,
  SetupPolicyGroupVM,
  SetupSelections,
} from "../setup-model";
import {
  CategoryLabel,
  DemoNotice,
  PolicyChoiceGroup,
  TruthBadge,
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
        fakeClass={vm.fakeClass}
        text="Each choice is closed and presentation-ready. No free-form rule, script, regex, precedence editor, or unsupported adapter toggle exists in this path."
      />
    </>
  );
}

function ImpactFirmCard({
  firmId,
  firmLabel,
  effect,
  signed,
}: {
  firmId: SetupFirmId;
  firmLabel: string;
  effect: ChoiceEffectVM;
  signed: boolean;
}) {
  return (
    <article
      className="min-w-0 rounded-lg border border-slate-200 bg-white p-4"
      data-testid={`impact-${firmId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{firmLabel}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={effect.status.status} label={effect.status.label} />
          <StatusBadge
            status={signed ? "done" : "pending"}
            label={signed ? "Captain-signed outcome" : "Projected outcome"}
          />
        </div>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-900">{effect.summary}</p>
      <p className="mt-1 text-xs text-slate-600">{effect.detail}</p>
      {signed ? null : (
        <p className="mt-2 text-xs text-slate-800" data-testid={`impact-${firmId}-varied`}>
          Projected under the current selection. Exact captain-signed attribution is unavailable.
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
        fakeClass={vm.fakeClass}
        text="Signed-case impact is a labeled presentation preview until the deterministic evaluator and policy simulation lifecycle land."
      />
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        {vm.impacts.map((impact) => {
          const exactCase =
            impact.attributionKind === "exact-case";
          const group = exactCase
            ? vm.policyGroups.find((candidate) => candidate.id === impact.groupId)
            : undefined;
          const a = group
            ? selectedOption(vm.policyGroups, selections, group.id, "firm-a")
            : null;
          const b = group
            ? selectedOption(vm.policyGroups, selections, group.id, "firm-b")
            : null;
          const selectionEffect = (firmId: SetupFirmId) =>
            exactCase
              ? impact.selectionEffects?.[firmId].find(
                  (candidate) =>
                    candidate.selectionKey ===
                    setupFirmSelectionKey(selections[firmId]),
                )?.effect
              : undefined;
          const effectA =
            selectionEffect("firm-a") ?? a?.signedCaseEffect;
          const effectB =
            selectionEffect("firm-b") ?? b?.signedCaseEffect;
          const signedA = isCaptainSignedImpact(
            exactCase ? impact.attribution : undefined,
            "firm-a",
            selections,
          );
          const signedB = isCaptainSignedImpact(
            exactCase ? impact.attribution : undefined,
            "firm-b",
            selections,
          );
          const varied = exactCase && (!signedA || !signedB);
          if (
            exactCase &&
            (!group || !a || !b || !effectA || !effectB)
          ) {
            throw new Error(
              `Exact-case impact ${impact.id} has no complete firm projection`,
            );
          }
          return (
            <section
              key={impact.id}
              aria-labelledby={`impact-${impact.id}-title`}
              className="min-w-0 rounded-lg border border-slate-200 bg-surface p-4"
              data-testid={`signed-impact-${impact.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-700">{impact.caseRef}</span>
                <StatusBadge
                  status={
                    exactCase && !varied ? "done" : "pending"
                  }
                  label={
                    exactCase
                      ? varied
                        ? "Projection from signed case"
                        : "Captain-signed case"
                      : "Universal rule · not case-attributed"
                  }
                />
              </div>
              <h2 id={`impact-${impact.id}-title`} className="mt-2 text-base font-semibold text-slate-900">
                {impact.title}
              </h2>
              <p className="mt-1 text-xs text-slate-600">{impact.facts}</p>
              {exactCase && group && a && b && effectA && effectB ? (
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                  {group.firms.map((firm) => {
                    const selectedEffect =
                      firm.firmId === "firm-a" ? effectA : effectB;
                    return (
                      <ImpactFirmCard
                        key={firm.firmId}
                        firmId={firm.firmId}
                        firmLabel={firm.firmLabel}
                        effect={selectedEffect}
                        signed={
                          firm.firmId === "firm-a" ? signedA : signedB
                        }
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                  <StatusBadge status="done" label="Same safety rule" />
                  <p className="mt-2 text-sm text-slate-700">
                    {impact.attributionKind === "universal-rule"
                      ? impact.universalEffect
                      : null}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
        16 signed cases are available to the future real simulation lifecycle. Five high-signal cases are shown here.
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
  disabled,
  attestation,
}: {
  vm: MoneyMovementSetupVM;
  selections: SetupSelections;
  attested: boolean;
  onAttested: (checked: boolean) => void;
  error: string | null;
  disabled: boolean;
  attestation: SetupAttestationChallengeVM | null;
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
                    <dd className="flex flex-wrap items-center gap-2 text-slate-900">
                      {option.label}
                      <TruthBadge truthLabel={option.truthLabel} />
                    </dd>
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>

      <section aria-labelledby="review-binding-title" className="rounded-lg border border-slate-200 bg-surface p-4">
        <h2 id="review-binding-title" className="text-base font-semibold text-slate-900">
          Synthetic lifecycle preview
        </h2>
        <p className="mt-2">
          <DevProvenanceBadge
            label={DEV_BADGE_TEXT[vm.activation.lifecyclePreview.fakeClass]}
          />
        </p>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-600">Synthetic proposer</dt>
            <dd className="text-slate-900">
              {vm.activation.lifecyclePreview.proposer} ·{" "}
              {vm.activation.lifecyclePreview.proposerRole}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Synthetic approver</dt>
            <dd className="text-slate-900">
              {vm.activation.lifecyclePreview.approver} ·{" "}
              {vm.activation.lifecyclePreview.approverRole}
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
        {attestation ? (
          <dl
            className="mt-3 grid min-w-0 gap-2 rounded-md border border-slate-200 bg-surface p-3 text-xs sm:grid-cols-2"
            data-testid="setup-attestation"
          >
            <div className="min-w-0">
              <dt className="text-slate-600">Authenticated actor</dt>
              <dd className="break-all font-mono text-slate-800">
                {attestation.actor.opaqueId}
              </dd>
            </div>
            <div>
              <dt className="text-slate-600">Authenticated role</dt>
              <dd className="text-slate-800">{attestation.actor.role}</dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-slate-600">Reviewed setup version digest</dt>
              <dd className="break-all font-mono text-slate-800">
                {attestation.setupVersionDigest}
              </dd>
            </div>
          </dl>
        ) : null}
        <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-slate-300 p-3">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => onAttested(event.target.checked)}
            disabled={disabled}
            className="mt-1 size-4 shrink-0 accent-slate-900"
          />
          <span className="text-sm text-slate-800">
            {vm.activation.attestationStatement}
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
