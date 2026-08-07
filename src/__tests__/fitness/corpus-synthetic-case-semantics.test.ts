import { describe, expect, it } from "vitest";
import { generateSyntheticCases } from "../../../scripts/corpus/generate";
import { evidenceResolutionProblems } from "../../../scripts/corpus/graph";
import {
  PENDING_ACTION_KINDS,
  PENDING_ACTION_STATES,
  pendingActionLiquidityTreatment,
  pendingAvailabilityAdjustmentMinor,
  pendingAvailabilitySelector,
} from "../../../scripts/corpus/pending-actions";
import { CORPUS_SEED } from "../../../scripts/corpus/seed";
import {
  syntheticSemanticProblems,
  type EmittedCase,
} from "../../../scripts/corpus/synthetic-semantics";
import { specReferenceProblems } from "../../../scripts/corpus/world";
import { real } from "./_corpus-world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - synthetic case semantics: typed
 * treatment mismatches, authority and destination integrity, household edges,
 * and the emitted case graph.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("synthetic authority semantics require one cited signer", () => {
    const control = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-clean-fresh-authority",
      )!,
    );
    const signer = control.records.authorizedSigners[0]!;
    const evidence = control.evidence.find(
      (entry) => entry.kind === "authority",
    )!;
    control.records.authorizedSigners.push({
      ...signer,
      id: "authority:ambiguous-signer",
      authorityScope: "account-view",
    });
    control.evidence.push({
      ...evidence,
      id: `${evidence.id}-ambiguous`,
      subjectRef: "authority:ambiguous-signer",
    });
    expect(syntheticSemanticProblems([control]).join("\n")).toContain(
      "authority semantics require exactly one cited signer",
    );
  });

  it("synthetic destination integrity derives verification chronology", () => {
    const control = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-clean-verified-destination",
      )!,
    );
    const destination = control.records.bankInstructions.find(
      (entry) => entry.id === control.request.destinationRef,
    )!;
    destination.verifiedAt = "2026-07-27T00:00:00.000Z";
    expect(syntheticSemanticProblems([control]).join("\n")).toContain(
      "destination verification chronology is invalid",
    );
  });

  it("a request source account must belong to the request household", () => {
    const world = structuredClone(real.spec.world);
    const cases = structuredClone(real.spec.cases);
    const corpusCase = cases.cases[0]!;
    const foreignAccount = world.accounts.find(
      (account) => account.householdRef !== corpusCase.householdRef,
    )!;
    corpusCase.request.sourceAccountRef = foreignAccount.key;
    expect(specReferenceProblems(world, cases).join("\n")).toContain(
      `belongs to household "${foreignAccount.householdRef}", not request household "${corpusCase.householdRef}"`,
    );
  });

  it("AS-04 requires its cited signer to remain outside the request household membership", () => {
    const world = structuredClone(real.spec.world);
    const cases = structuredClone(real.spec.cases);
    expect(specReferenceProblems(world, cases)).toEqual([]);
    const emitted = real.cases.find(
      (item) => item.caseId === "CS-llc-signer-outside-household",
    )!;
    expect(
      emitted.records.parties.filter(
        (party) => party.id === "subject:kessa-varn",
      ),
    ).toHaveLength(1);
    expect(emitted.records.household.memberRefs).not.toContain(
      "subject:kessa-varn",
    );

    world.households.find(
      (household) => household.key === "varn",
    )!.memberRefs.push("kessa-varn");
    expect(specReferenceProblems(world, cases).join("\n")).toContain(
      "AS-04 outside-household signer",
    );
  });

  it("foreign destination owners use an opaque projection while local parties stay complete", () => {
    const spec = structuredClone(real.spec);
    spec.world.bankInstructions.find(
      (instruction) => instruction.key === "mira-primary",
    )!.titledTo = "kessa-varn";
    const foreignDestination = generateSyntheticCases(spec, CORPUS_SEED)
      .find(
        (file) =>
          file.relPath ===
            "synthetic/CS-beneficiary-versus-destination-restriction.json",
      )!.value as unknown as EmittedCase;
    expect(foreignDestination.records.parties).not.toContainEqual(
      expect.objectContaining({ id: "subject:kessa-varn" }),
    );
    expect(foreignDestination.records.referencedOwners).toEqual([
      { id: "subject:kessa-varn" },
    ]);

    const localDestination = real.cases.find(
      (item) => item.caseId === "CS-clean-verified-destination",
    )!;
    const localOwner = localDestination.records.bankInstructions.find(
      (instruction) => instruction.id === localDestination.request.destinationRef,
    )!.titledTo;
    expect(localDestination.records.parties).toContainEqual(
      expect.objectContaining({ id: localOwner }),
    );
    expect(localDestination.records.referencedOwners).not.toContainEqual({
      id: localOwner,
    });
  });

  it("bank-instruction and pending-action account edges must match their declared households", () => {
    const bankWorld = structuredClone(real.spec.world);
    bankWorld.bankInstructions[0]!.householdRef = "smith-mira";
    expect(
      specReferenceProblems(bankWorld, real.spec.cases).join("\n"),
    ).toContain("bank instruction account belongs to household");

    const pendingWorld = structuredClone(real.spec.world);
    pendingWorld.pendingActions[0]!.accountRef = "mira-roth";
    expect(
      specReferenceProblems(pendingWorld, real.spec.cases).join("\n"),
    ).toContain("pending action account belongs to household");
  });

  it("a missing evidence collection, dangling subject, multi-resolving subject, and duplicate spec key are rejected", () => {
    const changeCase = structuredClone(
      real.cases.find((item) => item.caseId === "CS-shared-instruction-change-blast-radius")!,
    );
    (changeCase.records as any).recentChanges = undefined;
    expect(
      evidenceResolutionProblems([changeCase]).some((problem) =>
        problem.includes("records.recentChanges: required emitted collection is missing"),
      ),
    ).toBe(true);

    const modelCase = structuredClone(
      real.cases.find((item) => item.caseId === "CS-pending-rebalance-during-evaluation")!,
    );
    modelCase.records.modelAssignments.push(
      structuredClone(
        modelCase.records.modelAssignments.find(
          (row) => row.id === "model-assignment:smiths-joint-model",
        )!,
      ),
    );
    expect(
      evidenceResolutionProblems([modelCase]).some((problem) =>
        problem.includes("resolves to 2 emitted records"),
      ),
    ).toBe(true);

    const destinationCase = structuredClone(
      real.cases.find(
        (item) => item.caseId === "CS-beneficiary-versus-destination-restriction",
      )!,
    );
    destinationCase.records.referencedAccounts = destinationCase.records.referencedAccounts.filter(
      (row) => row.id !== "subject:mira-roth",
    );
    expect(
      evidenceResolutionProblems([destinationCase]).some((problem) =>
        problem.includes("records.referencedBankInstructions.bank-instruction:mira-primary.accountRefs"),
      ),
    ).toBe(true);
    const missingHousehold = structuredClone(
      real.cases.find(
        (item) =>
          item.caseId ===
          "CS-beneficiary-versus-destination-restriction",
      )!,
    );
    missingHousehold.records.referencedHouseholds = [];
    expect(
      evidenceResolutionProblems([missingHousehold]).some((problem) =>
        problem.includes(
          "records.referencedAccounts.subject:mira-roth.householdRef",
        ),
      ),
    ).toBe(true);

    const world = structuredClone(real.spec.world);
    world.modelAssignments.push(structuredClone(world.modelAssignments[0]!));
    expect(
      specReferenceProblems(world, real.spec.cases).some((problem) =>
        problem.includes('modelAssignments: duplicate key "smiths-joint-model"'),
      ),
    ).toBe(true);
  });

  it("pending-action liquidity treatment is closed and direction-aware for every kind and state", () => {
    for (const kind of PENDING_ACTION_KINDS) {
      for (const state of PENDING_ACTION_STATES) {
        const treatment = pendingActionLiquidityTreatment(kind, state);
        const expectedReduction =
          (state === "pending" || state === "settling") &&
          treatment.direction === "outgoing" &&
          (treatment.liquidityClass === "distribution" ||
            treatment.liquidityClass === "debit");
        const expectedIncrease =
          state === "settled" &&
          treatment.direction === "incoming" &&
          treatment.liquidityClass === "credit";
        expect(treatment.reducesEffectiveLiquidity).toBe(expectedReduction);
        expect(treatment.increasesAvailableLiquidity).toBe(expectedIncrease);
      }
    }
  });

  it("reconciles settled outgoing debits exactly once", () => {
    expect(
      pendingAvailabilitySelector("outgoing-debit", "settled", true),
    ).toBe("settled-outgoing-included");
    expect(
      pendingAvailabilitySelector("outgoing-debit", "settled", false),
    ).toBe("settled-outgoing-excluded");
    expect(
      pendingAvailabilityAdjustmentMinor(
        "outgoing-debit",
        "settled",
        true,
        500n,
      ),
    ).toBe(0n);
    expect(
      pendingAvailabilityAdjustmentMinor(
        "outgoing-debit",
        "settled",
        false,
        500n,
      ),
    ).toBe(-500n);
  });
});
