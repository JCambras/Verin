import { type NextRequest, NextResponse } from "next/server";
import { getDb, requirePrincipalWithRole, readJsonBody, errorResponse } from "@app/_server/context";
import { startAccountOpening } from "@infra/wire";
import { appError } from "@contracts/errors";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["advisor", "ops", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const b = parsed.value;
  if (!b.householdName || !b.firstName || !b.lastName || !b.accountType) {
    return errorResponse(appError("VALIDATION", "Household name, contact name, and account type are required."));
  }

  const db = await getDb();
  const result = await startAccountOpening(db, p.value, {
    householdName: String(b.householdName),
    firstName: String(b.firstName),
    lastName: String(b.lastName),
    email: b.email ? String(b.email) : null,
    accountType: String(b.accountType),
  });

  return NextResponse.json({
    executionId: result.executionId,
    status: result.status,
    token: result.token ?? null,
    awaiting: result.awaiting ?? null,
    applicationId: result.data.applicationId ?? null,
    householdId: result.data.householdId ?? null,
  });
}
