import { type NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  getDb,
  requirePrincipalWithRole,
} from "@app/_server/context";
import { verifyAndListDecisionLedger } from "@infra/ledger/ledger-verification";
import type { LedgerRegisterViewModel } from "@app/ledger/model";

export const runtime = "nodejs";
const MAX_ENTRIES = 200;

function actorLabel(actorJson: string): string {
  try {
    const actor = JSON.parse(actorJson) as {
      actorId?: unknown;
      systemId?: unknown;
    };
    if (typeof actor.actorId === "string") return actor.actorId;
    return typeof actor.systemId === "string" ? actor.systemId : "unknown";
  } catch {
    return "invalid actor metadata";
  }
}

/** Read-only, tenant-scoped register. No decision state is computed here. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const principal = await requirePrincipalWithRole(
    req,
    ["ops", "cco", "principal", "admin"],
  );
  if (!principal.ok) return errorResponse(principal.error);
  const db = await getDb();
  const { verification, rows } = await verifyAndListDecisionLedger(
    db,
    principal.value.orgId,
  );
  const body = {
    verification,
    total: rows.length,
    entries: rows.slice(-MAX_ENTRIES).reverse().map((row) => {
      const actor = actorLabel(row.actorJson);
      return {
        sequence: row.sequence,
        occurredAt: row.occurredAt,
        eventType: row.eventType,
        actor,
        correlationId: row.correlationId,
        decisionId: row.decisionId,
        entryHash: row.entryHash.slice(0, 16),
        provenanceLabel:
          actor === "seed-decision-ledger" ? "Synthetic fixture" : null,
      };
    }),
  } satisfies LedgerRegisterViewModel;
  return NextResponse.json(body);
}
