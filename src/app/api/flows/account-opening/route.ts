import { type NextRequest, NextResponse } from "next/server";
import { getDb, requirePrincipalWithRole, readJsonBody, errorResponse } from "@app/_server/context";
import { startAccountOpening } from "@infra/wire";
import { appError } from "@contracts/errors";
import { ACCOUNT_TYPES, isAccountType } from "@domain/schema/entities";

export const runtime = "nodejs";

function requiredString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipalWithRole(req, ["advisor", "ops", "principal", "admin"]);
  if (!p.ok) return errorResponse(p.error);

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const b = parsed.value;
  if (!requiredString(b.householdName, 200) || !requiredString(b.firstName, 100) || !requiredString(b.lastName, 100)) {
    return errorResponse(appError("VALIDATION", "Household name and contact name are required (as strings of reasonable length)."));
  }
  if (b.email != null && b.email !== "" && !requiredString(b.email, 320)) {
    return errorResponse(appError("VALIDATION", "Email must be a string of reasonable length."));
  }
  if (!isAccountType(b.accountType)) {
    return errorResponse(appError("VALIDATION", `Account type must be one of: ${ACCOUNT_TYPES.join(", ")}.`));
  }
  // Double-submit protection (D-027): the client mints one UUID per form session;
  // it becomes the executionId, so a retry/second tab replays the same execution.
  if (typeof b.clientRequestId !== "string" || !UUID_RE.test(b.clientRequestId)) {
    return errorResponse(appError("VALIDATION", "clientRequestId is required (a UUID minted once per form session)."));
  }

  const db = await getDb();
  const result = await startAccountOpening(db, p.value, {
    householdName: b.householdName,
    firstName: b.firstName,
    lastName: b.lastName,
    email: b.email ? String(b.email) : null,
    accountType: b.accountType,
    clientRequestId: b.clientRequestId,
  });
  if (result.status === "failed") {
    return errorResponse(result.error ?? appError("INTERNAL", "The account-opening flow failed to start."));
  }

  return NextResponse.json({
    executionId: result.executionId,
    status: result.status,
    token: result.token ?? null,
    awaiting: result.awaiting ?? null,
    applicationId: result.data.applicationId ?? null,
    householdId: result.data.householdId ?? null,
  });
}
