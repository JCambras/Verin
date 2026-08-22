import { createHash } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { Client as PgClient } from "pg";
import { createAccessContext, signIn } from "../access/context";
import { assembleEvidence } from "../evidence/bundle";
import { POLICY_OPERATION_DEADLINE_MS, createPolicyVersionRegistry } from "../policy/registry";
import { evaluate, outcomeDigest } from "../decision/outcome";
import { createDecisionRecord, resolveDecisionRecordHead } from "../record/decision-record";
import { createGovernedRuntime, decisionCorrelation, decisionIdFromOutcomeDigest, getGateway, mintRequestId, requestCorrelation } from "../runtime/governed";

const SUPER_URL = process.env.VERIN_SUPER_DATABASE_URL?.replace(/\/postgres$/, "/verin") ?? "postgresql://postgres:postgres@localhost:5432/verin";
const POLICY_BYTES = new TextEncoder().encode(
  `{"reserveHorizonMonths":6,"dualApproval":{"thresholdUsd":25000,"approvalsRequired":2,"distinctActorsRequired":true,"eligibleApproverRole":"operations","requesterRule":"may-not-satisfy-both-approvals"},"bankInstructionChange":"specialist-review","approvalStages":"not-stated","reservationWindowDays":"not-stated"}`,
);

async function superQuery(sql: string, params: unknown[] = []) {
  const client = new PgClient({ connectionString: SUPER_URL });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function resetRecordFixture() {
  for (const table of ["decision_continuity_authorization", "decision_record_source", "decision_ledger"]) await superQuery(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  try {
    for (const table of ["decision_record_projection", "decision_ledger", "decision_record_source", "decision_chain_anchor", "decision_continuity_authorization"])
      await superQuery(`DELETE FROM ${table}`);
  } finally {
    for (const table of ["decision_continuity_authorization", "decision_record_source", "decision_ledger"]) await superQuery(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  }
}

beforeAll(() => createGovernedRuntime("tooling"));

it("the independent public verifier refuses a known-damaged chain", async () => {
  const session = await signIn(requestCorrelation(mintRequestId()), "advisor@firm-a.example", "meridian-slate-88");
  if (!session) throw new Error("the verifier fixture requires the seeded Firm A advisor");
  const access = createAccessContext();
  const authCorrelation = requestCorrelation(mintRequestId());
  const principal = await access.authenticate(authCorrelation, session.cookieValue);
  if (!principal) throw new Error("the verifier fixture could not resolve its seeded advisor");
  await resetRecordFixture();
  const now = new Date().toISOString();
  await superQuery(
    "INSERT INTO decision_continuity_authorization (org_id, lcm_digest, manifest_bytes, signature_bytes, authorizing_actor, authorized_at, producer_kind, producer_id, produced_at, record_origin) VALUES ($1, $2, $3, $4, 'test-fixture', $5, 'test', 'verifier-companion', $5, 'test-fixture')",
    [principal.tenant.orgId, `lcm.v1:${"3".repeat(64)}`, Buffer.from("test-only-verifier-continuity"), Buffer.from("test-only-not-a-product-signature"), now],
  );

  const requestId = mintRequestId();
  const c = requestCorrelation(requestId);
  const recorded = await getGateway().enterRouteDecision(c, async () => {
    const grant = await access.authorize(c, principal, "decision.evaluate");
    const policyGrant = await access.authorize(c, principal, "policy.read");
    const recordGrant = await access.authorize(c, principal, "decision.record");
    if (!grant || !policyGrant || !recordGrant) throw new Error("the verifier fixture requires evaluate, policy.read and decision.record grants");
    const household = await access.withTenant(c, grant, async (tx) => (await tx.listHouseholds()).find((row) => row.name === "Henderson Family"));
    if (!household) throw new Error("the verifier fixture requires the seeded Henderson household");
    const digest = createHash("sha256").update(POLICY_BYTES).digest("hex");
    const policy = await createPolicyVersionRegistry().resolveByHash(c, policyGrant, { version: "fpd.v1", digest }, { milliseconds: POLICY_OPERATION_DEADLINE_MS });
    if (policy.kind !== "policy-version") throw new Error("the verifier fixture requires Firm A's seeded policy version");
    const evidence = await assembleEvidence(c, grant, { householdId: household.id }, now, { milliseconds: 2_000 });
    const outcome = evaluate({
      request: { requestRef: "req:rverifierjaw001", householdSlug: "henderson-family", amountUsd: 72_001, purpose: "home-renovation", deadline: "2026-12-31" },
      evidenceBundle: evidence,
      policyDocument: { id: policy.id, policy: policy.policy },
      identities: {
        firm: `f${principal.tenant.orgId.replaceAll("-", "")}`,
        household: `h${household.id.replaceAll("-", "")}`,
        requesterRole: `r${createHash("sha256").update("role|advisor").digest("hex").slice(0, 32)}`,
      },
      asOf: now,
    });
    const dc = decisionCorrelation(requestId, decisionIdFromOutcomeDigest(outcomeDigest(outcome)));
    await getGateway().enterDecisionRenderOutcome(dc, async () => null);
    return createDecisionRecord(dc, recordGrant).record({
      outcome,
      evidence,
      policy,
      recordedAt: now,
      producer: { kind: "test", id: "verifier-companion", producedAt: now },
      recordOrigin: "test-fixture",
    });
  });
  expect(recorded.sequence).toBe(1);

  const saved = (await superQuery("SELECT envelope_bytes FROM decision_ledger WHERE org_id = $1 AND seq = 1", [principal.tenant.orgId])).rows[0] as { envelope_bytes: Uint8Array };
  await superQuery("ALTER TABLE decision_ledger DISABLE TRIGGER decision_ledger_immutable");
  try {
    await superQuery("UPDATE decision_ledger SET envelope_bytes = set_byte(envelope_bytes, octet_length(envelope_bytes) - 1, 123) WHERE org_id = $1 AND seq = 1", [principal.tenant.orgId]);
    const verifyRequestId = mintRequestId();
    const verifyCorrelation = requestCorrelation(verifyRequestId);
    const verification = await getGateway().enterRouteDecisionChainVerify(verifyCorrelation, async () => {
      const readGrant = await access.authorize(verifyCorrelation, principal, "decision.read");
      if (!readGrant) throw new Error("the verifier fixture requires a decision.read grant");
      const head = await resolveDecisionRecordHead(verifyCorrelation, readGrant);
      if (head.kind === "refused") throw new Error(`the verifier fixture could not resolve its damaged head: ${head.failure}`);
      const dc = decisionCorrelation(verifyRequestId, decisionIdFromOutcomeDigest(head.outcomeIdentity));
      return createDecisionRecord(dc, readGrant).verify();
    });
    expect(verification).toEqual({ ok: false, failure: "payload-rewritten", sequence: 1 });
  } finally {
    await superQuery("UPDATE decision_ledger SET envelope_bytes = $2 WHERE org_id = $1 AND seq = 1", [principal.tenant.orgId, saved.envelope_bytes]);
    await superQuery("ALTER TABLE decision_ledger ENABLE TRIGGER decision_ledger_immutable");
  }
});
