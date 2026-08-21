// The firm-policy shelf, complete (prompt 4 deliverable 5; PR-4b): publish a version, see which
// version is in force (derived from the append-only sequence alone, never a stored pointer), list
// the history, and inspect any version by content address. A missing identity renders the typed
// NotFound naming it; tampered bytes and a gapped sequence render fail-closed refusals by name.
// Dates worded, never YYYY-MM-DD; provenance carried; a parse refusal names the offending path.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAccessContext } from "../../access/context";
import { getGateway, mintRequestId, requestCorrelation } from "../../runtime/governed";
import {
  NOT_STATED,
  POLICY_OPERATION_DEADLINE_MS,
  createPolicyVersionRegistry,
  parsePolicyVersionId,
  renderPolicyVersionId,
  type FirmPolicy,
  type PolicyNotFound,
  type PolicyVersionId,
  type PublishedPolicyVersion,
} from "../../policy/registry";
import { formatObservationDate } from "../../evidence/projection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_STATED_LABEL = "Not stated - the ratified contract is silent, and Verin does not invent firm policy";
// Closed vocabulary tokens render as their own worded form; recorded silence renders as itself.
const worded = (value: string) => (value === NOT_STATED ? NOT_STATED_LABEL : value.replaceAll("-", " "));
function policyRows(policy: FirmPolicy): [string, string][] {
  return [
    ["Cash reserve horizon", `${policy.reserveHorizonMonths} months of planned withdrawals`],
    ["Dual-approval threshold", `$${policy.dualApproval.thresholdUsd.toLocaleString("en-US")}`],
    ["Approvals required", `${policy.dualApproval.approvalsRequired}`],
    ["Distinct approvers required", policy.dualApproval.distinctActorsRequired ? "Yes" : "No"],
    ["Eligible approver role", worded(policy.dualApproval.eligibleApproverRole)],
    ["Requester rule", worded(policy.dualApproval.requesterRule)],
    ["Bank-instruction change", worded(policy.bankInstructionChange)],
    ["Approval stage shape", policy.approvalStages === NOT_STATED ? NOT_STATED_LABEL : `${policy.approvalStages.length} configured stages`],
    ["Reservation window", policy.reservationWindowDays === NOT_STATED ? NOT_STATED_LABEL : `${policy.reservationWindowDays} days`],
  ];
}
const FAIL_CLOSED = /edited in place|sequence check refuses/;

async function submitPolicy(formData: FormData) {
  "use server";
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const cookieValue = (await cookies()).get("verin_session")?.value;
  const outcome = await getGateway().enterRoutePolicy(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return { to: "/" };
    const grant = await access.authorize(c, principal, "policy.publish");
    if (!grant) return { to: "/policy" };
    try {
      const id = await createPolicyVersionRegistry().publish(c, grant, new TextEncoder().encode(String(formData.get("document") ?? "")), { milliseconds: POLICY_OPERATION_DEADLINE_MS });
      return { to: `/policy?published=${renderPolicyVersionId(id)}` };
    } catch (e) {
      return { to: `/policy?refused=${encodeURIComponent(String((e as Error).message).slice(0, 300))}` };
    }
  });
  redirect(outcome.to);
}

export default async function Policy({ searchParams }: { searchParams: Promise<{ id?: string; published?: string; refused?: string }> }) {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const cookieValue = (await headers()).get("x-verin-session") ?? (await cookies()).get("verin_session")?.value;
  const params = await searchParams;
  const requested = params.id?.trim() ?? "";
  // The route boundary mints `at` from the process clock exactly once, and the deadline from the
  // slice-owned constant; an operator-typed historical instant would be data, not authority.
  const at = new Date().toISOString();
  type View = {
    denied: boolean;
    refusal?: { title: string; body: string; alert?: boolean };
    version?: PublishedPolicyVersion;
    inForce?: PolicyVersionId | PolicyNotFound;
    history?: PolicyVersionId[];
  } | null;
  const refuse = (title: string, body: string, alert = false) => ({ title, body, alert });
  const view: View = await getGateway().enterRoutePolicy(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "policy.read");
    if (!grant) return { denied: true };
    const registry = createPolicyVersionRegistry();
    const deadline = { milliseconds: POLICY_OPERATION_DEADLINE_MS };
    try {
      const inForce = await registry.resolveInForce(c, grant, at, deadline);
      const history = await registry.history(c, grant, deadline);
      if (!requested) return { denied: false, inForce, history };
      const id = parsePolicyVersionId(requested);
      if (!id)
        return {
          denied: false,
          inForce,
          history,
          refusal: refuse("Not a policy version identity", "A version identity reads fpd.v1: followed by 64 hexadecimal characters, so there is nothing to resolve."),
        };
      const resolved = await registry.resolveByHash(c, grant, id, deadline);
      if (resolved.kind === "not-found")
        return {
          denied: false,
          inForce,
          history,
          refusal: refuse(
            "No such version on your firm's shelf",
            `Verin holds no published version ${resolved.subject} for your firm. Nothing was substituted: a missing version yields no policy at all.`,
          ),
        };
      return { denied: false, inForce, history, version: resolved };
    } catch (e) {
      if (!FAIL_CLOSED.test(String(e))) throw e;
      // The fail-closed refusals (M-A tamper; M-C gap), named on screen and never substituted.
      return { denied: false, refusal: refuse("This shelf cannot be read as published", `${(e as Error).message}. Verin refuses to parse, substitute, or derive anything from it.`, true) };
    }
  });
  if (!view) redirect("/");
  if (view.denied)
    return (
      <p className="alert" role="alert">
        {"Your role is not permitted to read firm policy."}
      </p>
    );
  const shelfEmpty = view.history !== undefined && view.history.length === 0;
  return (
    <section className="stack" data-testid="verin-policy-loaded" aria-labelledby="policy-heading">
      <h1 id="policy-heading">Firm policy</h1>
      <p className="meta">Every published version is addressed by the fingerprint of its exact bytes; the version in force is derived from the append-only sequence alone.</p>
      {params.refused ? (
        <p className="alert" role="alert">
          Publishing was refused: {params.refused}
        </p>
      ) : null}
      {params.published ? (
        <p className="meta" role="status">
          Published as <a href={`/policy?id=${params.published}`}>{params.published}</a> - a new version on your firm's shelf; nothing already published moved.
        </p>
      ) : null}
      {view.refusal ? (
        <div className="card-dashed" role={view.refusal.alert ? "alert" : "status"}>
          <p className="title">{view.refusal.title}</p>
          <p>{view.refusal.body}</p>
        </div>
      ) : null}
      {shelfEmpty ? (
        <div className="card-dashed">
          <p className="title">No policy is on your firm's shelf yet</p>
          <p>No version has been published, so no policy is in force: Verin holds nothing to fall back on, and invents nothing. Publish a first version below.</p>
        </div>
      ) : null}
      {view.inForce && "digest" in view.inForce && !shelfEmpty ? (
        <p className="meta" role="status">
          In force as of {formatObservationDate(at)}: <a href={`/policy?id=${renderPolicyVersionId(view.inForce)}`}>{renderPolicyVersionId(view.inForce)}</a>
        </p>
      ) : null}
      {view.history !== undefined && !shelfEmpty ? (
        <ul className="register" aria-label="Every published version of your firm's policy, in publish order">
          {view.history.map((id, i) => (
            <li key={id.digest}>
              <strong>Version {i + 1}</strong>
              <a href={`/policy?id=${renderPolicyVersionId(id)}`}>{renderPolicyVersionId(id)}</a>
            </li>
          ))}
        </ul>
      ) : null}
      {view.version ? (
        <>
          <h2 className="section-heading">Version {view.version.sequence} on your firm's shelf</h2>
          <p className="meta">
            Published {formatObservationDate(view.version.publishedAt)} &middot; {renderPolicyVersionId(view.version.id)}
            {view.version.origin === "demo-seed" ? " · " : ""}
            {view.version.origin === "demo-seed" ? <span className="badge-demo">demonstration record</span> : null}
          </p>
          <ul className="register" aria-label="The policy this version resolves to">
            {policyRows(view.version.policy).map(([label, value]) => (
              <li key={label}>
                <strong>{label}</strong>
                <span>{value}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <form method="get" action="/policy" className="stack">
        <div className="field">
          <label htmlFor="id">Version identity</label> <input id="id" name="id" type="text" defaultValue={requested} placeholder={"fpd.v1:…"} required />
        </div>
        <button className="btn-primary" type="submit">
          {"Inspect version"}
        </button>
      </form>
      <h2 className="section-heading">Publish a new version</h2>
      <form action={submitPolicy} className="stack">
        <div className="field">
          <label htmlFor="document">Policy document (strict JSON; every field a closed vocabulary; silence is "not-stated")</label>
          <textarea id="document" name="document" rows={6} required />
        </div>
        <button className="btn-primary" type="submit">
          {"Publish version"}
        </button>
      </form>
    </section>
  );
}
