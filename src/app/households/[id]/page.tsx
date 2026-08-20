// The household workspace (prompt 2 section 7, PR-2b): an advisor opens a household and sees what
// Verin knows - and an honest absent state with a plain next step where it knows nothing. The one
// figure renders through the provenance-carrying metric component; a household another firm holds
// (or a malformed id) resolves to the same honest not-found, so existence never leaks across the
// tenant boundary. Nothing here is filled in with a plausible-looking number.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAccessContext } from "../../../access/context";
import { getGateway, mintRequestId, requestCorrelation } from "../../../runtime/governed";
import { DisplayMetric } from "../../metric";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ABSENT: { title: string; body: string }[] = [
  { title: "People", body: "Verin has no evidence source for this household's people yet." },
  { title: "Financial accounts", body: "Verin has no evidence source for accounts or balances yet." },
  { title: "Compliance evidence", body: "No evidence has been assembled for this household yet." },
];

export default async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const cookieValue = (await cookies()).get("verin_session")?.value;
  const { id } = await params;
  const view = await getGateway().enterRouteHouseholdWorkspace(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "household.read");
    if (!grant) return { household: null };
    return { household: await access.withTenant(c, grant, (tx) => tx.getHousehold(id)) };
  });
  if (!view) redirect("/");
  if (!view.household) {
    return (
      <section className="stack" data-testid="verin-workspace-loaded" aria-labelledby="ws-heading">
        <h1 id="ws-heading">Household not on file</h1>
        <div className="card-dashed">
          <p className="title">Your firm holds no household record with this identifier</p>
          <p>
            <a href="/households">Return to your firm's household register</a> to pick a household on file.
          </p>
        </div>
      </section>
    );
  }
  const h = view.household;
  const days = h.recorded_at ? Math.floor((Date.now() - h.recorded_at.getTime()) / 86_400_000) : null;
  return (
    <section className="stack" data-testid="verin-workspace-loaded" aria-labelledby="ws-heading">
      <h1 id="ws-heading">{h.name}</h1>
      <p className="meta">
        Verin store record
        {h.recorded_at ? ` · recorded ${h.recorded_at.toISOString().slice(0, 10)}` : " · recorded date not on file"}
        {h.record_origin === "demo-seed" ? " · " : ""}
        {h.record_origin === "demo-seed" ? <span className="badge-demo">demonstration record</span> : null}
      </p>
      {days === null ? (
        <div className="card-dashed">
          <p className="title">Days on record unavailable</p>
          <p>This record carries no recorded date, so Verin will not derive a figure from one.</p>
        </div>
      ) : (
        <DisplayMetric
          metric={{
            label: "Days on record",
            value: String(days),
            source: "derived from the Verin store record",
            asOf: new Date(),
            demonstration: h.record_origin === "demo-seed",
          }}
        />
      )}
      <h2 className="section-heading">What Verin does not know yet</h2>
      {ABSENT.map((a) => (
        <div className="card-dashed" key={a.title}>
          <p className="title">{a.title}</p>
          <p>{a.body} Evidence assembly arrives with the evidence slice of this program; nothing is filled in until it does.</p>
        </div>
      ))}
    </section>
  );
}
