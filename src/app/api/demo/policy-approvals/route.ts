import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, readFormBody, requireActionGrant } from "@app/_server/context";
import { appError } from "@contracts/errors";
import { recordDemoPolicyApproval } from "@app/demo/policy-approval-events";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireActionGrant(req, "policy.approve");
  if (!auth.ok) return errorResponse(auth.error);
  const parsed = await readFormBody(req);
  if (!parsed.ok) return errorResponse(parsed.error);
  const pass = parsed.value.get("pass");
  if (pass !== "initial" && pass !== "revalidated") {
    return errorResponse(appError("VALIDATION", "Unknown demo lifecycle pass."));
  }
  const scenarioId = parsed.value.get("scenarioId") ?? "";
  const firmId = parsed.value.get("firmId") ?? "";
  const sourceCaseId = parsed.value.get("sourceCaseId") || null;
  const approval = recordDemoPolicyApproval(auth.value, {
    scenarioId,
    firmId,
    sourceCaseId,
    pass,
  });
  if (!approval.ok) return errorResponse(approval.error);
  const query = new URLSearchParams({
    scenario: scenarioId,
    firm: firmId,
    ...(sourceCaseId ? { case: sourceCaseId } : {}),
    ...(pass === "revalidated" ? { pass } : {}),
    approvalEvent: approval.value.eventId,
  }).toString();
  return new NextResponse(null, {
    status: 303,
    headers: { location: `/app/demo/policy-authoring?${query}` },
  });
}
