// The PolicyVersionRegistry seam (prompt 4 section 4). The address IS the document's SHA-256
// (`fpd.v1:` from the first byte - the `semfx.v1`/`evb.v1` precedent); there is NO current-bytes
// read path anywhere, a missing identity is a typed NotFound carrying no policy field at all, the
// firm is the grant's sealed tenant identity (never a parameter; RLS is the guarantee), and stored
// bytes are re-hashed BEFORE parsing, refusing on mismatch naming both digests. Every string field
// is a closed vocabulary; matrix silence is the typed "not-stated" (captain ratification
// 2026-08-21). PR-4a of the restack ships publish and resolveByHash; the rest is PR-4b.
import { createHash } from "node:crypto";
import { z } from "zod";
import { annotateOperation, getGateway, type RequestCorrelation } from "../runtime/governed";
import type { ActionGrant } from "../access/context";

type Instant = string; // ISO-8601 UTC, minted at the route boundary
type Deadline = { readonly milliseconds: number };
type PolicyVersionId = { readonly version: "fpd.v1"; readonly digest: string };
type PolicyRefusalReason = "version-not-found";
// The typed refusal: no policy field at all - not an empty policy, not a default (M-C).
type PolicyNotFound = { readonly kind: "not-found"; readonly reason: PolicyRefusalReason; readonly subject: string };
type PublishedPolicyVersion = {
  readonly kind: "policy-version";
  readonly id: PolicyVersionId;
  readonly sequence: number;
  readonly publishedAt: Instant;
  readonly origin: PolicyRecordOrigin;
  readonly policy: FirmPolicy;
};

// The closed vocabularies (deliverable 2): exactly what the ratified matrix and demo contract name;
// widening one is a reviewed schema change.
const NOT_STATED = "not-stated";
const APPROVER_ROLES = ["operations"] as const;
const REQUESTER_RULES = ["may-not-satisfy-both-approvals"] as const;
const BANK_INSTRUCTION_HANDLING = ["specialist-review", "block-until-independently-verified"] as const;
const STAGE_KINDS = ["dual-approval", "specialist-review", "independent-verification"] as const;
const POLICY_RECORD_ORIGINS = ["demo-seed", "operator-entry"] as const;
type PolicyRecordOrigin = (typeof POLICY_RECORD_ORIGINS)[number];
const notStatedOr = <T extends z.ZodType>(schema: T) => z.union([z.literal(NOT_STATED), schema]);
// The stage shape comes from configuration, never from a signed expected outcome (stop 4); no stage
// values exist in the matrix, so slice-4 documents carry "not-stated" whole until real ones arrive.
const approvalStage = z.strictObject({
  kind: z.enum(STAGE_KINDS),
  order: z.number().int().min(1).max(8),
  parallel: z.boolean(),
  expiryDays: notStatedOr(z.number().int().min(1).max(365)),
  escalation: notStatedOr(z.enum(STAGE_KINDS)),
});
const firmPolicySchema = z.strictObject({
  reserveHorizonMonths: z.number().int().min(1).max(120),
  dualApproval: z.strictObject({
    thresholdUsd: z.number().int().min(1).max(1_000_000_000),
    approvalsRequired: z.number().int().min(1).max(10),
    distinctActorsRequired: z.boolean(),
    eligibleApproverRole: notStatedOr(z.enum(APPROVER_ROLES)),
    requesterRule: notStatedOr(z.enum(REQUESTER_RULES)),
  }),
  bankInstructionChange: z.enum(BANK_INSTRUCTION_HANDLING),
  approvalStages: notStatedOr(z.array(approvalStage).min(1).max(8)),
  reservationWindowDays: notStatedOr(z.number().int().min(1).max(365)),
});
type FirmPolicy = z.infer<typeof firmPolicySchema>;

// Strict boundary parsing (M-F): invalid UTF-8, non-JSON bytes, an unknown key, a value outside a
// closed vocabulary, or anything shaped like an expression is refused naming the offending path.
function parseFirmPolicy(bytes: Uint8Array): FirmPolicy {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (e) {
    throw new Error(`the firm policy parser refuses bytes that are not UTF-8 JSON: ${(e as Error).message}`);
  }
  const parsed = firmPolicySchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.length ? first.path.join(".") : "(document root)";
    throw new Error(`the firm policy parser refuses '${path}': ${first.message}`);
  }
  return parsed.data;
}

const sha256hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const renderPolicyVersionId = (id: PolicyVersionId) => `${id.version}:${id.digest}`;
const parsePolicyVersionId = (text: string): PolicyVersionId | null => {
  const m = /^fpd\.v1:([0-9a-f]{64})$/.exec(text);
  return m ? { version: "fpd.v1", digest: m[1] } : null;
};
// The deadline constant this slice owns; the route boundary mints from it exactly once (stop 9).
const POLICY_OPERATION_DEADLINE_MS = 2_000;
const requireDeadline = (deadline: Deadline, op: string) => {
  if (!Number.isInteger(deadline?.milliseconds) || deadline.milliseconds <= 0) throw new Error(`${op} accepts no call without a usable deadline; the route boundary mints it (stop 9)`);
};
const requireAction = (grant: ActionGrant, action: "policy.read" | "policy.publish", op: string) => {
  if (grant.action !== action) throw new Error(`${op} requires a '${action}' grant; a '${grant.action}' grant does not authorize it`);
};
const originInVocabulary = (value: string): PolicyRecordOrigin => {
  if (!(POLICY_RECORD_ORIGINS as readonly string[]).includes(value)) throw new Error(`the policy registry refuses a stored record origin '${value}' outside its closed vocabulary`);
  return value as PolicyRecordOrigin;
};
const versionRow = z.strictObject({ seq: z.number().int(), published_at: z.date(), bytes: z.instanceof(Uint8Array), record_origin: z.string() });

interface PolicyVersionRegistry {
  publish(c: RequestCorrelation, grant: ActionGrant, bytes: Uint8Array, deadline: Deadline): Promise<PolicyVersionId>;
  resolveByHash(c: RequestCorrelation, grant: ActionGrant, id: PolicyVersionId, deadline: Deadline): Promise<PublishedPolicyVersion | PolicyNotFound>;
}

function createPolicyVersionRegistry(): PolicyVersionRegistry {
  const gw = getGateway();
  return {
    async publish(c, grant, bytes, deadline) {
      return gw.enterPolicyPublish(c, async () => {
        requireDeadline(deadline, "policy.publish");
        requireAction(grant, "policy.publish", "policy.publish");
        parseFirmPolicy(bytes); // refused before any store work (M-F)
        const digest = sha256hex(bytes);
        annotateOperation({ documentDigest: digest });
        // One idempotency-aware write binds the version to the grant's own firm, naming the origin at
        // the insert (tooling publishes are demonstrations); zero rows written is a refused duplicate.
        const wrote = await gw.enterPolicyAppendVersion(c, {
          orgId: grant.principal.tenant.orgId,
          digest,
          bytes,
          recordOrigin: gw.runtimeRole === "web" ? "operator-entry" : "demo-seed",
          statementTimeoutMs: String(deadline.milliseconds),
        });
        if (wrote !== 1) throw new Error(`publish refuses a duplicate identity: fpd.v1:${digest} is already in this firm's sequence (no duplicate identities)`);
        return { version: "fpd.v1", digest };
      });
    },
    async resolveByHash(c, grant, id, deadline) {
      return gw.enterPolicyResolveByHash(c, async () => {
        requireDeadline(deadline, "policy.resolveByHash");
        requireAction(grant, "policy.read", "policy.resolveByHash");
        annotateOperation({ documentDigest: id.digest });
        const raw = await gw.enterPolicyDocumentByDigest(c, { orgId: grant.principal.tenant.orgId, digest: id.digest, statementTimeoutMs: String(deadline.milliseconds) });
        if (raw === null) {
          annotateOperation({ outcome: "refused", refusalReason: "version-not-found" });
          return { kind: "not-found", reason: "version-not-found", subject: renderPolicyVersionId(id) };
        }
        const row = versionRow.parse(raw);
        // Verification before parse (rule 2): not one byte of a tampered document is parsed.
        const stored = sha256hex(row.bytes);
        if (stored !== id.digest)
          throw new Error(`refusing to parse ${renderPolicyVersionId(id)}: the version's bytes were edited in place (declared digest ${id.digest}, stored bytes digest ${stored})`);
        return { kind: "policy-version", id, sequence: row.seq, publishedAt: row.published_at.toISOString(), origin: originInVocabulary(row.record_origin), policy: parseFirmPolicy(row.bytes) };
      });
    },
  };
}

export type { Deadline, FirmPolicy, Instant, PolicyNotFound, PolicyRecordOrigin, PolicyVersionId, PolicyVersionRegistry, PublishedPolicyVersion };
export { NOT_STATED, POLICY_OPERATION_DEADLINE_MS, POLICY_RECORD_ORIGINS, createPolicyVersionRegistry, parseFirmPolicy, parsePolicyVersionId, renderPolicyVersionId };
