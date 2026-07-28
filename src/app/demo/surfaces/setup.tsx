"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  MoneyMovementSetupVM,
  SetupActivatedSnapshotVM,
  SetupActivationResult,
  SetupFirmId,
  SetupPolicyGroupVM,
  SetupSelections,
  SetupStepVM,
} from "../setup-model";
import { ActivationBody, ChoicesBody, ImpactBody } from "./setup-choices";
import { ControlsBody, PostureBody, ProfilesBody } from "./setup-governance";
import { OutcomesBody, ProofBody, RequestBody } from "./setup-run";
import {
  SetupActionRow,
  SetupHeading,
  SetupProgress,
} from "./setup-shared";
import {
  activationResponseMatchesDraft,
  captureSetupActivationDraft,
} from "./setup-activation-state";

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
  snapshot,
  selections,
  onSelect,
  attested,
  onAttested,
  activationError,
  activating,
  exportFirmId,
  onExportFirm,
  exportError,
}: {
  vm: MoneyMovementSetupVM;
  step: SetupStepVM;
  snapshot: SetupActivatedSnapshotVM | null;
  selections: SetupSelections;
  onSelect: (firmId: SetupFirmId, groupId: SetupPolicyGroupVM["id"], optionId: string) => void;
  attested: boolean;
  onAttested: (value: boolean) => void;
  activationError: string | null;
  activating: boolean;
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
          disabled={activating}
        />
      );
    case "request":
      return snapshot ? (
        <RequestBody vm={vm} snapshot={snapshot} />
      ) : (
        <p role="alert" className="rounded-lg border border-destructive bg-white p-4 text-sm text-destructive">
          No immutable activated configuration is available. Return to activation and acknowledge the current draft.
        </p>
      );
    case "outcomes":
      return snapshot ? (
        <OutcomesBody vm={vm} snapshot={snapshot} />
      ) : (
        <p role="alert" className="rounded-lg border border-destructive bg-white p-4 text-sm text-destructive">
          Outcomes are unavailable because the current choices have not been activated.
        </p>
      );
    case "proof":
      return snapshot ? (
        <ProofBody
          vm={vm}
          snapshot={snapshot}
          exportFirmId={exportFirmId}
          onExportFirm={onExportFirm}
          exportError={exportError}
        />
      ) : (
        <p role="alert" className="rounded-lg border border-destructive bg-white p-4 text-sm text-destructive">
          Proof and export are unavailable because the current choices have not been activated.
        </p>
      );
  }
}

export function MoneyMovementSetupSurface({
  vm,
  activate,
}: {
  vm: MoneyMovementSetupVM;
  activate: (selections: SetupSelections) => Promise<SetupActivationResult>;
}) {
  const router = useRouter();
  const initial = useMemo(() => initialSelections(vm), [vm]);
  const [stepIndex, setStepIndex] = useState(0);
  const [selections, setSelections] = useState<SetupSelections>(initial);
  const currentSelections = useRef<SetupSelections>(initial);
  const draftGeneration = useRef(0);
  const [attested, setAttested] = useState(false);
  const [activeSnapshot, setActiveSnapshot] = useState<SetupActivatedSnapshotVM | null>(null);
  const [activating, setActivating] = useState(false);
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
    if (activating) return;
    setSelections((current) => {
      const next = {
        ...current,
        [firmId]: { ...current[firmId], [groupId]: optionId },
      };
      currentSelections.current = next;
      draftGeneration.current += 1;
      return next;
    });
    setAttested(false);
    setActiveSnapshot(null);
    setActivationError(null);
    setExportFirmId(null);
    setExportError(null);
  }

  async function primary() {
    if (step.id === "activation") {
      if (!attested) {
        setActivationError("Confirm the distinct-human demonstration attestation before activation.");
        return;
      }
      setActivationError(null);
      setActivating(true);
      const captured = captureSetupActivationDraft(
        draftGeneration.current,
        currentSelections.current,
      );
      try {
        const result: SetupActivationResult = await activate(captured.selections);
        if (
          !activationResponseMatchesDraft(
            captured,
            draftGeneration.current,
            currentSelections.current,
          )
        ) {
          setActiveSnapshot(null);
          setActivationError(
            "The draft changed during activation. Review and acknowledge the current selections before trying again.",
          );
          return;
        }
        if (!result.ok) {
          setActiveSnapshot(null);
          setActivationError(result.error);
          return;
        }
        setActiveSnapshot(result.snapshot);
        move(stepIndex + 1);
      } catch {
        setActiveSnapshot(null);
        setActivationError(
          activationResponseMatchesDraft(
            captured,
            draftGeneration.current,
            currentSelections.current,
          )
            ? "Activation failed closed before any configuration or decision identity was created."
            : "The draft changed during activation. Review and acknowledge the current selections before trying again.",
        );
      } finally {
        setActivating(false);
      }
      return;
    }
    if (step.id === "proof") {
      const target = activeSnapshot?.firms.find((candidate) => candidate.firmId === exportFirmId);
      if (!target) {
        setExportError(activeSnapshot ? vm.proof.exportError : "Activate the current draft before export.");
        return;
      }
      setExportError(null);
      router.push(target.exportHref);
      return;
    }
    move(stepIndex + 1);
  }

  function back() {
    if (activating) return;
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
        snapshot={activeSnapshot}
        selections={selections}
        onSelect={select}
        attested={attested}
        onAttested={(value) => {
          if (activating) return;
          setAttested(value);
          setActivationError(null);
        }}
        activationError={activationError}
        activating={activating}
        exportFirmId={exportFirmId}
        onExportFirm={(firmId) => {
          setExportFirmId(firmId);
          setExportError(null);
        }}
        exportError={exportError}
      />
      <SetupActionRow
        primaryLabel={activating ? "Activating…" : step.primaryLabel}
        primaryDisabled={activating}
        onPrimary={() => void primary()}
        {...(stepIndex > 0
          ? { onBack: back, backDisabled: activating }
          : {})}
      >
        {step.id === "activation"
          ? "The proposer and approver are different synthetic humans. Real activation remains blocked on the real lifecycle."
          : stepIndex > activationIndex
            ? activeSnapshot
              ? "Demonstration versions activated locally for this setup-to-run proof."
              : "No demonstration version is active."
            : "Changes remain a labeled demonstration draft."}
      </SetupActionRow>
    </div>
  );
}
