// PR-2a's one route: sign-in, landing on the honest empty shell (prompt 2 section 7, the pre-ruled
// split). The shell states plainly that no household records exist yet - nothing is filled in with a
// plausible-looking number (5B.5); the register lands with the tenant tables in PR-2a'.
import { cookies } from "next/headers";
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
    httpOnly: true, sameSite: "lax", path: "/", secure: getGateway().secureCookies, expires: session.expiresAt,
  });
  redirect("/");
}

export default async function Home({ searchParams }: { searchParams: Promise<{ refused?: string }> }) {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const principal = await access.authenticate(c, (await cookies()).get("verin_session")?.value);
  if (!principal) {
    const refused = (await searchParams).refused === "1";
    return (
      <form action={submitSignIn} className="stack" data-testid="verin-signin-loaded">
        <h1>Sign in to Verin</h1>
        {refused ? <p className="alert" role="alert">That email and password combination was not accepted.</p> : null}
        <div className="field">
          <label htmlFor="loginEmail">Work email</label>
          <input id="loginEmail" name="loginEmail" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="secretText">Password</label>
          <input id="secretText" name="secretText" type="password" autoComplete="current-password" required />
        </div>
        <button className="btn-primary" type="submit">Sign in</button>
      </form>
    );
  }
  const grant = await access.authorize(c, principal, "household.read");
  if (!grant) return <p className="alert" role="alert">Your role is not permitted to read households.</p>;
  return (
    <section className="stack" data-testid="verin-shell-loaded" aria-labelledby="households-heading">
      <h1 id="households-heading">Households</h1>
      <p className="meta">Signed in as {principal.displayName} · {principal.role}</p>
      <div className="card-dashed">
        <p className="title">No household records exist yet</p>
        <p>
          Your firm's Verin workspace is live, but its household register arrives with the next update
          of this program. Nothing here is filled in with placeholder data.
        </p>
      </div>
    </section>
  );
}
