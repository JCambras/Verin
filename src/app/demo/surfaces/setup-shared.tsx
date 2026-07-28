"use client";

import type { ReactNode } from "react";
import { DevProvenanceBadge } from "@app/presentation/dev-provenance-badge";
import { Metric } from "@app/presentation/metric";
import { Button, StatusBadge } from "@app/presentation/ui";
import { DEV_BADGE_TEXT } from "../model";
import type {
  MoneyMovementSetupVM,
  SetupChoiceOptionVM,
  SetupFirmId,
  SetupPolicyGroupVM,
  SetupStepVM,
} from "../setup-model";

export type SetupSelections = Record<SetupFirmId, Record<SetupPolicyGroupVM["id"], string>>;

export function selectedOption(
  groups: readonly SetupPolicyGroupVM[],
  selections: SetupSelections,
  groupId: SetupPolicyGroupVM["id"],
  firmId: SetupFirmId,
): SetupChoiceOptionVM {
  const group = groups.find((candidate) => candidate.id === groupId);
  const firm = group?.firms.find((candidate) => candidate.firmId === firmId);
  const selectedId = selections[firmId][groupId];
  const option = firm?.options.find((candidate) => candidate.id === selectedId);
  if (!option) throw new Error(`Missing setup option ${firmId}:${groupId}:${selectedId}`);
  return option;
}

export function SetupProgress({ steps, activeIndex }: { steps: readonly SetupStepVM[]; activeIndex: number }) {
  const active = steps[activeIndex]!;
  return (
    <section aria-label="Setup progress" className="border-b border-border pb-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600 sm:hidden">
        Step {activeIndex + 1} of {steps.length} · {active.shortLabel}
      </p>
      <ol className="hidden grid-cols-3 gap-2 sm:grid xl:grid-cols-9" aria-label="Setup progress">
        {steps.map((step, index) => {
          const current = index === activeIndex;
          const complete = index < activeIndex;
          return (
            <li
              key={step.id}
              aria-current={current ? "step" : undefined}
              className={`min-w-0 rounded-md border px-2 py-2 text-xs ${
                current
                  ? "border-slate-900 bg-slate-900 text-white"
                  : complete
                    ? "border-slate-300 bg-white text-slate-800"
                    : "border-slate-200 bg-surface text-slate-600"
              }`}
            >
              <span className="block font-semibold">{index + 1}</span>
              <span className="block break-words">{step.shortLabel}</span>
              <span className="sr-only">{current ? "Current step" : complete ? "Completed" : "Pending"}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function SetupHeading({ step }: { step: SetupStepVM }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{step.kicker}</p>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900">{step.title}</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">{step.description}</p>
    </div>
  );
}

export function SetupActionRow({
  primaryLabel,
  onPrimary,
  onBack,
  primaryDisabled,
  children,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  onBack?: () => void;
  primaryDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      data-testid="setup-action-row"
    >
      <div className="min-w-0 text-xs text-slate-600">{children}</div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {onBack ? (
          <Button type="button" variant="secondary" onClick={onBack}>
            Back
          </Button>
        ) : null}
        <Button type="button" onClick={onPrimary} disabled={primaryDisabled}>
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}

export function DemoNotice({ vm, text }: { vm: MoneyMovementSetupVM; text: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-surface p-3 text-xs text-slate-700">
      <DevProvenanceBadge label={DEV_BADGE_TEXT[vm.fakeClass]} />
      <span>{text}</span>
    </div>
  );
}

function OptionCard({
  group,
  firmId,
  option,
  selected,
  onSelect,
}: {
  group: SetupPolicyGroupVM;
  firmId: SetupFirmId;
  option: SetupChoiceOptionVM;
  selected: boolean;
  onSelect: (optionId: string) => void;
}) {
  const inputId = `${group.id}-${firmId}-${option.id}`;
  return (
    <label
      htmlFor={inputId}
      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 ${
        selected ? "border-slate-900 bg-surface" : "border-slate-200 bg-white"
      }`}
    >
      <input
        id={inputId}
        type="radio"
        name={`${group.id}-${firmId}`}
        value={option.id}
        checked={selected}
        onChange={() => onSelect(option.id)}
        className="mt-1 size-4 shrink-0 accent-slate-900"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
          {option.label}
          <StatusBadge status={option.truthLabel === "Signed" ? "done" : "pending"} label={option.truthLabel} />
        </span>
        {selected && option.detail ? <span className="mt-1 block text-xs text-slate-600">{option.detail}</span> : null}
        {selected && option.reserveMetric ? (
          <span className="mt-2 block">
            <Metric metric={option.reserveMetric} />
          </span>
        ) : null}
      </span>
    </label>
  );
}

function FirmOptions({
  group,
  firmId,
  firmLabel,
  options,
  selectedId,
  onSelect,
}: {
  group: SetupPolicyGroupVM;
  firmId: SetupFirmId;
  firmLabel: string;
  options: readonly SetupChoiceOptionVM[];
  selectedId: string;
  onSelect: (optionId: string) => void;
}) {
  return (
    <fieldset
      className="min-w-0 rounded-lg border border-slate-200 bg-white p-3"
      data-testid={`choice-${group.id}-${firmId}`}
    >
      <legend className="px-1 text-sm font-semibold text-slate-900">{firmLabel}</legend>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <OptionCard
            key={option.id}
            group={group}
            firmId={firmId}
            option={option}
            selected={selectedId === option.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function PolicyChoiceGroup({
  group,
  selections,
  onSelect,
}: {
  group: SetupPolicyGroupVM;
  selections: SetupSelections;
  onSelect: (firmId: SetupFirmId, groupId: SetupPolicyGroupVM["id"], optionId: string) => void;
}) {
  return (
    <section
      aria-labelledby={`group-${group.id}`}
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-surface p-4"
      data-testid={`policy-group-${group.id}`}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Firm policy</p>
          <span className="font-mono text-xs text-slate-600">{group.caseRef}</span>
        </div>
        <h2 id={`group-${group.id}`} className="mt-1 text-base font-semibold text-slate-900">
          {group.title}
        </h2>
        <p className="mt-1 text-sm text-slate-800">{group.question}</p>
        <p className="mt-1 text-xs text-slate-600">{group.rationale}</p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        {group.firms.map((firm) => {
          const profile = firm.firmId === "firm-a" ? "Firm A" : "Firm B";
          return (
            <FirmOptions
              key={firm.firmId}
              group={group}
              firmId={firm.firmId}
              firmLabel={profile}
              options={firm.options}
              selectedId={selections[firm.firmId][group.id]}
              onSelect={(optionId) => onSelect(firm.firmId, group.id, optionId)}
            />
          );
        })}
      </div>
    </section>
  );
}

export function CategoryLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center rounded border border-slate-300 bg-surface px-2 py-1 text-xs font-medium text-slate-700">
      {children}
    </span>
  );
}
