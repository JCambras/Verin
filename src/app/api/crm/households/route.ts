import { type NextRequest, NextResponse } from "next/server";
import { getDb, requirePrincipal, requirePrincipalWithRole, errorResponse } from "@app/_server/context";
import { listHouseholds, createHousehold, updateHouseholdName } from "@infra/crm/house-crm";
import { appError } from "@contracts/errors";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipal(req);
  if (!p.ok) return errorResponse(p.error);
  const db = await getDb();
  return NextResponse.json({ households: await listHouseholds(db, p.value) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["advisor", "ops", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);
  const b = (await req.json().catch(() => ({}))) as { name?: string };
  if (!b.name) return errorResponse(appError("VALIDATION", "Household name is required."));
  const db = await getDb();
  const r = await createHousehold(db, p.value, { name: b.name });
  if (!r.ok) return errorResponse(r.error);
  return NextResponse.json({ household: r.value });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["ops", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);
  const b = (await req.json().catch(() => ({}))) as { id?: string; name?: string };
  if (!b.id || !b.name) return errorResponse(appError("VALIDATION", "id and name are required."));
  const db = await getDb();
  const r = await updateHouseholdName(db, p.value, b.id, b.name);
  if (!r.ok) return errorResponse(r.error);
  return NextResponse.json({ household: r.value });
}
