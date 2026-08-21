// The Firm A / Firm B comparison surface (prompt 5, PR-5b): the SAME request and the SAME evidence
// bundle evaluated under both ratified firm-policy archetypes, side by side - different answers,
// both correct, from configuration alone. The archetypes are committed demonstration
// configurations (labelled; byte-equal to what the seed publishes to each firm's own shelf) - no
// tenant boundary is crossed to show them. Each side's outcome mints its OWN DecisionId and its
// rendering step enters under its own DecisionCorrelation; the engine identity (den.v1, hashed
// over the exact closure the purity proof resolves) is one value across both sides while the two
// fpd.v1 content hashes differ - which is the whole point, asserted in suite and visible here.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { createAccessContext } from "../../../../../access/context";
import { decisionCorrelation, decisionIdFromOutcomeDigest, getGateway, mintRequestId, requestCorrelation } from "../../../../../runtime/governed";
import { assembleEvidence } from "../../../../../evidence/bundle";
import { EVIDENCE_ASSEMBLY_DEADLINE_MS } from "../../../../../evidence/vocabulary";
import { formatObservationDate } from "../../../../../evidence/projection";
import { parseFirmPolicy } from "../../../../../policy/registry";
import { MAX_USD, PURPOSES, evaluate, outcomeDigest, type DecisionOutcome, type Purpose } from "../../../../../decision/outcome";
import { COMPARISON_ARCHETYPES } from "../../../../../decision/comparison-archetypes";
import engineIdentityFile from "../../../../../decision/engine-identity.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const worded = (code: string) => code.replaceAll("-", " ").replaceAll("_", " ");
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
type Side = { label: string; policyId: string; outcome: DecisionOutcome; decisionIdText: string };

export default async function Compare({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ amount?: string; purpose?: string; deadline?: string }> }) {
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
  const view = await getGateway().enterRouteDecisionCompare(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "decision.evaluate");
    if (!grant) return "denied" as const;
    const household = await access.withTenant(c, grant, (tx) => tx.getHousehold(id));
    if (!household) return "no-household" as const;
    const amountUsd = /^\d{1,7}$/.test(form.amount ?? "") ? Number(form.amount) : null;
    const purpose = (PURPOSES as readonly string[]).includes(form.purpose ?? "") ? (form.purpose as Purpose) : null;
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(form.deadline ?? "") ? form.deadline! : null;
    if (amountUsd === null || amountUsd < 1 || amountUsd > MAX_USD || purpose === null || deadline === null) return "refused" as const;
    const bundle = await assembleEvidence(c, grant, { householdId: id }, asOf, { milliseconds: EVIDENCE_ASSEMBLY_DEADLINE_MS });
    const local = createHash("sha256").update(`drq-ref|${household.id}|${amountUsd}|${purpose}|${deadline}`).digest("hex").slice(0, 15);
    const request = { requestRef: `req:r${local}`, householdSlug: slugify(household.name), amountUsd, purpose, deadline };
    const identities = {
      firm: `f${grant.principal.tenant.orgId.replaceAll("-", "")}`,
      household: `h${household.id.replaceAll("-", "")}`,
      requesterRole: `r${createHash("sha256").update(`role|${grant.principal.role}`).digest("hex").slice(0, 32)}`,
    };
    const sides: Side[] = [];
    for (const archetype of COMPARISON_ARCHETYPES) {
      const bytes = new TextEncoder().encode(archetype.document);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const outcome = evaluate({ request, evidenceBundle: bundle, policyDocument: { id: { version: "fpd.v1", digest }, policy: parseFirmPolicy(bytes) }, identities, asOf });
      // Each side's identity exists only after ITS evaluation returns; each rendering step enters
      // under its own decision correlation - entered once per firm side, which is the point.
      const decisionId = decisionIdFromOutcomeDigest(outcomeDigest(outcome));
      const side = await getGateway().enterDecisionCompareSide(decisionCorrelation(requestId, decisionId), async () => ({
        label: archetype.label,
        policyId: `fpd.v1:${digest}`,
        outcome,
        decisionIdText: `d${decisionId.value}`,
      }));
      sides.push(side);
    }
    const demonstration = bundle.observations.some((o) => o.origin === "demo-seed");
    return {
      household,
      sides,
      demonstration,
      evidenceId: sides[0].outcome.citations.evidenceBundle,
      requestText: `${request.requestRef} · $${amountUsd.toLocaleString("en-US")} ${purpose} by ${deadline}`,
    };
  });
  if (!view) redirect("/");
  if (view === "no-household") redirect("/households");
  if (view === "denied")
    return (
      <p className="alert" role="alert">
        {"Your role is not permitted to evaluate decisions."}
      </p>
    );
  if (view === "refused") redirect(`/households/${id}/decide`);
  return (
    <section className="stack" data-testid="verin-compare-loaded" aria-labelledby="compare-heading">
      <h1 id="compare-heading">Same facts, both correct - {view.household.name} under both ratified configurations</h1>
      <p className="meta">
        One request, one evidence bundle ({view.evidenceId}), one engine ({engineIdentityFile.engine}) - and two published policy identities. The answers differ because the CONFIGURATION differs; not
        one line of decision code changes between the columns. Both columns are committed demonstration archetypes, and this comparison is computed now and recorded nowhere.
      </p>
      <p className="meta">
        Request {view.requestText} · as of {formatObservationDate(asOf)}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        {view.sides.map((side) => (
          <div className="card-dashed" key={side.policyId} data-compare-side={side.outcome.disposition}>
            <p className="title">{side.label}</p>
            <p>
              <strong>{worded(side.outcome.disposition)}</strong>
              {side.outcome.disposition === "proceed"
                ? ` - authority ${side.outcome.authority.mode === "automatic" ? "automatic" : side.outcome.authority.stages.map((s) => s.stageId).join(", then ")}`
                : side.outcome.disposition === "blocked"
                  ? ` - ${side.outcome.blockers.map((b) => worded(b.code)).join("; ")}`
                  : ` - ${worded(side.outcome.prohibition.reasonCode)}`}
            </p>
            <p className="meta">
              policy {side.policyId} · decision {side.decisionIdText}
              {view.demonstration ? " · " : ""}
              {view.demonstration ? <span className="badge-demo">demonstration - not a compliance record</span> : null}
            </p>
          </div>
        ))}
      </div>
      <p className="meta">
        Approver role and requester rule under the Firm B archetype: the typed "not-stated" - recorded silence, never filled in.{" "}
        <a href={`/households/${view.household.id}/decide?${requery.toString()}`}>Back to the decision surface</a>.
      </p>
    </section>
  );
}
