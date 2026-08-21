// The household workspace (PR-2b; prompt 3 delivers the evidence surface it promised): an advisor
// sees exactly what Verin can prove - each observation with source and both timestamps, freshness
// computed by the assembly against the request's own asOf, typed absence rendered honestly, and no
// numeric AI confidence anywhere. This route boundary mints asOf and the deadline exactly once.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAccessContext } from "../../../access/context";
import { getGateway, mintRequestId, requestCorrelation } from "../../../runtime/governed";
import { assembleEvidence, renderableBundle } from "../../../evidence/bundle";
import { EVIDENCE_ASSEMBLY_DEADLINE_MS } from "../../../evidence/vocabulary";
import { DisplayMetric } from "../../metric";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const cookieValue = (await headers()).get("x-verin-session") ?? (await cookies()).get("verin_session")?.value;
  const { id } = await params;
  const asOf = new Date().toISOString();
  const view = await getGateway().enterRouteHouseholdWorkspace(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "household.read");
    if (!grant) return { household: null, evidence: null };
    const household = await access.withTenant(c, grant, (tx) => tx.getHousehold(id));
    if (!household) return { household: null, evidence: null };
    const bundle = await assembleEvidence(c, grant, { householdId: id }, asOf, { milliseconds: EVIDENCE_ASSEMBLY_DEADLINE_MS });
    return { household, evidence: renderableBundle(bundle) };
  });
  if (!view) redirect("/");
  if (!view.household || !view.evidence) {
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
  const evidence = view.evidence;
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
      <h2 className="section-heading">What Verin can prove</h2>
      <p className="meta">{evidence.assembledLine}</p>
      {evidence.items.length > 0 ? (
        <ul className="register" aria-label="Evidence on file for this household">
          {evidence.items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.label}</strong>
                {item.entries.map(([field, value]) => (
                  <p key={field}>
                    {field}: {value}
                  </p>
                ))}
                <p className="meta">{item.provenanceLine}</p>
              </div>
              {item.demonstration ? <span className="badge-demo">demonstration record</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {evidence.absent.length > 0 ? (
        <div className="card-dashed">
          <p className="title">Not yet observed: {evidence.absent.join(", ")}</p>
          <p>Each gap is a typed absence in this household's evidence bundle, never a silent skip; record the missing evidence in the house record store to close it.</p>
        </div>
      ) : null}
    </section>
  );
}
