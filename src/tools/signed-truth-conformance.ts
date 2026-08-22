// The signed-truth conformance runner (prompt 5, PR-5c-i) - distinct from src/tools/conformance.ts,
// which is prompt 3's evidence-retrieval port contract. Per case, per binding field, produced
// versus signed, through the recorded comparison vocabulary, with THREE-VALUED verdicts: MATCHED;
// DIFFERS, which MUST carry the captain ruling that dispositions it in the reconciliation ledger;
// or NOT-YET-PRODUCIBLE naming the landing prompt (execution-tail ledger events 6-7; verification
// state 9). The reconciliation ledger is asserted in BOTH directions: a listed difference that
// starts matching fails exactly as a new difference does - it cannot rot into an excuse. Nothing
// is smoothed to make the register look finished.
import { readFileSync, writeFileSync } from "node:fs";
import { evaluate, idempotencyKeyFor, outcomeDigest, type DecisionOutcome } from "../decision/outcome";
import { decisionCorrelation, decisionIdFromOutcomeDigest, getGateway, requestCorrelation, type RequestId } from "../runtime/governed";
import { SIGNED_CASE_SCOPE, loadSignedCaseInput, loadSignedCaseInputs } from "./signed-cases";
import { COMPARISON_VOCABULARY, loadSignedCaseExpectations, type SignedCaseExpectations } from "./signed-expectations";

type Ruling = "CD-4a" | "CD-4b" | "CD-4c" | "CD-4d" | "CD-4e";
type Verdict =
  | { field: string; verdict: "MATCHED" }
  | { field: string; verdict: "DIFFERS"; ruling: Ruling | null; signed: unknown; produced: unknown }
  | { field: string; verdict: "NOT-YET-PRODUCIBLE"; landingPrompt: 6 | 7 | 9 };
type CaseGrade = { caseId: string; disposition: DecisionOutcome["disposition"]; typedQuantityCount: number; verdicts: Verdict[] };
type LedgerEntry = { id: string; caseId: string; field: string; ruling: Ruling; note: string };

// The CD-4e plan-level comparator: the signed order violates the ruled reserve-only-after-authority
// rule exactly when an approval is recorded AFTER a reservation was created (GC-15's re-approval
// sequence conforms: its reservation follows the LAST approval; a refusal or never-armed tail
// conforms vacuously).
const signedOrderingViolation = (events: readonly { type: string }[]): boolean => {
  const firstReservation = events.findIndex((e) => e.type === "ReservationCreated");
  return firstReservation >= 0 && events.some((e, i) => e.type === "ApprovalRecorded" && i > firstReservation);
};

export function gradeCase(exp: SignedCaseExpectations, produced: DecisionOutcome, typedQuantityCount: number): CaseGrade {
  const v: Verdict[] = [];
  const eq = (field: string, signed: unknown, mine: unknown, ruling: Ruling | null = null) =>
    v.push(JSON.stringify(signed) === JSON.stringify(mine) ? { field, verdict: "MATCHED" } : { field, verdict: "DIFFERS", ruling, signed, produced: mine });
  const nyp = (field: string, landingPrompt: 6 | 7 | 9) => v.push({ field, verdict: "NOT-YET-PRODUCIBLE", landingPrompt });
  eq("disposition", exp.expectedDisposition, produced.disposition);
  eq("authority.mode", exp.expectedAuthority.mode, produced.disposition === "proceed" ? COMPARISON_VOCABULARY.authorityMode[produced.authority.mode] : "none");
  const stages = produced.disposition === "proceed" ? produced.authority.stages : [];
  eq("authority.stages.length", exp.expectedAuthority.stages.length, stages.length);
  exp.expectedAuthority.stages.forEach((s, i) => {
    const mine = stages[i];
    eq(
      `authority.stages[${i}]`,
      [s.stageId, s.order, s.eligibleRoleIds, s.approvalsRequired, s.distinctActorsRequired, s.requesterMayApprove],
      mine ? [COMPARISON_VOCABULARY.stageId[mine.stageId] ?? mine.stageId, mine.order, mine.eligibleRoleIds, mine.approvalsRequired, mine.distinctActorsRequired, mine.requesterMayApprove] : null,
    );
  });
  eq("contract-silence.eligibleApproverRole", exp.firmConfiguration.eligibleRole, COMPARISON_VOCABULARY.silence(produced.policyBasis.eligibleApproverRole));
  eq("contract-silence.requesterRule", exp.firmConfiguration.requesterConstraint, COMPARISON_VOCABULARY.silence(produced.policyBasis.requesterRule));
  eq("blockers.codes", [...(exp.blockers ?? []).map((b) => b.code)].sort(), produced.disposition === "blocked" ? [...produced.blockers.map((b) => b.code)].sort() : []);
  eq("prohibition.reasonCode", exp.prohibition?.reasonCode ?? null, produced.disposition === "prohibited" ? produced.prohibition.reasonCode : null);
  if (produced.disposition === "proceed") {
    if (exp.expectedExecutionEligibility.eligible) {
      v.push({ field: "execution.eligible", verdict: "MATCHED" }); // the signed true is the completed-approval tail of a plan this outcome carries
      eq("execution.idempotencyKey", exp.expectedExecutionEligibility.idempotencyKey, produced.execution.idempotencyKey, "CD-4d");
      eq(
        "execution.reservations",
        exp.expectedExecutionEligibility.reservations.map((r) => ({ ref: r.reservationId, conflictKeys: r.conflictKeys })),
        produced.execution.reservation ? [{ ref: produced.execution.reservation.reservationRef, conflictKeys: produced.execution.reservation.conflictKeys }] : [],
      );
    } else {
      nyp("execution.eligible", 7); // the signed false is an execution-tail state (an unresolved stage), not a plan property
      nyp("execution.idempotencyKey", 7);
      nyp("execution.reservations", 7);
    }
    nyp("verification.state", 9);
  } else {
    eq("execution.eligible", exp.expectedExecutionEligibility.eligible, false);
    eq("execution.idempotencyKey", exp.expectedExecutionEligibility.idempotencyKey, null);
    eq("verification.reached", exp.expectedVerificationState.reached, false);
  }
  eq(
    "ledger.reservationOrdering",
    signedOrderingViolation(exp.expectedLedgerEvents) ? "reserve-at-decision" : "reserve-only-after-authority-complete",
    "reserve-only-after-authority-complete",
    "CD-4e",
  );
  nyp("ledger.eventSequence", 6);
  eq("explanations.codes", [...exp.expectedExplanationNodes.map((e) => e.code)].sort(), [...produced.explanations.map((e) => e.code)].sort(), "CD-4b");
  if (typedQuantityCount > 0) v.push({ field: "inputs.typedQuantities", verdict: "MATCHED" });
  else
    v.push({
      field: "inputs.typedQuantities",
      verdict: "DIFFERS",
      ruling: "CD-4c",
      signed: "signed typed quantities are the authoritative input",
      produced: "zero signed typed quantities consumed",
    });
  return { caseId: exp.caseId, disposition: produced.disposition, typedQuantityCount, verdicts: v };
}

const expectationFor = (caseId: string) => {
  const exp = loadSignedCaseExpectations().find((e) => e.caseId === caseId);
  if (!exp) throw new Error(`${caseId} has inputs but no signed expectations; refusing`);
  return exp;
};
const finishGrade = (grade: CaseGrade): CaseGrade => {
  if (!grade.verdicts.some((x) => x.verdict !== "NOT-YET-PRODUCIBLE")) throw new Error(`${grade.caseId} produced no gradeable field at all; an all-deferred case is not graded (M-E)`);
  return grade;
};
const refuseEmptyScope = (n: number) => {
  if (n === 0) throw new Error("the conformance runner refuses zero cases: a run that grades nothing must never report clean (M-E)");
};

export function gradeAllCases(): CaseGrade[] {
  const inputs = loadSignedCaseInputs();
  refuseEmptyScope(inputs.length);
  return inputs.map(({ caseId, input, typedQuantityCount }) => finishGrade(gradeCase(expectationFor(caseId), evaluate(input), typedQuantityCount)));
}

// The GOVERNED run (registry rows conformance.runner / conformance.readSignedCase /
// conformance.grade): the same grader under the kernel's observability - each case's pin-verified
// oracle read is its own module-operation, each grade a flow-step under the DecisionCorrelation of
// the outcome it grades (the decision identity exists only after evaluate returns). The committed
// conformance file's cases are asserted EQUAL to this run's output in suite, so the two paths
// cannot drift apart.
export async function runConformance(requestId: RequestId): Promise<CaseGrade[]> {
  const gw = getGateway();
  const c = requestCorrelation(requestId);
  return gw.enterConformanceRunner(c, async () => {
    refuseEmptyScope(SIGNED_CASE_SCOPE.length);
    const grades: CaseGrade[] = [];
    for (const caseId of SIGNED_CASE_SCOPE) {
      const { input, typedQuantityCount } = await gw.enterConformanceReadSignedCase(c, async () => loadSignedCaseInput(caseId));
      const produced = evaluate(input);
      const dc = decisionCorrelation(requestId, decisionIdFromOutcomeDigest(outcomeDigest(produced)));
      grades.push(await gw.enterConformanceGrade(dc, async () => finishGrade(gradeCase(expectationFor(caseId), produced, typedQuantityCount))));
    }
    return grades;
  });
}

// The two-directional reconciliation (M-D): every DIFFERS must have exactly its ledger entry, every
// entry must correspond to a LIVE difference, and an entry with no captain ruling cannot exist.
export function reconcile(grades: CaseGrade[], ledger: LedgerEntry[]): string[] {
  const problems: string[] = [];
  const live = new Map<string, Extract<Verdict, { verdict: "DIFFERS" }>>();
  for (const g of grades) for (const x of g.verdicts) if (x.verdict === "DIFFERS") live.set(`${g.caseId}:${x.field}`, x);
  for (const [key, x] of live) {
    const entry = ledger.find((e) => e.id === key);
    if (!entry) problems.push(`unledgered difference ${key}: a new difference is recorded, never absorbed`);
    else if (!x.ruling || entry.ruling !== x.ruling) problems.push(`${key}: ledger ruling ${entry.ruling} does not match the runner's ${x.ruling ?? "(none)"}`);
  }
  for (const e of ledger) {
    if (!["CD-4a", "CD-4b", "CD-4c", "CD-4d", "CD-4e"].includes(e.ruling)) problems.push(`${e.id}: entry carries no captain ruling; the suite refuses it (stop 5)`);
    if (!live.has(e.id)) problems.push(`stale ledger entry ${e.id}: the listed difference now matches - it cannot rot into an excuse; delete it`);
  }
  return problems;
}

// The CD-4d grammar regression (M-J): every PRODUCED key conforms; among the SIGNED keys exactly
// the named pre-signature divergence may deviate, and after the pin moves the exceptions list must
// be empty for the test to keep passing.
export const KNOWN_KEY_DIVERGENCES_BEFORE_SIGNATURE: string[] = []; // emptied by the pin move (PR-5c-ii): GC-10's signed key converged at the captain's amendment; any future divergence fails M-J outright
export function keyGrammarViolations(): { produced: string[]; signedDivergent: string[] } {
  const inputs = loadSignedCaseInputs();
  const exps = loadSignedCaseExpectations();
  const produced: string[] = [];
  const signedDivergent: string[] = [];
  for (const { caseId, input } of inputs) {
    const grammarKey = idempotencyKeyFor(input.request);
    const exp = exps.find((e) => e.caseId === caseId)!;
    const signedKey = exp.expectedExecutionEligibility.idempotencyKey;
    if (exp.expectedExecutionEligibility.eligible && grammarKey === null) produced.push(`${caseId}: no grammar key derivable for an eligible case`);
    if (signedKey !== null && grammarKey !== null && signedKey !== grammarKey) signedDivergent.push(caseId);
  }
  return { produced, signedDivergent };
}

// The committed conformance file's generator (registered bucket-G artifact, regenerated and
// byte-compared in the blocking job). It REFUSES to emit while any difference is unledgered or any
// ledger entry is stale (M-D, both directions) - a conformance file that cannot be regenerated is
// hand-authored evidence, and this one is not.
export function conformanceFileBytes(): string {
  const grades = gradeAllCases();
  const ledger = JSON.parse(readFileSync("docs/decision-reconciliation-ledger.json", "utf8"));
  const problems = reconcile(grades, ledger);
  if (problems.length) throw new Error(`the conformance file cannot be emitted over an unreconciled ledger:\n${problems.join("\n")}`);
  const totals = { MATCHED: 0, DIFFERS: 0, "NOT-YET-PRODUCIBLE": 0 };
  for (const g of grades) for (const v of g.verdicts) totals[v.verdict] += 1;
  const oracleHead = JSON.parse(readFileSync("enforcement/signed-truth-pins.json", "utf8")).oracleHead;
  return JSON.stringify({ oracleHead, totals, ledgerEntries: ledger.length, cases: grades }, null, 2) + "\n";
}

if (process.argv[1]?.endsWith("signed-truth-conformance.ts")) {
  const bytes = conformanceFileBytes();
  if (process.argv[2] === "--print") process.stdout.write(bytes);
  else {
    writeFileSync("docs/evidence/decision-conformance.json", bytes);
    console.log("conformance file written");
  }
}
