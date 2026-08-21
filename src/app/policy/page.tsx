// The firm-policy shelf's inspect view (prompt 4 deliverable 5; PR-4a of the section 7 restack -
// history, in-force and the publish form land in PR-4b). An operator resolves a published version by
// its content address; a missing identity renders the typed NotFound naming it, a malformed identity
// renders a typed refusal, and a version whose stored bytes no longer hash to their address renders
// the fail-closed integrity refusal naming both digests - never a quiet substitution. Dates are
// worded, never YYYY-MM-DD (the PR-3a hyphenated-form lesson); every displayed figure carries the
// version's own provenance line, and a demonstration record wears its chip.
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

const ROLE_LABELS: Record<string, string> = { operations: "Operations" };
const REQUESTER_LABELS: Record<string, string> = { "may-not-satisfy-both-approvals": "The requester may not satisfy both approvals" };
const HANDLING_LABELS: Record<string, string> = {
  "specialist-review": "A recent bank-instruction change requires specialist review",
  "block-until-independently-verified": "A recent bank-instruction change blocks execution until independently verified",
};
const NOT_STATED_LABEL = "Not stated - the ratified contract is silent, and Verin does not invent firm policy";
const orStated = (value: string, labels: Record<string, string>) => (value === NOT_STATED ? NOT_STATED_LABEL : labels[value]);
function policyRows(policy: FirmPolicy): [string, string][] {
  return [
    ["Cash reserve horizon", `${policy.reserveHorizonMonths} months of planned withdrawals`],
    ["Dual-approval threshold", `$${policy.dualApproval.thresholdUsd.toLocaleString("en-US")}`],
    ["Approvals required", `${policy.dualApproval.approvalsRequired}`],
    ["Distinct approvers required", policy.dualApproval.distinctActorsRequired ? "Yes" : "No"],
    ["Eligible approver role", orStated(policy.dualApproval.eligibleApproverRole, ROLE_LABELS)],
    ["Requester rule", orStated(policy.dualApproval.requesterRule, REQUESTER_LABELS)],
    ["Bank-instruction change", HANDLING_LABELS[policy.bankInstructionChange]],
    ["Approval stage shape", policy.approvalStages === NOT_STATED ? NOT_STATED_LABEL : `${policy.approvalStages.length} configured stages`],
    ["Reservation window", policy.reservationWindowDays === NOT_STATED ? NOT_STATED_LABEL : `${policy.reservationWindowDays} days`],
  ];
}

export default async function Policy({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const cookieValue = (await headers()).get("x-verin-session") ?? (await cookies()).get("verin_session")?.value;
  const requested = (await searchParams).id?.trim() ?? "";
  const view = await getGateway().enterRoutePolicy(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "policy.read");
    if (!grant) return { denied: true as const };
    if (!requested) return { denied: false as const };
    const id = parsePolicyVersionId(requested);
    if (!id) return { denied: false as const, malformed: requested };
    try {
      return { denied: false as const, resolved: await createPolicyVersionRegistry().resolveByHash(c, grant, id, { milliseconds: POLICY_OPERATION_DEADLINE_MS }) };
    } catch (e) {
      if (!/edited in place/.test(String(e))) throw e;
      return { denied: false as const, integrity: (e as Error).message };
    }
  });
  if (!view) redirect("/");
  if (view.denied)
    return (
      <p className="alert" role="alert">
        Your role is not permitted to read firm policy.
      </p>
    );
  const resolved = "resolved" in view ? (view.resolved as PublishedPolicyVersion | PolicyNotFound) : null;
  return (
    <section className="stack" data-testid="verin-policy-loaded" aria-labelledby="policy-heading">
      <h1 id="policy-heading">Firm policy</h1>
      <p className="meta">
        Every published version of your firm's policy is addressed by the fingerprint of its exact bytes. Enter a version identity to inspect the document it will always resolve to.
      </p>
      <form method="get" action="/policy" className="stack">
        <div className="field">
          <label htmlFor="id">Version identity</label>
          <input id="id" name="id" type="text" defaultValue={requested} placeholder={"fpd.v1:…"} required />
        </div>
        <button className="btn-primary" type="submit">
          Inspect version
        </button>
      </form>
      {"malformed" in view && view.malformed !== undefined ? (
        <div className="card-dashed" role="status">
          <p className="title">Not a policy version identity</p>
          <p>A version identity reads fpd.v1: followed by 64 hexadecimal characters. What was entered is not one, so there is nothing to resolve.</p>
        </div>
      ) : null}
      {"integrity" in view && view.integrity !== undefined ? (
        <div className="card-dashed" role="alert">
          <p className="title">This version's stored bytes no longer match their address</p>
          <p>{view.integrity}</p>
          <p>Verin refuses to parse or display a tampered document. No policy was substituted.</p>
        </div>
      ) : null}
      {resolved?.kind === "not-found" ? (
        <div className="card-dashed" role="status">
          <p className="title">No such version on your firm's shelf</p>
          <p>Verin holds no published version {resolved.subject} for your firm. Nothing was substituted: a missing version yields no policy at all.</p>
        </div>
      ) : null}
      {resolved?.kind === "policy-version" ? (
        <>
          <h2 className="section-heading">Version {resolved.sequence} on your firm's shelf</h2>
          <p className="meta">
            Published {formatObservationDate(resolved.publishedAt)} &middot; {renderPolicyVersionId(resolved.id)}
            {resolved.origin === "demo-seed" ? " · " : ""}
            {resolved.origin === "demo-seed" ? <span className="badge-demo">demonstration record</span> : null}
          </p>
          <ul className="register" aria-label="The policy this version resolves to">
            {policyRows(resolved.policy).map(([label, value]) => (
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
