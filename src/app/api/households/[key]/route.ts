/**
 * ONE HOUSEHOLD, IN DEPTH (ADR-0057).
 *
 * The URL carries the world's stable household KEY, so a link survives a
 * regeneration and reads as a household rather than a UUID. Authorization is
 * still the CRM's: the key resolves to a record id, and the tenant-scoped
 * repository read is what decides whether this caller may see it. A key that
 * resolves to a household in another org is a 404, exactly as an unknown key is.
 */
import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, errorResponse } from "@app/_server/context";
import { getHouseholdById } from "@infra/crm/house-crm";
import { fixtureWorldSource, worldIdentity } from "@infra/world/fixture-world-source";
import { appError } from "@contracts/errors";
import { parseMachineRecordId } from "@contracts/record-id";
import { buildHouseholdDetailVM } from "@app/households/build-detail";

export const runtime = "nodejs";

const NOT_FOUND = appError("NOT_FOUND", "That household is not in this firm's book.");

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const auth = await requireActionGrant(req, "pii.view");
  if (!auth.ok) return errorResponse(auth.error);
  const { key } = await context.params;
  const household = await fixtureWorldSource.getHousehold(auth.value, key);
  if (!household) return errorResponse(NOT_FOUND);
  const recordId = parseMachineRecordId("household", household.id);
  if (!recordId) return errorResponse(NOT_FOUND);
  const db = await getDb();
  const crmRow = await getHouseholdById(db, auth.value, recordId);
  if (!crmRow) return errorResponse(NOT_FOUND);
  // Counterparty names for the cross-household links, so a link reads as a
  // household rather than an identifier. A counterparty name is the same client
  // PII the subject's is, so it is authorized the SAME way - the evidence port
  // describes it, the tenant-scoped CRM read decides whether this caller may be
  // told it. A counterparty outside this firm's book is resolved to NOTHING: the
  // view model receives no entry for it, and emits an opaque page-local
  // reference in place of a name, a key and a link. A world key is
  // `<surname>-<given name>`, so passing it through instead would disclose the
  // party at lower fidelity rather than withhold it.
  const counterpartyNames = new Map<string, string>();
  for (const link of household.crossHouseholdLinks) {
    const counterparty = await fixtureWorldSource.getHousehold(auth.value, link.counterpartyHouseholdKey);
    if (!counterparty) continue;
    const counterpartyId = parseMachineRecordId("household", counterparty.id);
    if (!counterpartyId) continue;
    const counterpartyRow = await getHouseholdById(db, auth.value, counterpartyId);
    if (counterpartyRow) counterpartyNames.set(counterparty.key, counterparty.displayName);
  }
  const identity = worldIdentity();
  return NextResponse.json({
    household: buildHouseholdDetailVM(
      household,
      crmRow.id,
      identity?.asOf ?? household.evidence.retrievedAt,
      counterpartyNames,
    ),
  });
}
