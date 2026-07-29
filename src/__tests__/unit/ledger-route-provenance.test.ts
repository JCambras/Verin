import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const readVerifiedDecisionRegister = vi.hoisted(() => vi.fn());

vi.mock("@app/_server/context", () => ({
  errorResponse: vi.fn(),
  getDb: vi.fn().mockResolvedValue({}),
  requirePrincipalWithRole: vi.fn().mockResolvedValue({
    ok: true,
    value: { orgId: "firm-a" },
  }),
}));
vi.mock("@infra/ledger/ledger-register", () => ({
  readVerifiedDecisionRegister,
}));

import { GET } from "@app/api/ledger/route";
import {
  ledgerRowProvenanceLabel,
  UNTRUSTED_PROVENANCE_LABEL,
} from "@app/ledger/provenance";
import {
  DEV_BADGE_TEXT,
  deriveArtifactProvenance,
} from "@contracts/provenance";

describe("ledger route provenance", () => {
  it("suppresses row metadata when the verified snapshot fails", async () => {
    readVerifiedDecisionRegister.mockResolvedValueOnce({
      verification: {
        ok: false,
        entriesChecked: 0,
        entriesStored: 1,
        levels: [{
          level: "L1",
          ok: false,
          entriesChecked: 0,
          brokenAtSequence: 0,
          reason: "ledger chain is broken",
        }],
      },
      rows: [{
        orgId: "firm-a",
        id: "ledger:corrupt",
        sequence: 0,
        eventType: "DecisionRecorded",
        schemaVersion: "1.1.0",
        serializerVersion: "1.0.0",
        occurredAt: "2026-07-26T13:30:00.000Z",
        recordedAt: "2026-07-26T13:30:00.000Z",
        actorJson: JSON.stringify({ actorId: "victim@example.com" }),
        correlationId: "correlation:corrupt",
        causationId: null,
        decisionId: "decision:corrupt",
        evidenceSnapshotId: null,
        triggeringEntryId: null,
        reservationCreationId: null,
        payloadJson: "{}",
        prevHash: "0".repeat(64),
        entryHash: "1".repeat(64),
        provSource: "verin-crm",
        provAsOf: "2026-07-26T13:30:00.000Z",
        provConfidence: "high",
      }],
      decisions: [],
      decisionsTotal: 1,
      replaySourceReason: null,
    });

    const response = await GET(new NextRequest("http://localhost/api/ledger"));
    const body = await response.json() as {
      entries: unknown[];
      decisions: unknown[];
      decisionsTotal: number;
    };
    expect(body.entries).toEqual([]);
    expect(body.decisions).toEqual([]);
    expect(body.decisionsTotal).toBe(0);
    expect(JSON.stringify(body)).not.toContain("victim@example.com");
  });

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

  it("renders verified real-input computed rows as compliance-eligible", async () => {
    const row = {
      id: "ledger:computed",
      sequence: 5,
      occurredAt: "2026-07-26T13:30:00.000Z",
      eventType: "ApprovalStageExpired",
      actorJson: JSON.stringify({ systemId: "algorithm" }),
      correlationId: "correlation:computed",
      decisionId: "decision:computed",
      entryHash: "1".repeat(64),
    };
    readVerifiedDecisionRegister.mockResolvedValueOnce({
      verification: {
        ok: true,
        entriesChecked: 1,
        entriesStored: 1,
        levels: [],
      },
      rows: [row],
      rowProvenance: new Map([[
        row.id,
        deriveArtifactProvenance([{
          source: "verin-crm",
          asOf: row.occurredAt,
          confidence: "high",
        }], row.occurredAt),
      ]]),
      decisions: [],
      decisionsTotal: 0,
      replaySourceReason: null,
    });
    const response = await GET(new NextRequest("http://localhost/api/ledger"));
    const body = await response.json() as {
      entries: Array<{ provenanceLabel: string | null }>;
    };
    expect(body.entries[0]!.provenanceLabel).toBeNull();
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
