// The decision surface (prompt 5, PR-5a-i): an advisor asks for a distribution and sees a REAL
// decision - computed by the pure module from freshly assembled evidence and the in-force policy
// version, citing every identity it stands on. The request arrives as typed, request-scoped query
// parameters, UNPERSISTED; the route boundary mints asOf and the request correlation once; the
// DecisionId exists only after evaluate returns, and the outcome-rendering step enters under
// DecisionCorrelation - the correlation kind changes inside the request, which is the point. The
// operator-entered form, trace and explanation registers join with PR-5a-ii, per the announced split.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { createAccessContext } from "../../../../access/context";
import { decisionCorrelation, decisionIdFromOutcomeDigest, getGateway, mintRequestId, requestCorrelation } from "../../../../runtime/governed";
import { assembleEvidence } from "../../../../evidence/bundle";
import { EVIDENCE_ASSEMBLY_DEADLINE_MS } from "../../../../evidence/vocabulary";
import { KIND_NEXT_STEPS, formatObservationDate } from "../../../../evidence/projection";
import { POLICY_OPERATION_DEADLINE_MS, createPolicyVersionRegistry } from "../../../../policy/registry";
import { MAX_USD, PURPOSES, evaluate, outcomeDigest, type DecisionOutcome, type Purpose } from "../../../../decision/outcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURPOSE_LABELS: Record<Purpose, string> = { "home-renovation": "Home renovation", "property-closing": "Property closing", "renovation-deposit": "Renovation deposit" };
const usdText = (n: number) => `$${n.toLocaleString("en-US")}`;
const worded = (code: string) => code.replaceAll("-", " ").replaceAll("_", " ");
const nextStepFor = (kind: string) => (kind in KIND_NEXT_STEPS ? KIND_NEXT_STEPS[kind as keyof typeof KIND_NEXT_STEPS] : `Record the household's ${worded(kind)} evidence in the house record store.`);
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default async function Decide({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ amount?: string; purpose?: string; deadline?: string }> }) {
  const requestId = mintRequestId();
  const c = requestCorrelation(requestId);
  const access = createAccessContext();
  const cookieValue = (await headers()).get("x-verin-session") ?? (await cookies()).get("verin_session")?.value;
  const { id } = await params;
  const form = await searchParams;
  const asOf = new Date().toISOString();
  // prettier-ignore
  type View = null | { state: "denied" } | { state: "refused"; household: { id: string; name: string }; problems: string[] } | { state: "no-policy"; household: { id: string; name: string } }
    | { state: "decided"; household: { id: string; name: string }; outcome: DecisionOutcome; decisionIdText: string; demonstration: boolean; requested: { amountUsd: number; purpose: Purpose; deadline: string } };
  const view: View | "no-household" = await getGateway().enterRouteDecision(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "decision.evaluate");
    if (!grant) return { state: "denied" } as const;
    const household = await access.withTenant(c, grant, (tx) => tx.getHousehold(id));
    if (!household) return "no-household" as const;
    const problems: string[] = [];
    const amountUsd = /^\d{1,7}$/.test(form.amount ?? "") ? Number(form.amount) : null;
    if (amountUsd === null || amountUsd < 1 || amountUsd > MAX_USD) problems.push(`The amount must be a whole-USD figure between $1 and ${usdText(MAX_USD)} - never cents, never free text.`);
    const purpose = (PURPOSES as readonly string[]).includes(form.purpose ?? "") ? (form.purpose as Purpose) : null;
    if (purpose === null) problems.push("The purpose comes from the closed vocabulary; no free text exists on the decision path.");
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(form.deadline ?? "") ? form.deadline! : null;
    if (deadline === null) problems.push("The deadline must be a calendar date.");
    if (amountUsd === null || purpose === null || deadline === null) return { state: "refused", household, problems } as const;
    const policyGrant = await access.authorize(c, principal, "policy.read");
    if (!policyGrant) return { state: "denied" } as const;
    const registry = createPolicyVersionRegistry();
    const deadlineMs = { milliseconds: POLICY_OPERATION_DEADLINE_MS };
    const inForce = await registry.resolveInForce(c, policyGrant, asOf, deadlineMs);
    if ("kind" in inForce) return { state: "no-policy", household } as const;
    const version = await registry.resolveByHash(c, policyGrant, inForce, deadlineMs);
    if (version.kind !== "policy-version") return { state: "no-policy", household } as const;
    const bundle = await assembleEvidence(c, grant, { householdId: id }, asOf, { milliseconds: EVIDENCE_ASSEMBLY_DEADLINE_MS });
    const local = createHash("sha256").update(`drq-ref|${household.id}|${amountUsd}|${purpose}|${deadline}`).digest("hex").slice(0, 15);
    const outcome = evaluate({
      request: { requestRef: `req:r${local}`, householdSlug: slugify(household.name), amountUsd, purpose, deadline },
      evidenceBundle: bundle,
      policyDocument: { id: version.id, policy: version.policy },
      identities: {
        firm: `f${grant.principal.tenant.orgId.replaceAll("-", "")}`,
        household: `h${household.id.replaceAll("-", "")}`,
        requesterRole: `r${createHash("sha256").update(`role|${grant.principal.role}`).digest("hex").slice(0, 32)}`,
      },
      asOf,
    });
    // The first moment a decision identity CAN exist: minted from the outcome's own digest, never
    // before, never from a request id. The rendering step below runs under DecisionCorrelation.
    const decisionId = decisionIdFromOutcomeDigest(outcomeDigest(outcome));
    return getGateway().enterDecisionRenderOutcome(decisionCorrelation(requestId, decisionId), async () => ({
      state: "decided" as const,
      household,
      outcome,
      decisionIdText: `d${decisionId.value}`,
      demonstration: bundle.observations.some((o) => o.origin === "demo-seed"),
      requested: { amountUsd, purpose, deadline },
    }));
  });
  if (!view) redirect("/");
  if (view === "no-household") redirect("/households");
  if (view.state === "denied")
    return (
      <p className="alert" role="alert">
        {"Your role is not permitted to evaluate decisions."}
      </p>
    );
  const o = view.state === "decided" ? view.outcome : null;
  return (
    <section className="stack" data-testid="verin-decide-loaded" aria-labelledby="decide-heading">
      <h1 id="decide-heading">Decide a distribution - {view.household.name}</h1>
      <p className="meta">
        This decision is computed now and recorded nowhere until prompt 6's decision ledger lands. A re-render re-assembles evidence at a new as-of instant, so a changed world yields a new decision
        citing the new bundle identity.
      </p>
      {view.state === "refused" ? (
        <div className="card-dashed" role="alert">
          <p className="title">This request cannot be evaluated as entered</p>
          {view.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      ) : null}
      {view.state === "no-policy" ? (
        <div className="card-dashed">
          <p className="title">No firm policy is in force</p>
          <p>
            A decision cites the exact policy version it was made under, and your firm's shelf derives none as in force. <a href="/policy">Publish a firm policy version</a> first - Verin invents
            nothing.
          </p>
        </div>
      ) : null}
      {view.state === "decided" && o ? (
        <>
          {o.disposition === "proceed" ? (
            <div className="card-dashed" role="status" data-disposition="proceed">
              <p className="title">
                Proceed - {usdText(view.requested.amountUsd)} for {PURPOSE_LABELS[view.requested.purpose]} by {formatObservationDate(view.requested.deadline)}
              </p>
              <p>
                Recommended source: {o.sourceSelection.selected}. Authority:{" "}
                {o.authority.mode === "automatic" ? "automatic - no approval stage applies under this policy version" : `${o.authority.stages.length} stage(s) before execution`}.
              </p>
              {o.authority.stages.map((s) => (
                <p key={s.stageId}>
                  Stage {s.order}: {s.stageId} - {s.approvalsRequired} approval(s) by {s.eligibleRoleIds.join(", ")}
                  {s.distinctActorsRequired ? ", distinct approvers" : ""}
                  {s.requesterMayApprove ? "" : ", requester may not approve"}
                </p>
              ))}
              <p className="meta">
                Planned execution: reservation {o.execution.reservation?.reservationRef} on {o.execution.reservation?.conflictKeys.join(", ")} - committed only after authority is complete. Idempotency
                key {o.execution.idempotencyKey ?? "none"}.
              </p>
            </div>
          ) : null}
          {o.disposition === "blocked" ? (
            <div className="card-dashed" role="status" data-disposition="blocked">
              <p className="title">Blocked - this request does not proceed as the world stands</p>
              {o.blockers.map((b) => (
                <p key={b.code}>
                  <strong>{worded(b.code)}</strong>
                  {b.resolvingEvidence.length
                    ? ` - resolve with: ${b.resolvingEvidence.map((r) => nextStepFor(r.kind)).join(" ")}`
                    : " - resolved only by a policy version stating the missing value, never by an invented one."}
                </p>
              ))}
            </div>
          ) : null}
          <p className="meta">
            Decision {view.decisionIdText} · request {o.citations.request} · evidence {o.citations.evidenceBundle} · policy {o.citations.policy} · as of {formatObservationDate(o.citations.asOf)}
            {view.demonstration ? " · " : ""}
            {view.demonstration ? <span className="badge-demo">demonstration - not a compliance record</span> : null}
          </p>
        </>
      ) : null}
      <p className="meta">
        The request is typed and request-scoped; nothing in it is persisted. The operator-entered form arrives with PR-5a-ii.{" "}
        <a href={`/households/${view.household.id}`}>Back to the household workspace</a>.
      </p>
    </section>
  );
}
