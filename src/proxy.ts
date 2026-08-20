// The cookie-writing path (prompt 2 5B, PR-2c): Next's proxy always runs on the Node runtime, in the
// same server process the composition root constructed the governed runtime in. A session past its
// half-life is renewed HERE and only here - one governed store operation rotates the token and slides
// the expiry - and the fresh cookie value is handed to the downstream read-only render through a
// request header, so a second resolution in the same request can never observe a rotated-away id
// (the oracle's hard-won half-life lesson, main:CLAUDE.md). Pages stay read-only and never rotate.
// The handoff header is stripped from every incoming request first: only this file may set it, and a
// spoofed value would in any case be nothing more than a cookie the sender could have sent directly.
import { NextResponse, type NextRequest } from "next/server";
import { renewSession } from "./access/context";

export const config = { matcher: ["/((?!_next|favicon.ico|api).*)"] };

export default async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("x-verin-session");
  const presented = request.cookies.get("verin_session")?.value;
  const renewed = presented ? await renewSession(presented) : null;
  if (!renewed) return NextResponse.next({ request: { headers } });
  headers.set("x-verin-session", renewed.cookieValue);
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set("verin_session", renewed.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: renewed.secureCookies,
    expires: renewed.expiresAt,
  });
  return response;
}
