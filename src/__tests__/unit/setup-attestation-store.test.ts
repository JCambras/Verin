import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SETUP_ATTESTATION_TTL_MS,
  consumeSetupAttestation,
  issueSetupAttestation,
  type SetupAttestationScope,
} from "@app/demo/setup-attestation-store";
import {
  SETUP_ATTESTATION_STATEMENT_VERSION,
} from "@app/demo/setup-model";
import type { SetupActivationCommand } from "@app/demo/setup-activation-contract";

let scopeSequence = 0;

function scope(): SetupAttestationScope {
  scopeSequence += 1;
  return {
    orgId: "org-demo",
    userId: `principal-${scopeSequence}`,
    sessionLineageId: `lineage-${scopeSequence}`,
    role: "principal",
  };
}

function command(
  token: string,
  generation = 4,
): SetupActivationCommand {
  return {
    draftGeneration: generation,
    selections: {
      "firm-a": {
        reserve: "6-months",
        freshness: "30-days",
        "bank-change": "specialist",
        threshold: "25000",
        expiry: "1d-3d",
      },
      "firm-b": {
        reserve: "12-months",
        freshness: "30-days",
        "bank-change": "block",
        threshold: "100000",
        expiry: "1d-3d",
      },
    },
    attestationToken: token,
    statementVersion: SETUP_ATTESTATION_STATEMENT_VERSION,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("setup attestation registry", () => {
  it("binds one attestation to its actor, session, generation, and selections", () => {
    const owner = scope();
    const selectionsHash = "1".repeat(64);
    const challenge = issueSetupAttestation(owner, {
      generation: 4,
      selectionsHash,
    });
    expect(
      consumeSetupAttestation(
        {
          ...owner,
          sessionLineageId: `${owner.sessionLineageId}-other`,
        },
        command(challenge.token),
        selectionsHash,
      ),
    ).toBeNull();
    expect(
      consumeSetupAttestation(owner, command(challenge.token), selectionsHash),
    ).toBe(challenge);
    expect(
      consumeSetupAttestation(owner, command(challenge.token), selectionsHash),
    ).toBeNull();
  });

  it("rejects forged and mismatched attestation data", () => {
    const owner = scope();
    const selectionsHash = "2".repeat(64);
    expect(
      consumeSetupAttestation(
        owner,
        command("f".repeat(64)),
        selectionsHash,
      ),
    ).toBeNull();

    const staleDraft = issueSetupAttestation(owner, {
      generation: 4,
      selectionsHash,
    });
    expect(
      consumeSetupAttestation(
        owner,
        command(staleDraft.token, 5),
        selectionsHash,
      ),
    ).toBeNull();

    const changedSelections = issueSetupAttestation(owner, {
      generation: 4,
      selectionsHash,
    });
    expect(
      consumeSetupAttestation(
        owner,
        command(changedSelections.token),
        "3".repeat(64),
      ),
    ).toBeNull();
  });

  it("expires unused attestations", () => {
    vi.useFakeTimers();
    const owner = scope();
    const selectionsHash = "4".repeat(64);
    const challenge = issueSetupAttestation(owner, {
      generation: 4,
      selectionsHash,
    });
    vi.advanceTimersByTime(SETUP_ATTESTATION_TTL_MS + 1);
    expect(
      consumeSetupAttestation(owner, command(challenge.token), selectionsHash),
    ).toBeNull();
  });

  it("consumes an attestation after credential rotation within one session lineage", () => {
    const owner = scope();
    const selectionsHash = "5".repeat(64);
    const challenge = issueSetupAttestation(owner, {
      generation: 4,
      selectionsHash,
    });
    expect(
      consumeSetupAttestation(
        { ...owner },
        command(challenge.token),
        selectionsHash,
      ),
    ).toBe(challenge);
  });
});
