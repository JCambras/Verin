// The firm-policy shelf's inspect view (prompt 4 deliverable 5; history, in-force and the publish
// form are PR-4b). A missing identity renders the typed NotFound naming it; tampered bytes render
// the fail-closed integrity refusal naming both digests - never a quiet substitution. Dates are
// worded, never YYYY-MM-DD; the figures carry the version's own provenance line and origin chip.
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

export default async function Policy({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const cookieValue = (await headers()).get("x-verin-session") ?? (await cookies()).get("verin_session")?.value;
  const requested = (await searchParams).id?.trim() ?? "";
  type View = { denied: boolean; refusal?: { title: string; body: string; alert?: boolean }; version?: PublishedPolicyVersion } | null;
  const refuse = (title: string, body: string, alert = false): View => ({ denied: false, refusal: { title, body, alert } });
  const view: View = await getGateway().enterRoutePolicy(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "policy.read");
    if (!grant) return { denied: true };
    if (!requested) return { denied: false };
    const id = parsePolicyVersionId(requested);
    if (!id) return refuse("Not a policy version identity", "A version identity reads fpd.v1: followed by 64 hexadecimal characters, so there is nothing to resolve.");
    let resolved: PublishedPolicyVersion | PolicyNotFound;
    try {
      resolved = await createPolicyVersionRegistry().resolveByHash(c, grant, id, { milliseconds: POLICY_OPERATION_DEADLINE_MS });
    } catch (e) {
      if (!/edited in place/.test(String(e))) throw e;
      // The fail-closed integrity refusal, naming both digests: rendered, never substituted (M-A).
      return refuse("This version's stored bytes no longer match their address", `${(e as Error).message}. Verin refuses to parse or display a tampered document; no policy was substituted.`, true);
    }
    if (resolved.kind === "not-found")
      return refuse("No such version on your firm's shelf", `Verin holds no published version ${resolved.subject} for your firm. Nothing was substituted: a missing version yields no policy at all.`);
    return { denied: false, version: resolved };
  });
  if (!view) redirect("/");
  if (view.denied)
    return (
      <p className="alert" role="alert">
        Your role is not permitted to read firm policy.
      </p>
    );
  return (
    <section className="stack" data-testid="verin-policy-loaded" aria-labelledby="policy-heading">
      <h1 id="policy-heading">Firm policy</h1>
      <p className="meta">Enter a version identity to inspect the exact document it will always resolve to; every published version is addressed by the fingerprint of its bytes.</p>
      <form method="get" action="/policy" className="stack">
        <div className="field">
          <label htmlFor="id">Version identity</label>
          <input id="id" name="id" type="text" defaultValue={requested} placeholder={"fpd.v1:…"} required />
        </div>
        <button className="btn-primary" type="submit">
          Inspect version
        </button>
      </form>
      {view.refusal ? (
        <div className="card-dashed" role={view.refusal.alert ? "alert" : "status"}>
          <p className="title">{view.refusal.title}</p>
          <p>{view.refusal.body}</p>
        </div>
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
    </section>
  );
}
