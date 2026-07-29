import { type NextRequest, NextResponse } from "next/server";
import { getDb, requireActionGrant, requirePrincipalWithRole, readJsonBody, errorResponse } from "@app/_server/context";
import { listHouseholds, createHousehold, updateHouseholdName } from "@infra/crm/house-crm";
import { writeActorOf } from "@contracts/principal";
import { appError } from "@contracts/errors";
import { parseMachineRecordId } from "@contracts/record-id";

export const runtime = "nodejs";

const MAX_NAME_LENGTH = 200;

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_NAME_LENGTH;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Household names are client PII: reading them is the governed "pii.view"
  // action (v3 §15.3) — authorized per-action, and the grant's sealed tenant
  // scopes the repository read.
  const auth = await requireActionGrant(req, "pii.view");
  if (!auth.ok) return errorResponse(auth.error);
  const db = await getDb();
  return NextResponse.json({ households: await listHouseholds(db, auth.value) });
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

/**
 * Rename a household by canonical UUID. Mixed-case UUIDs remain compatible and
 * normalize to lowercase; slugs and other client-selected identifiers are refused.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["ops", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);
  const parsed = await readJsonBody<{ id?: unknown; name?: unknown }>(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const b = parsed.value;
  const id = parseMachineRecordId("household", b.id);
  if (!id || !isName(b.name)) {
    return errorResponse(appError("VALIDATION", `A household record id and name are required (name at most ${MAX_NAME_LENGTH} characters).`));
  }
  const db = await getDb();
  const r = await updateHouseholdName(db, writeActorOf(p.value), id, b.name);
  if (!r.ok) return errorResponse(r.error);
  return NextResponse.json({ household: r.value });
}
