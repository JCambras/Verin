/**
 * ExecutionStore adapter (ADR-0011). Persists flow continuations in
 * flow_executions so a suspended flow survives across requests/process restarts —
 * the app tier stays stateless (charter #16). Calls carry sealed TenantContext
 * or `pii.view` grant authority, and every id-keyed statement filters on org_id,
 * so cross-tenant reads are impossible through this interface. loadByToken is
 * the one capability-keyed escape: the unguessable resume token scopes the row,
 * and resumeFlow validates the caller context before loading, then re-checks
 * organization ownership before execution.
 */
import type { SqlDb } from "./db";
import type { ExecutionState, ExecutionStore } from "@domain/workflow/engine";
import { assertTenantContext, type TenantContext } from "@contracts/tenant";
import { assertActionGrant } from "@contracts/authz";
import { appError } from "@contracts/errors";

interface Row {
  id: string;
  org_id: string;
  flow_id: string;
  status: ExecutionState["status"];
  resume_token: string | null;
  context_json: string;
}

function toState(r: Row): ExecutionState {
  const ctx = JSON.parse(r.context_json) as { cursor: number; data: Record<string, unknown> };
  return { id: r.id, orgId: r.org_id, flowId: r.flow_id, status: r.status, resumeToken: r.resume_token, cursor: ctx.cursor, data: ctx.data };
}

/** A state whose orgId disagrees with the tenant is a wiring bug — refuse to persist it. */
function assertStateInTenant(state: ExecutionState, tenant: TenantContext): void {
  if (state.orgId !== tenant.orgId) {
    throw appError("INTERNAL", "Execution state org does not match the tenant context.");
  }
}

export function makeExecutionStore(db: SqlDb): ExecutionStore {
  return {
    async create(state, tenant) {
      assertTenantContext(tenant);
      assertStateInTenant(state, tenant);
      const now = new Date().toISOString();
      await db.query(
        "INSERT INTO flow_executions (id,org_id,flow_id,status,resume_token,context_json,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)",
        [state.id, state.orgId, state.flowId, state.status, state.resumeToken, JSON.stringify({ cursor: state.cursor, data: state.data }), now],
      );
    },
    async save(state, tenant) {
      assertTenantContext(tenant);
      assertStateInTenant(state, tenant);
      await db.query(
        "UPDATE flow_executions SET status=$2, resume_token=$3, context_json=$4, updated_at=$5 WHERE id=$1 AND org_id=$6",
        [state.id, state.status, state.resumeToken, JSON.stringify({ cursor: state.cursor, data: state.data }), new Date().toISOString(), tenant.orgId],
      );
    },
    async loadById(id, grant) {
      assertActionGrant(grant, "pii.view");
      const res = await db.query<Row>("SELECT * FROM flow_executions WHERE id = $1 AND org_id = $2", [id, grant.tenant.orgId]);
      return res.rows[0] ? toState(res.rows[0]) : null;
    },
    async loadByToken(token) {
      const res = await db.query<Row>("SELECT * FROM flow_executions WHERE resume_token = $1", [token]);
      return res.rows[0] ? toState(res.rows[0]) : null;
    },
  };
}
