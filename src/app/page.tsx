// Sign-in. An authenticated advisor is sent straight to the household register at /households
// (PR-2a' fulfilled the PR-2a shell's promise); everything server-side runs as governed operations.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAccessContext, signIn } from "../access/context";
import { getGateway, mintRequestId, requestCorrelation } from "../runtime/governed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function submitSignIn(formData: FormData) {
  "use server";
  const c = requestCorrelation(mintRequestId());
  const session = await signIn(c, String(formData.get("loginEmail") ?? ""), String(formData.get("secretText") ?? ""));
  if (!session) redirect("/?refused=1");
  (await cookies()).set("verin_session", session.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: getGateway().secureCookies,
    expires: session.expiresAt,
  });
  redirect("/households");
}

export default async function Home({ searchParams }: { searchParams: Promise<{ refused?: string }> }) {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const principal = await access.authenticate(c, (await headers()).get("x-verin-session") ?? (await cookies()).get("verin_session")?.value);
  if (principal) redirect("/households");
  const refused = (await searchParams).refused === "1";
  return (
    <form action={submitSignIn} className="stack" data-testid="verin-signin-loaded">
      <h1>Sign in to Verin</h1>
      {refused ? (
        <p className="alert" role="alert">
          That email and password combination was not accepted.
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="loginEmail">Work email</label>
        <input id="loginEmail" name="loginEmail" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="secretText">Password</label>
        <input id="secretText" name="secretText" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn-primary" type="submit">
        Sign in
      </button>
    </form>
  );
}
