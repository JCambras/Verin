"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  MoneyMovementSetupVM,
  SetupFirmId,
  SetupPolicyGroupVM,
  SetupStepVM,
} from "../setup-model";
import { ActivationBody, ChoicesBody, ImpactBody } from "./setup-choices";
import { ControlsBody, PostureBody, ProfilesBody } from "./setup-governance";
import { OutcomesBody, ProofBody, RequestBody } from "./setup-run";
import {
  SetupActionRow,
  SetupHeading,
  SetupProgress,
  type SetupSelections,
} from "./setup-shared";

function initialSelections(vm: MoneyMovementSetupVM): SetupSelections {
  const selected = {
    "firm-a": {} as Record<SetupPolicyGroupVM["id"], string>,
    "firm-b": {} as Record<SetupPolicyGroupVM["id"], string>,
  };
  for (const group of vm.policyGroups) {
    for (const firm of group.firms) selected[firm.firmId][group.id] = firm.initialOptionId;
  }
  return selected;
}

function StepBody({
  vm,
  step,
  selections,
  onSelect,
  attested,
  onAttested,
  activationError,
  exportFirmId,
  onExportFirm,
  exportError,
}: {
  vm: MoneyMovementSetupVM;
  step: SetupStepVM;
  selections: SetupSelections;
  onSelect: (firmId: SetupFirmId, groupId: SetupPolicyGroupVM["id"], optionId: string) => void;
  attested: boolean;
  onAttested: (value: boolean) => void;
  activationError: string | null;
  exportFirmId: SetupFirmId | null;
  onExportFirm: (firmId: SetupFirmId) => void;
  exportError: string | null;
}) {
  switch (step.id) {
    case "profiles":
      return <ProfilesBody vm={vm} />;
    case "controls":
      return <ControlsBody vm={vm} />;
    case "posture":
      return <PostureBody vm={vm} />;
    case "choices":
      return <ChoicesBody vm={vm} selections={selections} onSelect={onSelect} />;
    case "impact":
      return <ImpactBody vm={vm} selections={selections} />;
    case "activation":
      return (
        <ActivationBody
          vm={vm}
          selections={selections}
          attested={attested}
          onAttested={onAttested}
          error={activationError}
        />
      );
    case "request":
      return <RequestBody vm={vm} selections={selections} />;
    case "outcomes":
      return <OutcomesBody vm={vm} selections={selections} />;
    case "proof":
      return (
        <ProofBody
          vm={vm}
          selections={selections}
          exportFirmId={exportFirmId}
          onExportFirm={onExportFirm}
          exportError={exportError}
        />
      );
  }
}

export function MoneyMovementSetupSurface({ vm }: { vm: MoneyMovementSetupVM }) {
  const router = useRouter();
  const initial = useMemo(() => initialSelections(vm), [vm]);
  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<SetupSelections>(initial);
  const [attested, setAttested] = useState(false);
  const [activated, setActivated] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [exportFirmId, setExportFirmId] = useState<SetupFirmId | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const step = vm.steps[stepIndex]!;
  const activationIndex = vm.steps.findIndex((candidate) => candidate.id === "activation");

  function move(nextIndex: number) {
    setStepIndex(nextIndex);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function select(firmId: SetupFirmId, groupId: SetupPolicyGroupVM["id"], optionId: string) {
    setSelections((current) => ({
      ...current,
      [firmId]: { ...current[firmId], [groupId]: optionId },
    }));
    setAttested(false);
    setActivated(false);
    setActivationError(null);
    setExportFirmId(null);
    setExportError(null);
  }

  function primary() {
    if (step.id === "activation") {
      if (!attested) {
        setActivationError("Confirm the distinct-human demonstration attestation before activation.");
        return;
      }
      setActivationError(null);
      setActivated(true);
      move(stepIndex + 1);
      return;
    }
    if (step.id === "proof") {
      const target = vm.proof.firms.find((candidate) => candidate.firmId === exportFirmId);
      if (!target) {
        setExportError(vm.proof.exportError);
        return;
      }
      setExportError(null);
      router.push(target.exportHref);
      return;
    }
    move(stepIndex + 1);
  }

  function back() {
    if (stepIndex > 0) move(stepIndex - 1);
  }

  return (
    <div
      className="relative left-1/2 flex w-[calc(100vw-2rem)] max-w-[1180px] -translate-x-1/2 flex-col gap-6 animate-fade-in"
      data-testid="setup-journey"
    >
      <SetupProgress steps={vm.steps} activeIndex={stepIndex} />
      <p className="sr-only" aria-live="polite">
        Step {stepIndex + 1} of {vm.steps.length}: {step.title}
      </p>
      <SetupHeading step={step} />
      <StepBody
        vm={vm}
        step={step}
        selections={selections}
        onSelect={select}
        attested={attested}
        onAttested={(value) => {
          setAttested(value);
          setActivationError(null);
        }}
        activationError={activationError}
        exportFirmId={exportFirmId}
        onExportFirm={(firmId) => {
          setExportFirmId(firmId);
          setExportError(null);
        }}
        exportError={exportError}
      />
      <SetupActionRow
        primaryLabel={step.primaryLabel}
        onPrimary={primary}
        {...(stepIndex > 0 ? { onBack: back } : {})}
      >
        {step.id === "activation"
          ? "The proposer and approver are different synthetic humans. Real activation remains blocked on the real lifecycle."
          : stepIndex > activationIndex
            ? activated
              ? "Demonstration versions activated locally for this setup-to-run proof."
              : "No demonstration version is active."
            : "Changes remain a labeled demonstration draft."}
      </SetupActionRow>
    </div>
  );
}
