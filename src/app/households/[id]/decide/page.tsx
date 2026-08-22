// The decision surface (prompt 5, PR-5a-i): an advisor asks for a distribution and sees a REAL
// decision - computed by the pure module from freshly assembled evidence and the in-force policy
// version, citing every identity it stands on. The request arrives as typed, request-scoped query
// parameters, UNPERSISTED; the route boundary mints asOf and the request correlation once; the
// DecisionId exists only after evaluate returns, and the outcome-rendering step enters under
// DecisionCorrelation - the correlation kind changes inside the request, which is the point.
// PR-5a-ii completes the surface: the operator-entered typed form, the precedence trace, the
// explanation register, the reserve figures through the provenance-carrying metric, and the
// prohibited stamp with zero affordances.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { createAccessContext } from "../../../../access/context";
import { decisionCorrelation, decisionIdFromOutcomeDigest, getGateway, mintRequestId, requestCorrelation } from "../../../../runtime/governed";
import { assembleEvidence } from "../../../../evidence/bundle";
import { EVIDENCE_ASSEMBLY_DEADLINE_MS } from "../../../../evidence/vocabulary";
import { KIND_NEXT_STEPS, formatObservationDate } from "../../../../evidence/projection";
import { POLICY_OPERATION_DEADLINE_MS, createPolicyVersionRegistry } from "../../../../policy/registry";
import { MAX_USD, PURPOSES, evaluate, outcomeDigest, type DecisionOutcome, type ExplanationCode, type Purpose } from "../../../../decision/outcome";
import { createDecisionRecord } from "../../../../record/decision-record";
import { DisplayMetric } from "../../../metric";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PURPOSE_LABELS: Record<Purpose, string> = { "home-renovation": "Home renovation", "property-closing": "Property closing", "renovation-deposit": "Renovation deposit" };
// Committed static templates per code (the projection idiom): the engine produces CODES; prose is presentation.
const EXPLANATION_TEXT: Record<ExplanationCode, string> = {
  "source-account-selected": "A taxable source account was selected; a retirement account is never chosen silently.",
  "cash-reserve-preserved": "After this movement the household still holds its policy-required months of planned withdrawals.",
  "cash-reserve-breach": "This movement would leave less than the policy-required cash reserve.",
  "effective-liquidity-computed": "Pending approved activity counts against the household, so effective liquidity sits below the raw balance.",
  "individually-valid": "Alone, this movement preserves the reserve; the joint constraint was checked against pending activity.",
  "individually-valid-jointly-overcommitted": "Alone this request is valid; together with the reserved sibling movement it would breach the reserve.",
  "reservation-prevents-joint-violation": "The sibling reservation makes the joint constraint visible, so two valid requests cannot jointly violate policy.",
  "dual-approval-required": "The amount exceeds the firm's dual-approval threshold, so distinct approvers are required before execution.",
  "dual-approval-not-required": "The amount is below the firm's dual-approval threshold - the policy differs, not the code.",
  "recent-bank-change-detected": "The destination bank instruction changed recently and is not yet independently verified.",
  "specialist-review-required": "This firm routes a recent bank-instruction change to specialist review, not an execution block.",
  "blocked-until-independently-verified": "This firm blocks execution until the changed instruction is independently verified.",
  "destination-restriction-applies": "The household's standing destination restriction governs every outbound movement.",
  "destination-off-list": "The requested destination is not titled to the household; no approval affordance exists.",
  "legal-hold-detected": "The account-restriction evidence shows an active legal hold on the source account.",
  "regulatory-precedence-applied": "Regulatory sources outrank firm policy and household instructions in the precedence trace.",
  "household-candidates-found": "More than one household matches; the candidates are shown with context.",
  "human-disambiguation-required": "Verin asks a structured question instead of guessing; the answer becomes recorded evidence.",
  "freshness-window-exceeded": "Reserve-material evidence is older than the freshness window allows.",
  "stale-cannot-silently-proceed": "Present-but-stale evidence cannot silently proceed; the resolving step is a refresh, never an override.",
  "material-evidence-conflicting": "Observations of the same subject disagree; no side is picked by recency.",
  "approval-authority-not-stated": "The firm's policy does not state who may approve; Verin refuses honestly rather than inventing an approver.",
};
const RULE_LABELS: Record<string, string> = {
  "household-resolution": "Household resolution",
  "regulatory-precedence": "Regulatory precedence",
  "destination-restriction": "Destination restriction",
  "evidence-conflict": "Evidence agreement",
  "source-selection": "Source selection",
  "cash-reserve": "Cash reserve",
  "bank-instruction-change": "Bank-instruction change",
  "authority-derivation": "Authority derivation",
};
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
  const requery = new URLSearchParams();
  requery.set("amount", form.amount ?? "");
  requery.set("purpose", form.purpose ?? "");
  requery.set("deadline", form.deadline ?? "");
  const asOf = new Date().toISOString();
  // prettier-ignore
  type View = null | { state: "denied" } | { state: "form"; household: { id: string; name: string } } | { state: "refused"; household: { id: string; name: string }; problems: string[] } | { state: "no-policy"; household: { id: string; name: string } }
    | { state: "decided"; household: { id: string; name: string }; outcome: DecisionOutcome; decisionIdText: string; demonstration: boolean; requested: { amountUsd: number; purpose: Purpose; deadline: string }; recording: { state: "recorded"; sequence: number; entryId: string; reused: boolean } | { state: "awaiting-continuity" } };
  const view: View | "no-household" = await getGateway().enterRouteDecision(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "decision.evaluate");
    if (!grant) return { state: "denied" } as const;
    const household = await access.withTenant(c, grant, (tx) => tx.getHousehold(id));
    if (!household) return "no-household" as const;
    if (form.amount === undefined && form.purpose === undefined && form.deadline === undefined) return { state: "form", household } as const;
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
    const dc = decisionCorrelation(requestId, decisionId);
    const base = await getGateway().enterDecisionRenderOutcome(dc, async () => ({
      state: "decided" as const,
      household,
      outcome,
      decisionIdText: `d${decisionId.value}`,
      demonstration: bundle.observations.some((o) => o.origin === "demo-seed"),
      requested: { amountUsd, purpose, deadline },
    }));
    const recordGrant = await access.authorize(c, principal, "decision.record");
    if (!recordGrant) return { state: "denied" } as const;
    const recordedAt = new Date().toISOString();
    try {
      const recorded = await createDecisionRecord(dc, recordGrant).record({
        outcome,
        evidence: bundle,
        policy: version,
        recordedAt,
        producer: { kind: "web", id: `i${principal.identityId.replaceAll("-", "")}`, producedAt: recordedAt },
        recordOrigin: base.demonstration ? "demo-seed" : "operator-entry",
      });
      return { ...base, recording: { state: "recorded" as const, sequence: recorded.sequence, entryId: recorded.entryId, reused: recorded.alreadyRecorded } };
    } catch (error) {
      if ((error as Error).message.startsWith("continuity-boundary-not-authorized:")) return { ...base, recording: { state: "awaiting-continuity" as const } };
      throw error;
    }
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
        This decision is computed from freshly assembled evidence and its exact policy version. Recording is atomic once this tenant has an authorized continuity boundary; a re-render with a changed
        world yields a new identity.
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
          <div className="card-dashed" role="status" data-recording={view.recording.state}>
            <p className="title">{view.recording.state === "recorded" ? `Recorded atomically at sequence ${view.recording.sequence}` : "Recording awaits the authorized continuity boundary"}</p>
            <p>
              {view.recording.state === "recorded"
                ? `${view.recording.reused ? "The exact retry reused" : "The append created"} entry ${view.recording.entryId}; exact sources, genesis, chain entry, anchor and projection committed together.`
                : "No partial source or ledger row was written. The first genesis will cite only the separately authorized lcm.v1 digest."}
            </p>
          </div>
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
          {o.disposition === "prohibited" ? (
            <div className="card-dashed" role="status" data-disposition="prohibited" style={{ borderColor: "var(--destructive)", borderStyle: "solid" }}>
              <p className="title" style={{ color: "var(--destructive)" }}>
                Prohibited - {worded(o.prohibition.reasonCode)}
              </p>
              <p>
                Source: {worded(o.prohibition.source.sourceType)} {o.prohibition.source.versionId ?? o.prohibition.source.sourceId}. No approval can waive this; no affordance is offered.
              </p>
            </div>
          ) : null}
          {(() => {
            const figures = o.trace.find((x) => x.rule === "cash-reserve" && x.figures && typeof x.figures["remainingUsd"] === "number")?.figures;
            return figures ? (
              <DisplayMetric
                metric={{
                  label: "Remaining after this movement, against the required reserve",
                  value: `${usdText(figures["remainingUsd"])} vs ${usdText(figures["requiredReserveUsd"])}`,
                  source: "derived from the household's evidence bundle and the in-force policy version",
                  asOf: new Date(o.citations.asOf),
                  demonstration: view.demonstration,
                }}
              />
            ) : null;
          })()}
          <h2 className="section-heading">Why</h2>
          <ul className="register" aria-label="The explanation behind this decision">
            {o.explanations.map((e) => (
              <li key={e.code}>
                <strong>{worded(e.code)}</strong>
                <span>{EXPLANATION_TEXT[e.code]}</span>
              </li>
            ))}
          </ul>
          <h2 className="section-heading">Precedence trace</h2>
          <ul className="register" aria-label="Every rule evaluated, in precedence order">
            {o.trace.map((x) => (
              <li key={x.rule}>
                <strong>{RULE_LABELS[x.rule] ?? x.rule}</strong>
                <span>
                  {x.result}
                  {x.figures
                    ? ` (${Object.entries(x.figures)
                        .map(([k, v]) => `${k} ${usdText(v)}`)
                        .join(", ")})`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="meta">
            <a href={`/households/${view.household.id}/decide/compare?${requery.toString()}`}>Compare this request under both ratified configurations</a> - same facts, different policy, both correct.
          </p>
          <p className="meta">
            Decision {view.decisionIdText} · request {o.citations.request} · evidence {o.citations.evidenceBundle} · policy {o.citations.policy} · as of {formatObservationDate(o.citations.asOf)}
            {view.demonstration ? " · " : ""}
            {view.demonstration ? <span className="badge-demo">demonstration - not a compliance record</span> : null}
          </p>
        </>
      ) : null}
      <h2 className="section-heading">Request a distribution decision</h2>
      <form method="get" className="stack">
        <div className="field">
          <label htmlFor="amount">Amount (whole USD)</label> <input id="amount" name="amount" type="text" inputMode="numeric" defaultValue={form.amount ?? ""} required />
        </div>
        <div className="field">
          <label htmlFor="purpose">Purpose</label>{" "}
          <select id="purpose" name="purpose" defaultValue={form.purpose ?? "home-renovation"}>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="deadline">Deadline</label> <input id="deadline" name="deadline" type="date" defaultValue={form.deadline ?? ""} required />
        </div>
        <button className="btn-primary" type="submit">
          {"Compute decision"}
        </button>
      </form>
      <p className="meta">
        The request is typed and request-scoped; nothing entered here is persisted. <a href={`/households/${view.household.id}`}>Back to the household workspace</a>.
      </p>
    </section>
  );
}
