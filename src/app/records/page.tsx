import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAccessContext } from "../../access/context";
import { exactBytesIdentity } from "../../record/canonical";
import { createDecisionRecord, listDecisionRecords, resolveDecisionRecordHead } from "../../record/decision-record";
import { decisionCorrelation, decisionIdFromOutcomeDigest, getGateway, mintRequestId, requestCorrelation } from "../../runtime/governed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Records({ searchParams }: { searchParams: Promise<{ id?: string; verify?: string }> }) {
  const requestId = mintRequestId();
  const c = requestCorrelation(requestId);
  const access = createAccessContext();
  const cookieValue = (await headers()).get("x-verin-session") ?? (await cookies()).get("verin_session")?.value;
  const params = await searchParams;
  if (params.verify === "head") {
    const view = await getGateway().enterRouteDecisionChainVerify(c, async () => {
      const principal = await access.authenticate(c, cookieValue);
      if (!principal) return null;
      const grant = await access.authorize(c, principal, "decision.read");
      if (!grant) return { denied: true } as const;
      const head = await resolveDecisionRecordHead(c, grant);
      if (head.kind === "refused") return { denied: false, head } as const;
      const dc = decisionCorrelation(requestId, decisionIdFromOutcomeDigest(head.outcomeIdentity));
      return { denied: false, head, verification: await createDecisionRecord(dc, grant).verify() } as const;
    });
    if (!view) redirect("/");
    if (view.denied)
      return (
        <p role="alert" className="alert">
          Your role is not permitted to read decision records.
        </p>
      );
    const verification = "verification" in view ? view.verification : null;
    const refusal = verification && !verification.ok ? verification.failure : view.head.kind === "refused" ? view.head.failure : null;
    return (
      <section className="stack" data-testid="verin-chain-verification-loaded">
        <h1>Decision-chain verification</h1>
        {verification?.ok ? (
          <div className="card-dashed" role="status">
            <p className="title">Verified through sequence {verification.entryCount - 1}</p>
            <p>Head {verification.headHash}</p>
          </div>
        ) : (
          <p role="alert" className="alert">
            Verification refused: {refusal}.
          </p>
        )}
        <p className="meta">
          Tamper evidence covers application and owner mutation controls, chain links, source identities and the in-database anchor. A fully compromised database administrator who recomputes every
          in-database value can fabricate a self-consistent store; no external latest-head anchor is claimed.
        </p>
        <a href="/records">Back to decision records</a>
      </section>
    );
  }
  const listed = await getGateway().enterRouteDecisionRecords(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "decision.read");
    return grant ? { denied: false, grant, records: await listDecisionRecords(c, grant) } : ({ denied: true } as const);
  });
  if (!listed) redirect("/");
  if (listed.denied)
    return (
      <p role="alert" className="alert">
        Your role is not permitted to read decision records.
      </p>
    );
  const selected = listed.records.find((record) => record.decisionId === params.id);
  let record = null;
  if (selected) {
    const dc = decisionCorrelation(requestId, decisionIdFromOutcomeDigest(exactBytesIdentity("outcome", selected.outcomeBytes)));
    record = await getGateway().enterRouteDecisionRecord(dc, () => createDecisionRecord(dc, listed.grant).load());
  }
  return (
    <section className="stack" data-testid="verin-records-loaded">
      <h1>Decision records</h1>
      <p className="meta">Immutable source bytes and their complete chain are mechanically verified before an examiner record is shown.</p>
      <a href="/records?verify=head">Verify current head</a>
      {params.id && !record ? (
        <p role="alert" className="alert">
          That decision is not on your firm's verified record.
        </p>
      ) : null}
      {record ? (
        <article className="stack" aria-labelledby="record-heading">
          <h2 id="record-heading">Examiner record - {record.outcome.disposition}</h2>
          <p>
            Sequence {record.summary.sequence} - {record.summary.requestRef} - household {record.summary.householdSlug}
          </p>
          <p>
            Authority: {record.outcome.authorityMode}
            {record.outcome.authorityStages.length ? ` - ${record.outcome.authorityStages.join(", ")}` : ""}
          </p>
          {record.outcome.blockers.length ? <p>Blockers: {record.outcome.blockers.join(", ")}</p> : null}
          {record.outcome.prohibition ? <p>Prohibition: {record.outcome.prohibition}</p> : null}
          <ul className="register" aria-label="Policy basis">
            {Object.entries(record.outcome.policyBasis).map(([key, value]) => (
              <li key={key}>
                <strong>{key}</strong>
                <span>{String(value)}</span>
              </li>
            ))}
          </ul>
          <p>
            Evidence provenance: {record.evidence.source}, as of {record.evidence.asOf}. Recorded by {record.producer.kind}:{record.producer.id} at {record.producer.producedAt}.
          </p>
          <ul className="register" aria-label="Exact content identities">
            {Object.entries(record.identities).map(([kind, identity]) => (
              <li key={kind}>
                <strong>{kind}</strong>
                <span>{identity}</span>
              </li>
            ))}
          </ul>
          <p role="status">
            Whole chain verified through {record.verification.through}; entry {record.entryId}; link {record.chainHash}.
          </p>
          {record.summary.recordOrigin === "demo-seed" ? <span className="badge-demo">demonstration record</span> : null}
        </article>
      ) : (
        <ul className="register" aria-label="Your firm's decision records">
          {listed.records.map((item) => (
            <li key={item.decisionId}>
              <a href={`/records?id=${item.decisionId}`}>
                {item.requestRef} - {item.disposition}
              </a>
              <span>sequence {item.sequence}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
