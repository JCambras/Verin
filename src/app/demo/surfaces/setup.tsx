"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  MoneyMovementSetupVM,
  SetupActivatedSnapshotVM,
  SetupActivationResult,
  SetupAttestationChallengeVM,
  SetupFirmId,
  SetupPolicyGroupVM,
  SetupSelections,
  SetupStepVM,
} from "../setup-model";
import type {
  SetupActivationCommand,
  SetupActivationDraft,
  SetupAttestationResult,
} from "../setup-activation-contract";
import { ActivationBody, ChoicesBody, ImpactBody } from "./setup-choices";
import { ControlsBody, PostureBody, ProfilesBody } from "./setup-governance";
import { ProofBody } from "./setup-proof";
import { OutcomesBody, RequestBody } from "./setup-run";
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
  attestation,
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
  attestation: SetupAttestationChallengeVM | null;
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
          attestation={attestation}
        />
      );
    case "request":
      return snapshot ? (
        <RequestBody snapshot={snapshot} />
      ) : (
        <p role="alert" className="rounded-lg border border-destructive bg-white p-4 text-sm text-destructive">
          No immutable activated configuration is available. Return to activation and acknowledge the current draft.
        </p>
      );
    case "outcomes":
      return snapshot ? (
        <OutcomesBody snapshot={snapshot} />
      ) : (
        <p role="alert" className="rounded-lg border border-destructive bg-white p-4 text-sm text-destructive">
          Outcomes are unavailable because the current choices have not been activated.
        </p>
      );
    case "proof":
      return snapshot ? (
        <ProofBody
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
  attest,
  activate,
}: {
  vm: MoneyMovementSetupVM;
  attest: (draft: SetupActivationDraft) => Promise<SetupAttestationResult>;
  activate: (command: SetupActivationCommand) => Promise<SetupActivationResult>;
}) {
  const router = useRouter();
  const initial = useMemo(() => initialSelections(vm), [vm]);
  const [stepIndex, setStepIndex] = useState(0);
  // The draft carries its generation IN COMMITTED STATE. The F8 guard compares what
  // the user actually saw when they activated against what is on screen when the
  // response lands, so its inputs may only ever describe a committed render - never a
  // render pass React discarded (StrictMode double-invoke, an interrupted concurrent
  // render), which is why the updater below is pure and the mirror is an effect.
  const [draft, setDraft] = useState<SetupActivationDraft>(() =>
    captureSetupActivationDraft(0, initial, vm.setupVersionDigest),
  );
  const committedDraft = useRef(draft);
  useEffect(() => {
    committedDraft.current = draft;
  }, [draft]);
  const selections = draft.selections;
  const [attested, setAttested] = useState(false);
  const [attestation, setAttestation] =
    useState<SetupAttestationChallengeVM | null>(null);
  const [activeSnapshot, setActiveSnapshot] = useState<SetupActivatedSnapshotVM | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [exportFirmId, setExportFirmId] = useState<SetupFirmId | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const activePresentation = activeSnapshot?.presentation;
  const steps = activePresentation?.steps ?? vm.steps;
  const step = steps[stepIndex]!;
  const activationIndex = vm.steps.findIndex((candidate) => candidate.id === "activation");

  function move(nextIndex: number) {
    setStepIndex(nextIndex);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function select(firmId: SetupFirmId, groupId: SetupPolicyGroupVM["id"], optionId: string) {
    if (activating) return;
    setDraft((current) =>
      captureSetupActivationDraft(current.generation + 1, {
        ...current.selections,
        [firmId]: { ...current.selections[firmId], [groupId]: optionId },
      }, vm.setupVersionDigest),
    );
    setAttested(false);
    setAttestation(null);
    setActiveSnapshot(null);
    setActivationError(null);
    setExportFirmId(null);
    setExportError(null);
  }

  async function primary() {
    if (step.id === "activation") {
      if (!attested) {
        setActivationError("Confirm the demonstration attestation before activation.");
        return;
      }
      if (!attestation) {
        setActivationError(
          "The server-verified demonstration attestation is unavailable. Acknowledge the current draft again.",
        );
        return;
      }
      setActivationError(null);
      setActivating(true);
      const captured = captureSetupActivationDraft(
        committedDraft.current.generation,
        committedDraft.current.selections,
        vm.setupVersionDigest,
      );
      try {
        const result: SetupActivationResult = await activate({
          draftGeneration: captured.generation,
          selections: captured.selections,
          setupVersionDigest: captured.setupVersionDigest,
          attestationToken: attestation.token,
          statementVersion: attestation.statementVersion,
        });
        if (
          !activationResponseMatchesDraft(
            captured,
            committedDraft.current.generation,
            committedDraft.current.selections,
            vm.setupVersionDigest,
          )
        ) {
          setActiveSnapshot(null);
          setAttested(false);
          setAttestation(null);
          setActivationError(
            "The draft changed during activation. Review and acknowledge the current selections before trying again.",
          );
          return;
        }
        if (!result.ok) {
          setActiveSnapshot(null);
          setAttested(false);
          setAttestation(null);
          setActivationError(result.error);
          return;
        }
        if (
          result.snapshot.activationAcknowledgment.setupVersionDigest !==
          captured.setupVersionDigest
        ) {
          setActiveSnapshot(null);
          setAttested(false);
          setAttestation(null);
          setActivationError(
            "The activated setup version does not match the rules you reviewed. Reload and acknowledge the current setup.",
          );
          return;
        }
        setActiveSnapshot(result.snapshot);
        setAttested(false);
        setAttestation(null);
        move(stepIndex + 1);
      } catch {
        setActiveSnapshot(null);
        setAttested(false);
        setAttestation(null);
        setActivationError(
          activationResponseMatchesDraft(
            captured,
            committedDraft.current.generation,
            committedDraft.current.selections,
            vm.setupVersionDigest,
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
        setExportError(activeSnapshot ? activeSnapshot.presentation.proof.exportError : "Activate the current draft before export.");
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
      <SetupProgress steps={steps} activeIndex={stepIndex} />
      <p className="sr-only" aria-live="polite">
        Step {stepIndex + 1} of {steps.length}: {step.title}
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
          if (!value) {
            setAttested(false);
            setAttestation(null);
            setActivationError(null);
            return;
          }
          const captured = captureSetupActivationDraft(
            committedDraft.current.generation,
            committedDraft.current.selections,
            vm.setupVersionDigest,
          );
          setAttested(true);
          setActivating(true);
          setActivationError(null);
          void attest(captured)
            .then((result) => {
              if (
                !activationResponseMatchesDraft(
                  captured,
                  committedDraft.current.generation,
                  committedDraft.current.selections,
                  vm.setupVersionDigest,
                )
              ) {
                setAttested(false);
                setAttestation(null);
                setActivationError(
                  "The draft changed while the attestation was verified. Review and acknowledge the current selections again.",
                );
                return;
              }
              if (!result.ok) {
                setAttested(false);
                setAttestation(null);
                setActivationError(result.error);
                return;
              }
              if (
                result.challenge.setupVersionDigest !==
                captured.setupVersionDigest
              ) {
                setAttested(false);
                setAttestation(null);
                setActivationError(
                  "The server verified a different setup version. Reload and review the current setup.",
                );
                return;
              }
              setAttestation(result.challenge);
              setAttested(true);
            })
            .catch(() => {
              setAttested(false);
              setAttestation(null);
              setActivationError(
                "The server could not verify the demonstration attestation. Review the current draft and try again.",
              );
            })
            .finally(() => setActivating(false));
        }}
        activationError={activationError}
        activating={activating}
        attestation={attestation}
        exportFirmId={exportFirmId}
        onExportFirm={(firmId) => {
          setExportFirmId(firmId);
          setExportError(null);
        }}
        exportError={exportError}
      />
      <SetupActionRow
        primaryLabel={
          activating
            ? attestation
              ? "Activating…"
              : "Verifying acknowledgment…"
            : step.primaryLabel
        }
        primaryDisabled={activating}
        onPrimary={() => void primary()}
        {...(stepIndex > 0
          ? { onBack: back, backDisabled: activating }
          : {})}
      >
        {step.id === "activation"
          ? "One authenticated demo Principal acknowledges a synthetic lifecycle preview. The real lifecycle remains deferred."
          : stepIndex > activationIndex
            ? activeSnapshot
              ? "Demonstration versions activated locally for this setup-to-run proof."
              : "No demonstration version is active."
            : "Changes remain a labeled demonstration draft."}
      </SetupActionRow>
    </div>
  );
}
