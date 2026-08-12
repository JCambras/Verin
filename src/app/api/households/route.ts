/**
 * THE HOUSEHOLD DIRECTORY (ADR-0057).
 *
 * Household names and the people inside them are client PII, so reading the
 * directory is the governed `pii.view` action (v3 §15.3): authorized per
 * request, and the grant's sealed tenant scopes the repository read. The CRM
 * decides WHICH households this tenant may see; the evidence port supplies
 * their depth, and a world household with no authorized CRM row never appears.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, errorResponse } from "@app/_server/context";
import { listHouseholds } from "@infra/crm/house-crm";
import { fixtureWorldSource, worldIdentity } from "@infra/world/fixture-world-source";
import type { WorldHousehold } from "@domain/world/household-world";
import { buildDirectoryVM } from "@app/households/build";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireActionGrant(req, "pii.view");
  if (!auth.ok) return errorResponse(auth.error);
  const db = await getDb();
  const crmHouseholds = await listHouseholds(db, auth.value);
  const summaries = await fixtureWorldSource.listHouseholds(auth.value);
  const worldHouseholds: WorldHousehold[] = [];
  for (const summary of summaries) {
    const household = await fixtureWorldSource.getHousehold(auth.value, summary.key);
    if (household) worldHouseholds.push(household);
  }
  return NextResponse.json({
    directory: buildDirectoryVM({ crmHouseholds, worldHouseholds, identity: worldIdentity() }),
  });
}
