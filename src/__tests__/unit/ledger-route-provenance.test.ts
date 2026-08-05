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
vi.mock("@contracts/tenant", async (importOriginal) => ({
  ...await importOriginal<typeof import("@contracts/tenant")>(),
  tenantOf: vi.fn(() => ({ orgId: "firm-a" })),
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
      decisionsTotalMetric: {
        value: number;
        provenance: { demonstration: boolean };
      };
    };
    expect(body.entries).toEqual([]);
    expect(body.decisions).toEqual([]);
    expect(body.decisionsTotalMetric.value).toBe(0);
    expect(body.decisionsTotalMetric.provenance.demonstration).toBe(true);
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

  it("binds replayed decision counts to their derived provenance", async () => {
    const asOf = "2026-07-26T13:30:00.000Z";
    const provenance = deriveArtifactProvenance([{
      source: "fixture",
      asOf,
      confidence: "high",
    }], asOf);
    readVerifiedDecisionRegister.mockResolvedValueOnce({
      verification: {
        ok: true,
        entriesChecked: 3,
        entriesStored: 3,
        levels: [],
      },
      rows: [],
      rowProvenance: new Map(),
      decisions: [{
        projection: {
          decisionId: "decision:test",
          disposition: "proceed",
          approvalMode: "approval",
          approvalStages: [],
          reservations: [{ status: "active" }, { status: "released" }],
          executionSteps: [{ stepId: "step:test" }],
          exceptionRequested: false,
          lastEventType: "ExecutionStarted",
          lastSequence: 3,
        },
        provenance,
      }],
      decisionsTotal: 1,
      replaySourceReason: null,
    });

    const response = await GET(new NextRequest("http://localhost/api/ledger"));
    const body = await response.json() as {
      decisions: Array<{
        activeReservations: unknown;
        executionSteps: unknown;
      }>;
    };
    expect(body.decisions[0]).toMatchObject({
      activeReservations: { value: 1, format: "count", provenance },
      executionSteps: { value: 1, format: "count", provenance },
    });
  });

  it("binds every register count to one observation provenance", async () => {
    const asOf = "2026-07-26T13:30:00.000Z";
    const row = {
      id: "ledger:counted",
      sequence: 1,
      occurredAt: asOf,
      eventType: "DecisionRecorded",
      actorJson: JSON.stringify({ systemId: "seed-decision-ledger" }),
      correlationId: "corr:counted",
      decisionId: "decision:counted",
      entryHash: "1".repeat(64),
    };
    const provenance = deriveArtifactProvenance([{
      source: "fixture",
      asOf,
      confidence: "high",
    }], asOf);
    readVerifiedDecisionRegister.mockResolvedValueOnce({
      verification: {
        ok: true,
        entriesChecked: 1,
        entriesStored: 2,
        levels: [{ level: "L1", ok: true, entriesChecked: 1, reason: null }],
      },
      rows: [row],
      rowProvenance: new Map([[row.id, provenance]]),
      decisions: [],
      decisionsTotal: 2,
      replaySourceReason: null,
    });

    const response = await GET(new NextRequest("http://localhost/api/ledger"));
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      eventsTotalMetric: { value: 2, format: "count" },
      eventsShownMetric: { value: 1, format: "count" },
      decisionsTotalMetric: { value: 2, format: "count" },
      decisionsShownMetric: { value: 0, format: "count" },
      verificationWindowed: true,
      eventsWindowTruncated: true,
      decisionsWindowTruncated: true,
      verification: {
        entriesCheckedMetric: { value: 1, format: "count" },
        levels: [{ entriesCheckedMetric: { value: 1, format: "count" } }],
      },
    });
    expect(JSON.stringify(body)).toContain('"demonstration":true');
    expect(JSON.stringify(body)).not.toMatch(/"entriesChecked":\d/);
  });

  it("marks historical totals untrusted when bounded provenance coverage is incomplete", async () => {
    const asOf = "2026-07-26T13:30:00.000Z";
    const row = {
      id: "ledger:recent-real",
      sequence: 2,
      occurredAt: asOf,
      eventType: "DecisionRecorded",
      actorJson: JSON.stringify({ systemId: "verin-decision-engine" }),
      correlationId: "corr:recent-real",
      decisionId: "decision:recent-real",
      entryHash: "1".repeat(64),
    };
    const real = deriveArtifactProvenance([{
      source: "verin-crm",
      asOf,
      confidence: "high",
    }], asOf);
    readVerifiedDecisionRegister.mockResolvedValueOnce({
      verification: {
        ok: true,
        entriesChecked: 1,
        entriesStored: 2,
        levels: [],
      },
      rows: [row],
      rowProvenance: new Map([[row.id, real]]),
      decisions: [],
      decisionsTotal: 1,
      replaySourceReason: null,
    });

    const response = await GET(new NextRequest("http://localhost/api/ledger"));
    const body = await response.json() as {
      eventsTotalMetric: { provenance: { demonstration: boolean } };
      decisionsTotalMetric: { provenance: { demonstration: boolean } };
      eventsShownMetric: { provenance: { demonstration: boolean } };
    };
    expect(body.eventsTotalMetric.provenance.demonstration).toBe(true);
    expect(body.decisionsTotalMetric.provenance.demonstration).toBe(true);
    expect(body.eventsShownMetric.provenance.demonstration).toBe(false);
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
