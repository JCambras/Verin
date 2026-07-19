import { type NextRequest, NextResponse } from "next/server";
import { getDb, requirePrincipal, requirePrincipalWithRole, readJsonBody, errorResponse } from "@app/_server/context";
import { listHouseholds, createHousehold, updateHouseholdName } from "@infra/crm/house-crm";
import { writeActorOf } from "@contracts/principal";
import { appError } from "@contracts/errors";

export const runtime = "nodejs";

const MAX_NAME_LENGTH = 200;
const MAX_ID_LENGTH = 100;

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipal(req);
  if (!p.ok) return errorResponse(p.error);
  const db = await getDb();
  return NextResponse.json({ households: await listHouseholds(db, p.value) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["advisor", "ops", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);
  const parsed = await readJsonBody<{ name?: unknown }>(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const name = parsed.value.name;
  if (!isName(name)) return errorResponse(appError("VALIDATION", `Household name is required (a string of at most ${MAX_NAME_LENGTH} characters).`));
  const db = await getDb();
  const r = await createHousehold(db, writeActorOf(p.value), { name });
  if (!r.ok) return errorResponse(r.error);
  return NextResponse.json({ household: r.value });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["ops", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);
  const parsed = await readJsonBody<{ id?: unknown; name?: unknown }>(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const b = parsed.value;
  if (!isId(b.id) || !isName(b.name)) {
    return errorResponse(appError("VALIDATION", `id and name are required (strings; name at most ${MAX_NAME_LENGTH} characters).`));
  }
  const db = await getDb();
  const r = await updateHouseholdName(db, writeActorOf(p.value), b.id, b.name);
  if (!r.ok) return errorResponse(r.error);
  return NextResponse.json({ household: r.value });
}
