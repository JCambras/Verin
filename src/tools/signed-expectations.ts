// The typed signed-case EXPECTATIONS reader (prompt 5, PR-5a scope) - the answer key's ONLY home.
// This module is structurally excluded from the decision module's closure (DecisionPureClosure
// fails the build if src/decision/** ever reaches it), so evaluate() cannot peek: signed cases
// supply inputs through src/tools/signed-cases.ts and expectations through here, two separate
// modules by design. The COMPARISON VOCABULARY below is the recorded one-to-one mapping (m13/A13):
// binding-field comparison is exact-string against the SIGNED spellings through it, never fuzzy -
// the signed truth writes specialist_review and ops-dual-approval; the product writes hyphenated
// full words; each pair is listed once, and a spelling outside the map compares as itself.
import { z } from "zod";
import type { DecisionOutcome } from "../decision/outcome";
import { SIGNED_CASE_SCOPE, readSignedBytes } from "./signed-cases";

const stage = z.object({
  stageId: z.string(),
  order: z.number().int(),
  eligibleRoleIds: z.array(z.string()),
  approvalsRequired: z.number().int(),
  distinctActorsRequired: z.boolean(),
  requesterMayApprove: z.boolean(),
});
const expectationFields = z.object({
  caseId: z.string(),
  firmConfiguration: z.object({ eligibleRole: z.string().nullable(), requesterConstraint: z.string().nullable() }),
  expectedDisposition: z.enum(["proceed", "blocked", "prohibited"]),
  expectedAuthority: z.object({ mode: z.enum(["automatic", "approval", "specialist_review", "none"]), stages: z.array(stage) }),
  expectedExecutionEligibility: z.object({
    eligible: z.boolean(),
    idempotencyKey: z.string().nullable(),
    reservations: z.array(z.object({ reservationId: z.string(), conflictKeys: z.array(z.string()) })),
  }),
  blockers: z.array(z.object({ code: z.string() })).optional(),
  prohibition: z.object({ reasonCode: z.string() }).optional(),
  expectedExplanationNodes: z.array(z.object({ code: z.string() })),
  expectedLedgerEvents: z.array(z.object({ type: z.string() })),
  expectedVerificationState: z.object({ reached: z.boolean() }),
});
export type SignedCaseExpectations = z.infer<typeof expectationFields>;

export const COMPARISON_VOCABULARY = {
  // product spelling -> signed spelling; every entry is one-to-one and recorded here alone
  authorityMode: { automatic: "automatic", approval: "approval", "specialist-review": "specialist_review", none: "none" } as Readonly<Record<string, string>>,
  stageId: { "operations-dual-approval": "ops-dual-approval", "bank-change-specialist-review": "bank-change-specialist-review" } as Readonly<Record<string, string>>,
  // the two contract silences (CD-4a): the product's typed "not-stated" answers the signed null
  silence: (produced: string): string | null => (produced === "not-stated" ? null : produced),
};

export function loadSignedCaseExpectations(): SignedCaseExpectations[] {
  return SIGNED_CASE_SCOPE.map((caseId) => {
    const parsed = expectationFields.parse(JSON.parse(readSignedBytes(`fixtures/golden/${caseId}.json`).toString("utf8")));
    if (parsed.caseId !== caseId) throw new Error(`fixture ${caseId} names itself '${parsed.caseId}'; refusing`);
    return parsed;
  });
}

// The producible binding fields of CD-4a, compared exactly through the vocabulary above. Fields
// whose producers are later prompts (the eligible flag and idempotency key of a proceed case whose
// signed eligibility is an execution-tail state, the verification state of a reached case, the
// ledger event tail) belong to PR-5c's three-valued runner, not to this exact matcher.
export function compareProducibleBindingFields(exp: SignedCaseExpectations, produced: DecisionOutcome): string[] {
  const out: string[] = [];
  const differs = (field: string, signed: unknown, mine: unknown) => {
    if (JSON.stringify(signed) !== JSON.stringify(mine)) out.push(`${field}: signed ${JSON.stringify(signed)}, produced ${JSON.stringify(mine)}`);
  };
  differs("disposition", exp.expectedDisposition, produced.disposition);
  const producedMode = produced.disposition === "proceed" ? COMPARISON_VOCABULARY.authorityMode[produced.authority.mode] : "none";
  differs("authority.mode", exp.expectedAuthority.mode, producedMode);
  const producedStages = produced.disposition === "proceed" ? produced.authority.stages : [];
  differs("authority.stages.length", exp.expectedAuthority.stages.length, producedStages.length);
  exp.expectedAuthority.stages.forEach((s, i) => {
    const mine = producedStages[i];
    if (!mine) return;
    differs(`stages[${i}].stageId`, s.stageId, COMPARISON_VOCABULARY.stageId[mine.stageId] ?? mine.stageId);
    differs(`stages[${i}].order`, s.order, mine.order);
    differs(`stages[${i}].eligibleRoleIds`, s.eligibleRoleIds, mine.eligibleRoleIds);
    differs(`stages[${i}].approvalsRequired`, s.approvalsRequired, mine.approvalsRequired);
    differs(`stages[${i}].distinctActorsRequired`, s.distinctActorsRequired, mine.distinctActorsRequired);
    differs(`stages[${i}].requesterMayApprove`, s.requesterMayApprove, mine.requesterMayApprove);
  });
  differs("contract-silence.eligibleApproverRole", exp.firmConfiguration.eligibleRole, COMPARISON_VOCABULARY.silence(produced.policyBasis.eligibleApproverRole));
  differs("contract-silence.requesterRule", exp.firmConfiguration.requesterConstraint, COMPARISON_VOCABULARY.silence(produced.policyBasis.requesterRule));
  differs("blockers.codes", [...(exp.blockers ?? []).map((b) => b.code)].sort(), produced.disposition === "blocked" ? [...produced.blockers.map((b) => b.code)].sort() : []);
  differs("prohibition.reasonCode", exp.prohibition?.reasonCode ?? null, produced.disposition === "prohibited" ? produced.prohibition.reasonCode : null);
  if (produced.disposition === "proceed" && exp.expectedExecutionEligibility.eligible) {
    differs("execution.idempotencyKey", exp.expectedExecutionEligibility.idempotencyKey, produced.execution.idempotencyKey);
    differs(
      "execution.reservation",
      exp.expectedExecutionEligibility.reservations.map((r) => ({ ref: r.reservationId, conflictKeys: r.conflictKeys })),
      produced.execution.reservation ? [{ ref: produced.execution.reservation.reservationRef, conflictKeys: produced.execution.reservation.conflictKeys }] : [],
    );
  }
  if (produced.disposition !== "proceed") {
    differs("execution.eligible", exp.expectedExecutionEligibility.eligible, false);
    differs("execution.idempotencyKey", exp.expectedExecutionEligibility.idempotencyKey, null);
    differs("verification.reached", exp.expectedVerificationState.reached, false);
  }
  return out;
}
