// The household register (prompt 2 section 7, PR-2a'): the tenant-scoped route. The whole flow runs
// as the governed route.households use case - authenticate, authorize, then withTenant, whose scoped
// surface closes over the grant's sealed tenant identity; the database's RLS is what guarantees an
// advisor sees their own firm's households and no other firm's. Seeded rows are labelled: the
// demonstration chip renders from the row's own record_origin, never from an assumption (5B.6).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAccessContext } from "../../access/context";
import { getGateway, mintRequestId, requestCorrelation } from "../../runtime/governed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Households() {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const cookieValue = (await cookies()).get("verin_session")?.value;
  const view = await getGateway().enterRouteHouseholds(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "household.read");
    if (!grant) return { principal, households: null };
    const households = await access.withTenant(c, grant, (tx) => tx.listHouseholds());
    return { principal, households };
  });
  if (!view) redirect("/");
  if (!view.households)
    return (
      <p className="alert" role="alert">
        Your role is not permitted to read households.
      </p>
    );
  return (
    <section className="stack" data-testid="verin-register-loaded" aria-labelledby="households-heading">
      <h1 id="households-heading">Households</h1>
      <p className="meta">
        Signed in as {view.principal.displayName} · {view.principal.role}
      </p>
      {view.households.length === 0 ? (
        <div className="card-dashed">
          <p className="title">No household records yet</p>
          <p>Household records appear here as your firm's book is loaded into Verin.</p>
        </div>
      ) : (
        <ul className="register" aria-label="Your firm's households">
          {view.households.map((h) => (
            <li key={h.id}>
              <a href={`/households/${h.id}`}>{h.name}</a>
              {h.record_origin === "demo-seed" ? <span className="badge-demo">demonstration record</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
