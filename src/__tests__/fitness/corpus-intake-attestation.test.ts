import { describe, expect, it } from "vitest";
import { realDerivedCaseProblems } from "../../../scripts/corpus/scrub-contract";
import {
  CAPTAIN_SIGNING_AUTHORITY,
  parseSignoff,
  signoffProblems,
  type CorpusSignoff,
} from "../../../scripts/corpus/signoff";
import {
  OPAQUE,
  REQUEST_REF,
  treatmentOutcomes,
} from "./_corpus-case-fixtures";
import { realDerivedCase } from "./_corpus-real-derived-fixtures";
import {
  classes,
  real,
} from "./_corpus-world";

/**
 * CORPUS-PROVENANCE-SPLIT FENCE companions - fail-closed intake: derived
 * freshness, opaque identifiers, the scrub attestation's chronological custody,
 * free text, and the captain signoff agents can never originate.
 */

describe("detects (companion): a blended, mislabeled, unattested or self-congratulating corpus CANNOT pass", () => {

  it("real-derived freshness is derived from evaluation.asOf and the versioned per-kind policy", () => {
    const staleLabel = realDerivedCase();
    (staleLabel.evidence as Array<Record<string, unknown>>)[0]!.freshness =
      "stale";
    expect(
      realDerivedCaseProblems(
        staleLabel,
        classes,
        "real-derived/RD-stale-label.json",
      ).some((problem) => problem.includes('does not match derived "fresh"')),
    ).toBe(true);

    const futureRetrieval = realDerivedCase();
    (futureRetrieval.evidence as Array<Record<string, unknown>>)[0]!.retrievedAt =
      "2026-04-28T13:00:06.000Z";
    expect(
      realDerivedCaseProblems(
        futureRetrieval,
        classes,
        "real-derived/RD-future-retrieval.json",
      ).some((problem) => problem.includes("must not postdate evaluation.asOf")),
    ).toBe(true);

    const invertedObservation = realDerivedCase();
    (invertedObservation.evidence as Array<Record<string, unknown>>)[0]!.observedAt =
      "2026-04-28T13:00:05.000Z";
    expect(
      realDerivedCaseProblems(
        invertedObservation,
        classes,
        "real-derived/RD-inverted-observation.json",
      ).some((problem) => problem.includes("must not postdate retrievedAt")),
    ).toBe(true);

    const unknownPolicy = realDerivedCase();
    (unknownPolicy.evaluation as Record<string, unknown>).freshnessPolicyVersion =
      "verin-real-derived-freshness/9.9.9";
    expect(
      realDerivedCaseProblems(
        unknownPolicy,
        classes,
        "real-derived/RD-unknown-policy.json",
      ).some((problem) => problem.includes("freshnessPolicyVersion")),
    ).toBe(true);
  });

  it("freshness unknown requires the typed missing-observation state", () => {
    const missing = realDerivedCase();
    const payload = missing.replayPayload as Record<string, any>;
    payload.liquidity.reserveState = "missing";
    payload.liquidity.reserveRequiredMinor = null;
    payload.liquidity.withdrawalSegmentsMinor = [];
    payload.outcomes = treatmentOutcomes(
      payload,
      "destination-integrity-defect",
    );
    const reserveEvidence = (
      missing.evidence as Array<Record<string, unknown>>
    ).find(
      (entry) => entry.evidenceKind === "planned-withdrawals",
    )!;
    Object.assign(reserveEvidence, {
      observationState: "missing",
      observedAt: null,
      freshness: "unknown",
    });
    expect(
      realDerivedCaseProblems(
        missing,
        classes,
        "real-derived/RD-missing-observation.json",
      ),
    ).toEqual([]);

    const untypedUnknown = realDerivedCase();
    (untypedUnknown.evidence as Array<Record<string, unknown>>)[0]!.freshness =
      "unknown";
    expect(
      realDerivedCaseProblems(
        untypedUnknown,
        classes,
        "real-derived/RD-untyped-unknown.json",
      ).length,
    ).toBeGreaterThan(0);

    const unsupportedKind = realDerivedCase();
    (unsupportedKind.evidence as Array<Record<string, unknown>>)[0]!.evidenceKind =
      "advisor-note";
    expect(
      realDerivedCaseProblems(
        unsupportedKind,
        classes,
        "real-derived/RD-unsupported-kind.json",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("a real-derived derived id cannot hide a name or use an open suffix", () => {
    const named = realDerivedCase();
    (named.evidence as Array<Record<string, unknown>>)[0]!.id =
      "conflict:robert-smith-liquidity";
    expect(
      realDerivedCaseProblems(named, classes, "real-derived/RD-named-id.json").length,
    ).toBeGreaterThan(0);
    const openSuffix = realDerivedCase();
    (openSuffix.evidence as Array<Record<string, unknown>>)[0]!.id =
      "evs:tok:0123456789abcdef:advisor-note";
    expect(
      realDerivedCaseProblems(openSuffix, classes, "real-derived/RD-open-suffix.json").length,
    ).toBeGreaterThan(0);
    const mismatched = realDerivedCase();
    (mismatched.evidence as Array<Record<string, unknown>>)[0]!.evidenceKind =
      "authority";
    expect(
      realDerivedCaseProblems(mismatched, classes, "real-derived/RD-mismatch.json").some(
        (problem) => problem.includes("does not match evidenceKind"),
      ),
    ).toBe(true);
    const dangling = realDerivedCase({ subjects: [REQUEST_REF] });
    expect(
      realDerivedCaseProblems(dangling, classes, "real-derived/RD-dangling.json").some(
        (problem) => problem.includes("resolves to 0 subjects") ||
          problem.includes("exactly inventory"),
      ),
    ).toBe(true);
  });

  it("the scrub attestation requires an extractor identity and chronological custody", () => {
    const missingExtractor = realDerivedCase();
    delete (missingExtractor.scrubAttestation as Record<string, unknown>).extractedBy;
    expect(
      realDerivedCaseProblems(
        missingExtractor,
        classes,
        "real-derived/RD-no-extractor.json",
      ).some((problem) => problem.includes("extractedBy")),
    ).toBe(true);

    const reversed = realDerivedCase({
      scrubAttestation: {
        ...(realDerivedCase().scrubAttestation as object),
        extractedAt: "2026-05-04T13:00:00.000Z",
      },
    });
    expect(
      realDerivedCaseProblems(
        reversed,
        classes,
        "real-derived/RD-reversed.json",
      ).some((problem) => problem.includes("must not postdate")),
    ).toBe(true);
  });

  it("a real-derived case with FREE TEXT is rejected", () => {
    const problems = realDerivedCaseProblems(
      realDerivedCase({ subjects: ["Robert Smith"] }),
      classes,
      "real-derived/RD-freetext.json",
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("subjects");
    expect(problems.join("\n")).not.toContain("Robert Smith");
  });

  it("a real-derived case with a free-text field in an UNANTICIPATED key is rejected (fail-closed)", () => {
    const unexpected = realDerivedCase();
    unexpected["Robert Smith"] = "call the client back about the wire";
    const problems = realDerivedCaseProblems(
      unexpected,
      classes,
      "real-derived/RD-extra.json",
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).not.toContain(
      "call the client back about the wire",
    );
    expect(problems.join("\n")).not.toContain("Robert Smith");
  });

  it("a real-derived case MISSING its scrub attestation is rejected", () => {
    const withoutAttestation = realDerivedCase();
    delete withoutAttestation.scrubAttestation;
    const problems = realDerivedCaseProblems(withoutAttestation, classes, "real-derived/RD-unattested.json");
    expect(problems.some((p) => p.includes("scrubAttestation"))).toBe(true);
  });

  it("a self-reviewed scrub and an impossible record count are rejected", () => {
    const selfReviewed = realDerivedCase({
      scrubAttestation: { ...(realDerivedCase().scrubAttestation as object), reviewedBy: OPAQUE },
    });
    expect(
      realDerivedCaseProblems(selfReviewed, classes, "real-derived/RD-self.json").some((p) =>
        p.includes("reviewedBy must differ"),
      ),
    ).toBe(true);
    const inflated = realDerivedCase({
      scrubAttestation: { ...(realDerivedCase().scrubAttestation as object), recordsAfter: 999 },
    });
    expect(
      realDerivedCaseProblems(inflated, classes, "real-derived/RD-inflated.json").some((p) =>
        p.includes("scrubbing cannot add records"),
      ),
    ).toBe(true);
  });

  it("a real-derived case carrying the SYNTHETIC provenance label is rejected", () => {
    const problems = realDerivedCaseProblems(
      realDerivedCase({ provenance: "synthetic-fixture" }),
      classes,
      "real-derived/RD-mislabeled.json",
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it("signed signoff requires the closed captain authority and canonical signedAt instant", () => {
    const base: CorpusSignoff = {
      corpusVersion: real.spec.world.corpusVersion,
      status: "signed",
      signedBy: CAPTAIN_SIGNING_AUTHORITY,
      signedAt: "2026-07-28T12:00:00.000Z",
      signedDigest: real.corpusDigest,
    };
    expect(
      signoffProblems(base, real.spec.world.corpusVersion, real.corpusDigest),
    ).toEqual([]);
    expect(
      signoffProblems(
        { ...base, signedBy: "agent", signedAt: "not-a-date" },
        real.spec.world.corpusVersion,
        real.corpusDigest,
      ).join("\n"),
    ).toContain("closed captain authority");
    expect(
      signoffProblems(
        { ...base, signedAt: "2026-07-28" },
        real.spec.world.corpusVersion,
        real.corpusDigest,
      ).join("\n"),
    ).toContain("canonical ISO-8601 UTC instant");
    expect(
      signoffProblems(
        { ...base, signedAt: "2026-13-40T12:00:00.000Z" },
        real.spec.world.corpusVersion,
        real.corpusDigest,
      ).join("\n"),
    ).toContain("canonical ISO-8601 UTC instant");
  });

  it("signoff parsing rejects warnings, tags, duplicate keys, aliases, unexpected keys, and multiple blocks", () => {
    const yaml = (body: string) => `\`\`\`yaml\n${body}\n\`\`\``;
    const malformed: Array<[string, string]> = [
      [yaml("corpusVersion: x\nstatus: signed\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null"), "parse error"],
      [yaml("corpusVersion: &v x\nstatus: pending-captain\nsignedBy: *v\nsignedAt: null\nsignedDigest: null"), "aliases are forbidden"],
      [yaml("corpusVersion: !unresolved x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null"), "YAML warning"],
      [yaml("corpusVersion: !!str x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null"), "tags are forbidden"],
      [yaml("corpusVersion: x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null\nextra: value"), "unexpected top-level keys"],
      [`${yaml("corpusVersion: x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null")}\n${yaml("corpusVersion: x\nstatus: pending-captain\nsignedBy: null\nsignedAt: null\nsignedDigest: null")}`, "exactly one YAML signoff block"],
    ];
    for (const [text, expected] of malformed) {
      expect(
        signoffProblems(parseSignoff(text), "x", "digest").join("\n"),
      ).toContain(expected);
    }
  });
});
