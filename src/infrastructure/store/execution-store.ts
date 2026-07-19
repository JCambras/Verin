/**
 * ExecutionStore adapter (ADR-0011). Persists flow continuations in
 * flow_executions so a suspended flow survives across requests/process restarts —
 * the app tier stays stateless (charter #16).
 */
import type { SqlDb } from "./db";
import type { ExecutionState, ExecutionStore } from "@domain/workflow/engine";

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

export function makeExecutionStore(db: SqlDb): ExecutionStore {
  return {
    async create(state) {
      const now = new Date().toISOString();
      await db.query(
        "INSERT INTO flow_executions (id,org_id,flow_id,status,resume_token,context_json,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)",
        [state.id, state.orgId, state.flowId, state.status, state.resumeToken, JSON.stringify({ cursor: state.cursor, data: state.data }), now],
      );
    },
    async save(state) {
      await db.query(
        "UPDATE flow_executions SET status=$2, resume_token=$3, context_json=$4, updated_at=$5 WHERE id=$1",
        [state.id, state.status, state.resumeToken, JSON.stringify({ cursor: state.cursor, data: state.data }), new Date().toISOString()],
      );
    },
    async loadById(id) {
      const res = await db.query<Row>("SELECT * FROM flow_executions WHERE id = $1", [id]);
      return res.rows[0] ? toState(res.rows[0]) : null;
    },
    async loadByToken(token) {
      const res = await db.query<Row>("SELECT * FROM flow_executions WHERE resume_token = $1", [token]);
      return res.rows[0] ? toState(res.rows[0]) : null;
    },
  };
}
