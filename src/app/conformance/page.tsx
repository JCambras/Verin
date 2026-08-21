// The conformance register (prompt 5, PR-5c-i): all sixteen signed cases, every binding field,
// with its three-valued verdict IN PUBLIC - MATCHED, DIFFERS carrying the captain ruling that
// dispositions it in the reconciliation ledger, or NOT-YET-PRODUCIBLE naming the prompt that lands
// it. The page renders the COMMITTED conformance file (docs/evidence/decision-conformance.json,
// regenerated and byte-compared in the blocking job; its generator refuses an unreconciled
// ledger), so what an advisor reads here is exactly what the repository proves - no live grading,
// no smoothing, and the DIFFERS rows stay visible until the captain's signature sitting resolves
// them on the signed side.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAccessContext } from "../../access/context";
import { getGateway, mintRequestId, requestCorrelation } from "../../runtime/governed";
import conformanceFile from "../../../docs/evidence/decision-conformance.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Verdict = { field: string; verdict: "MATCHED" } | { field: string; verdict: "DIFFERS"; ruling: string | null } | { field: string; verdict: "NOT-YET-PRODUCIBLE"; landingPrompt: number };
type ConformanceFile = {
  oracleHead: string;
  totals: { MATCHED: number; DIFFERS: number; "NOT-YET-PRODUCIBLE": number };
  ledgerEntries: number;
  cases: { caseId: string; disposition: string; parseCount: number; verdicts: Verdict[] }[];
};
const file = conformanceFile as ConformanceFile;

export default async function Conformance() {
  const c = requestCorrelation(mintRequestId());
  const access = createAccessContext();
  const cookieValue = (await headers()).get("x-verin-session") ?? (await cookies()).get("verin_session")?.value;
  const view = await getGateway().enterRouteConformance(c, async () => {
    const principal = await access.authenticate(c, cookieValue);
    if (!principal) return null;
    const grant = await access.authorize(c, principal, "conformance.read");
    return grant ? ("granted" as const) : ("denied" as const);
  });
  if (!view) redirect("/");
  if (view === "denied")
    return (
      <p className="alert" role="alert">
        {"Your role is not permitted to read the conformance register."}
      </p>
    );
  return (
    <section className="stack" data-testid="verin-conformance-loaded" aria-labelledby="conformance-heading">
      <h1 id="conformance-heading">The sixteen signed cases, graded in public</h1>
      <p className="meta">
        The decision engine re-derives every case from evidence and configuration alone, and every binding field is compared against the captain-signed expectation at oracle head{" "}
        {file.oracleHead.slice(0, 12)}. Three verdicts only: matched; differs, which is never absorbed - each carries the captain ruling that dispositions it, awaiting the signature sitting; or not
        yet producible, naming the prompt that lands the field. Totals: {file.totals.MATCHED} matched · {file.totals.DIFFERS} differ under {file.ledgerEntries} reconciliation-ledger rulings ·{" "}
        {file.totals["NOT-YET-PRODUCIBLE"]} not yet producible. This register renders the committed conformance file, regenerated and byte-compared on every build.
      </p>
      {file.cases.map((gc) => (
        <section key={gc.caseId} className="stack" aria-labelledby={`case-${gc.caseId}`}>
          <h2 id={`case-${gc.caseId}`} className="section-heading">
            {gc.caseId} - re-derived disposition: {gc.disposition}
          </h2>
          <p className="meta">{gc.parseCount} load-bearing quantities read from summary prose by asserted parses (typed fields pending the CD-4c re-signature).</p>
          <ul className="register" aria-label={`Field verdicts for ${gc.caseId}`}>
            {gc.verdicts.map((v) => (
              <li key={v.field} data-verdict={v.verdict}>
                <span>{v.field}</span>
                {v.verdict === "MATCHED" ? (
                  <span className="badge-band">matched</span>
                ) : v.verdict === "DIFFERS" ? (
                  <span className="badge-demo">differs · ruling {"ruling" in v && v.ruling ? v.ruling : "missing"}</span>
                ) : (
                  <span className="badge-demo">not yet producible · lands prompt {v.landingPrompt}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="meta">
        A differing field is a recorded fact about this build, not a defect ticket: the ruled differences (CD-4b explanation sets, CD-4c prose quantities, CD-4d's GC-10 key, CD-4e reservation
        ordering) change on the SIGNED side at the captain's sitting, never by editing signed bytes here.
      </p>
    </section>
  );
}
