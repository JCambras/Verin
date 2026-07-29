import { describe, expect, it } from "vitest";
import {
  ledgerRowProvenanceLabel,
  UNTRUSTED_PROVENANCE_LABEL,
} from "@app/ledger/provenance";
import { DEV_BADGE_TEXT } from "@contracts/provenance";

describe("ledger route provenance", () => {
  it("renders real and synthetic provenance according to parsed values", () => {
    expect(ledgerRowProvenanceLabel({
      source: "verin-crm",
      asOf: "2026-07-26T13:30:00.000Z",
      confidence: "high",
    })).toBeNull();
    expect(ledgerRowProvenanceLabel({
      source: "fixture",
      asOf: "2026-07-26T13:30:00.000Z",
      confidence: "high",
    })).toBe(DEV_BADGE_TEXT["synthetic-fixture"]);
  });

  it.each([
    { source: "unknown", asOf: "2026-07-26T13:30:00.000Z", confidence: "high" },
    { source: "verin-crm", asOf: "invalid", confidence: "high" },
    { source: "verin-crm", asOf: "2026-07-26T13:30:00.000Z", confidence: "certain" },
  ])("labels malformed stored provenance as untrusted", (provenance) => {
    expect(ledgerRowProvenanceLabel(provenance)).toBe(
      UNTRUSTED_PROVENANCE_LABEL,
    );
  });
});
