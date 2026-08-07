import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
  REAL_DERIVED_SCHEMA_FILES,
  realDerivedSchemaBindings,
} from "../../../scripts/corpus/manifest";
import {
  loadRealDerivedDelivery,
  realDerivedCaseProblems,
} from "../../../scripts/corpus/scrub-contract";
import { parseStrictJson } from "../../../scripts/corpus/strict-json";
import { realDerivedProblems } from "../../../scripts/corpus/validate";
import {
  ACTOR_REF_ALT,
  canonicalFixtureBytes,
  EVIDENCE_SOURCE_REF,
  INSTRUCTION_REF_ALT,
  OWNER_REF,
  PENDING_ACTION_REF,
  RESTRICTION_REF,
} from "./_corpus-case-fixtures";
import { realDerivedCase } from "./_corpus-real-derived-fixtures";
import {
  classes,
  real,
} from "./_corpus-world";
import { REPO_ROOT } from "./_fence-utils";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - the replay payload contract:
 * versioned completeness, schema-declared uniqueness, outcome assertions, and
 * the strict JSON pass that refuses duplicate keys before inventory.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("the real-derived replay payload is versioned, complete, strict, and internally consistent", () => {
    const missing = realDerivedCase();
    delete missing.replayPayload;
    expect(
      realDerivedCaseProblems(
        missing,
        classes,
        "real-derived/RD-missing-payload.json",
      ).some((problem) => problem.includes("replayPayload")),
    ).toBe(true);

    const extra = realDerivedCase();
    (extra.replayPayload as Record<string, unknown>).accountNumber =
      "tok:1111222233334444";
    expect(
      realDerivedCaseProblems(
        extra,
        classes,
        "real-derived/RD-extra-payload.json",
      ).length,
    ).toBeGreaterThan(0);

    const nestedExtra = realDerivedCase();
    (nestedExtra.replayPayload as Record<string, any>).request.accountNumber =
      "tok:1111222233334444";
    expect(
      realDerivedCaseProblems(
        nestedExtra,
        classes,
        "real-derived/RD-extra-request.json",
      ).length,
    ).toBeGreaterThan(0);

    const ambiguous = realDerivedCase();
    (
      (ambiguous.replayPayload as Record<string, any>).identity
        .candidateRefs as string[]
    ).push(ACTOR_REF_ALT);
    expect(
      realDerivedCaseProblems(
        ambiguous,
        classes,
        "real-derived/RD-ambiguous-payload.json",
      ).length,
    ).toBeGreaterThan(0);

    const mismatched = realDerivedCase();
    const pending = (mismatched.replayPayload as Record<string, any>).liquidity
      .pendingAction;
    Object.assign(pending, {
      actionRef: PENDING_ACTION_REF,
      actionKind: "incoming-transfer",
      actionState: "pending",
      direction: "outgoing",
      liquidityClass: "credit",
      amountMinor: 500,
      evidenceSourceRef: EVIDENCE_SOURCE_REF,
    });
    expect(
      realDerivedCaseProblems(
        mismatched,
        classes,
        "real-derived/RD-incompatible-payload.json",
      ).length,
    ).toBeGreaterThan(0);

    const incompatibleMutations: Array<(payload: Record<string, any>) => void> = [
      (payload) => { payload.schemaVersion = "verin-real-derived-replay/9.9.9"; },
      (payload) => { payload.liquidity.reserveState = "missing"; },
      (payload) => { payload.authority.authorityState = "missing"; },
      (payload) => { payload.instructionConflict.conflictState = "present"; },
      (payload) => { payload.policy.restrictionRef = RESTRICTION_REF; },
      (payload) => { payload.request.destinationRef = INSTRUCTION_REF_ALT; },
      (payload) => { payload.policy.thresholdComparison = "below"; },
      (payload) => { payload.destination.ownerRefs.push(OWNER_REF); },
    ];
    for (const mutate of incompatibleMutations) {
      const candidate = realDerivedCase();
      mutate(candidate.replayPayload as Record<string, any>);
      expect(
        realDerivedCaseProblems(
          candidate,
          classes,
          "real-derived/RD-incompatible-payload.json",
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it("every schema-declared uniqueItems collection is enforced recursively", () => {
    const item = realDerivedCase();
    const payload = item.replayPayload as Record<string, any>;
    payload.liquidity.sources[0].ownerRefs.push(OWNER_REF);
    expect(
      realDerivedCaseProblems(
        item,
        classes,
        "real-derived/RD-duplicate-source-owner.json",
      ).join("\n"),
    ).toContain("replayPayload.liquidity.sources.0.ownerRefs.1");
  });

  it("outcome assertions are complete, unique, and class-compatible", () => {
    const duplicate = realDerivedCase();
    const duplicateOutcomes = (
      duplicate.replayPayload as Record<string, any>
    ).outcomes as Array<Record<string, string>>;
    duplicateOutcomes[1]!.defectClassId =
      duplicateOutcomes[0]!.defectClassId!;
    expect(
      realDerivedCaseProblems(
        duplicate,
        classes,
        "real-derived/RD-duplicate-outcome.json",
      ).join("\n"),
    ).toContain("exactly one expected-versus-observed");

    const incompatible = realDerivedCase();
    const outcome = (
      (incompatible.replayPayload as Record<string, any>).outcomes as Array<
        Record<string, string>
      >
    )[0]!;
    outcome.expectedTreatment = "render-with-time-zone-rules";
    expect(
      realDerivedCaseProblems(
        incompatible,
        classes,
        "real-derived/RD-incompatible-outcome.json",
      ).join("\n"),
    ).toContain("closed treatment vocabulary");
  });

  it("duplicate JSON keys are rejected before a delivered value can enter inventory", () => {
    const dir = mkdtempSync(join(tmpdir(), "verin-corpus-duplicate-key-"));
    try {
      writeFileSync(
        join(dir, "RD-00112233445566aa.json"),
        '{"subject":"Robert Smith","subject":"tok:0123456789abcdef"}\n',
      );
      const delivery = loadRealDerivedDelivery(dir);
      expect(delivery.files).toEqual([]);
      expect(delivery.problems.join("\n")).toContain(
        "canonical JSON with unique object keys",
      );
      expect(delivery.problems.join("\n")).not.toContain("Robert Smith");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("duplicate keys in hand-owned corpus schemas are rejected before parsing or hashing", () => {
    expect(() =>
      realDerivedSchemaBindings({
        "real-derived-case-schema.json":
          '{"$id":"verin-real-derived-case/1.0.0","$id":"verin-real-derived-case/9.9.9"}',
        "real-derived-replay-schema.json":
          '{"$id":"verin-real-derived-replay/1.0.0"}',
      }),
    ).toThrow(/duplicate/i);
    for (const name of [
      "world.json",
      "cases.json",
      "defect-taxonomy.json",
      "real-derived-semantic-contract.json",
      ...REAL_DERIVED_SCHEMA_FILES,
    ]) {
      const bytes = readFileSync(
        join(REPO_ROOT, "fixtures/corpus/spec", name),
        "utf8",
      );
      expect(() =>
        parseStrictJson(
          bytes.replace(
            /^\{/,
            '{"duplicate-probe":1,"duplicate-probe":2,',
          ),
          name,
        ),
      ).toThrow(/duplicate/i);
    }
  });

  it("a semantic-contract gap beside a delivered file is REPORTED, never thrown past the problem list", () => {
    const root = mkdtempSync(join(tmpdir(), "verin-corpus-contract-gap-"));
    try {
      const intake = join(root, "real-derived");
      mkdirSync(intake, { recursive: true });
      writeFileSync(join(intake, "README.md"), "intake\n");
      writeFileSync(
        join(intake, "RD-00112233445566aa.json"),
        canonicalFixtureBytes(realDerivedCase({ occurredAt: "not-an-instant" })),
      );
      // Baseline: with the contract inventory intact, the delivered file is
      // inspected and its OWN problems are what come back.
      expect(
        realDerivedProblems(
          real.taxonomy,
          real.spec.world.corpusVersion,
          intake,
        ).join("\n"),
      ).toContain("schema validation failed");
      // A contract that does not account for the closed taxonomy is a gap in the
      // very authority the per-case detectors EXECUTE. The gap is named and the
      // per-file spread never runs - a detector over injected data reports, and
      // only the generator may abort.
      const gapped = structuredClone(real.taxonomy);
      gapped.defectClasses = [
        ...gapped.defectClasses,
        {
          ...gapped.defectClasses[0]!,
          id: "unaccounted-defect-class",
        },
      ];
      const problems = realDerivedProblems(
        gapped,
        real.spec.world.corpusVersion,
        intake,
      );
      expect(problems.join("\n")).toContain(
        'real-derived replay semantics missing defect class "unaccounted-defect-class"',
      );
      expect(problems.join("\n")).not.toContain("schema validation failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("bytes the strict pass cannot finish are REFUSED, never handed to a duplicate-blind JSON.parse", () => {
    // The YAML pass is the only thing that sees a repeated key at all
    // (`JSON.parse` resolves it last-wins), so a diagnostic that ABANDONS the
    // scan is a duplicate-key bypass, not a curiosity: below, the composer gives
    // up before it ever compares the two "a" keys while `JSON.parse` accepts the
    // same bytes, and the old fall-through returned {"a":2} reporting nothing.
    // The nesting is SEARCHED rather than pinned because where the composer
    // gives up is a property of the host stack, not of the corpus.
    const abandoned = [2_000, 8_000, 32_000, 128_000]
      .map((depth) => `${"[".repeat(depth)}{"a":1,"a":2}${"]".repeat(depth)}\n`)
      .find(
        (bytes) =>
          !parseDocument(bytes, { strict: true, uniqueKeys: true }).errors.some(
            (error) => error.code === "DUPLICATE_KEY",
          ),
      );
    expect(abandoned, "no probe made the strict pass abandon its scan").toBeDefined();
    expect(() => JSON.parse(abandoned!)).not.toThrow();
    expect(() => parseStrictJson(abandoned!, "probe.json")).toThrow(
      "probe.json: invalid JSON",
    );
    expect(() => parseStrictJson('{"a":1,"a":2}\n', "probe.json")).toThrow(
      "probe.json: duplicate object key",
    );
    expect(parseStrictJson('{"a":1}\n', "probe.json")).toEqual({ a: 1 });
  });

  it("unsafe delivery filenames never enter intake diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "verin-corpus-unsafe-path-"));
    try {
      mkdirSync(join(dir, "Robert-Smith"));
      writeFileSync(
        join(dir, "Robert-Smith", "account-1234.json"),
        canonicalFixtureBytes(realDerivedCase()),
      );
      const diagnostics = loadRealDerivedDelivery(dir).problems.join("\n");
      expect(diagnostics).not.toContain("Robert-Smith");
      expect(diagnostics).not.toContain("account-1234");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
