// Two fixed sample DecisionInputs for the capability-denied determinism proofs (M-F, M-I), one per
// disposition the PR-5a-i rule set produces; every value is a committed demonstration constant
// (charter #3), and the signed-case reader replaces this scope in PR-5a-iii.
import { createHash } from "node:crypto";
import type { DecisionInput } from "../decision/outcome";
import type { EvidenceBundle } from "../evidence/bundle";
import { parseFirmPolicy } from "../policy/registry";

const POLICY_BYTES = `{"reserveHorizonMonths":6,"dualApproval":{"thresholdUsd":25000,"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"operations","requesterRule":"may-not-satisfy-both-approvals"},"bankInstructionChange":"specialist-review","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`;
const ASOF = "2026-08-21T14:00:00.000Z";
const hex32 = (seed: string) => createHash("sha256").update(seed).digest("hex").slice(0, 32);
const balance = (subject: string, body: Record<string, string>): EvidenceBundle["observations"][number] => ({
  id: `o${hex32(`sample|${subject}`)}`,
  kind: "account-balance",
  subject,
  body,
  provenance: { source: "house-record-store", observedAt: "2026-08-20T09:00:00.000Z", retrievedAt: ASOF },
  freshness: "fresh",
  pii: "masked-financial-reference",
  origin: "demo-seed",
});
const base = (request: DecisionInput["request"], observations: EvidenceBundle["observations"]): DecisionInput => ({
  request,
  evidenceBundle: {
    version: "evb.v1",
    vocabulary: "1.1.0",
    subject: { household: `h${hex32("sample|household")}` },
    asOf: ASOF,
    source: "house-record-store",
    observations,
    absences: [{ kind: "people", status: "not-observed", reason: "no-observation-in-house-records" }],
    conflicts: [],
  },
  policyDocument: { id: { version: "fpd.v1", digest: createHash("sha256").update(POLICY_BYTES).digest("hex") }, policy: parseFirmPolicy(new TextEncoder().encode(POLICY_BYTES)) },
  identities: { firm: `f${hex32("sample|firm")}`, household: `h${hex32("sample|household")}`, requesterRole: `r${hex32("sample|role")}` },
  asOf: ASOF,
});
export const SAMPLE_INPUTS: readonly { name: string; input: DecisionInput }[] = [
  // A proceed on the attested basis with a rejected retirement alternative, and a refusal on a
  // balance whose registration class was never observed.
  {
    name: "sample-proceed",
    input: base({ requestRef: "req:rsampleproceed01", householdSlug: "sample-household", amountUsd: 50_000, purpose: "home-renovation", deadline: "2026-12-31" }, [
      balance("account:sample-taxable", { AvailableUsd: "412000", RegistrationClass: "taxable", Sufficiency: "attested-sufficient" }),
      balance("account:sample-ira", { AvailableUsd: "610000", RegistrationClass: "retirement" }),
    ]),
  },
  {
    // A classified taxable figure WITHOUT attested sufficiency: the real engine refuses (no
    // schedule class exists yet), and a stubbed attestation check would wrongly proceed - which is
    // exactly what the M-C battery kills.
    name: "sample-blocked-unattested-reserve",
    input: base({ requestRef: "req:rsampleblocked01", householdSlug: "sample-household", amountUsd: 400_000, purpose: "property-closing", deadline: "2026-12-31" }, [
      balance("account:sample-taxable", { AvailableUsd: "412000", RegistrationClass: "taxable" }),
    ]),
  },
];
