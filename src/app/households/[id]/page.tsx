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
      <p className="meta">
        <a href={`/households/${h.id}/decide?amount=50000&purpose=home-renovation&deadline=2026-12-31`}>Decide a distribution</a> - a fixed $50,000 home-renovation demonstration request, computed from
        this household's evidence and the firm's in-force policy version.
      </p>
      <h2 className="section-heading">What Verin can prove</h2>
      <p className="meta">{evidence.assembledLine}</p>
      {evidence.conflicts.map((x, i) => (
        <div className="card-dashed" key={`${x.label}-${i}`} role="status">
          <p className="title">Records disagree: {x.label}</p>
          <p>Observations of the same subject conflict. All are retained below; none is treated as the truth, and recency never decides.</p>
        </div>
      ))}
      {evidence.items.length > 0 ? (
        <ul className="register" aria-label="Evidence on file for this household">
          {evidence.items.map((item) => (
            <li key={item.id}>
              {/* The stale treatment fades CONTENT only; every badge stays outside the faded block
                  and meta text inside it darkens to full foreground, or the blend fails contrast. */}
              <div className={item.band === "stale" ? "receded" : undefined}>
                <strong>{item.label}</strong>
                {item.entries.map(([field, value]) => (
                  <p key={field}>
                    {field}: {value}
                  </p>
                ))}
                <p className="meta">{item.provenanceLine}</p>
              </div>
              <p className="badges">
                {item.band !== "fresh" ? <span className="badge-band">{item.band}</span> : null}
                {item.conflicted ? <span className="badge-band">conflicting record</span> : null}
                {item.demonstration ? <span className="badge-demo">demonstration record</span> : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {evidence.absent.map((a) => (
        <div className="card-dashed" key={a.label}>
          <p className="title">Not yet observed: {a.label}</p>
          <p>This gap is a typed absence in the household's evidence bundle, never a silent skip. {a.nextStep}</p>
        </div>
      ))}
    </section>
  );
}
