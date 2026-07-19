import { type NextRequest, NextResponse } from "next/server";
import { requirePrincipal, errorResponse } from "@app/_server/context";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = await requirePrincipal(req);
  if (!p.ok) return errorResponse(p.error);
  return NextResponse.json({ actor: p.value.actor, role: p.value.role, orgId: p.value.orgId });
}
