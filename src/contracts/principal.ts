/**
 * The authenticated principal (ADR-0008). Resolved server-side from the session
 * ONLY (never from a client-supplied header). Audit and OTel-span attribution is
 * the opaque `userId` (ADR-0006/0007: those boundaries never see raw PII), threaded
 * into every audited write — never "system". `actor` is the user's email for
 * DISPLAY surfaces only (nav, /api/me); views resolve userId → email at render.
 */
import type { Role } from "./roles";

export interface Principal {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly actor: string;
  readonly sessionId: string;
}

/**
 * The narrow identity a CRM/store WRITE is attributed to: which org, which actor
 * (an opaque userId, or a reserved system-actor id like "esign-webhook"/"seed").
 * Adapters accept this instead of a full Principal so event-driven paths (webhook
 * finalize, seeds) never fabricate a Principal with an invented role/sessionId —
 * a forged credential the day port-level role checks land. RBAC stays at the
 * route/port boundary on the full session Principal; a session-derived write
 * actor is built via writeActorOf.
 */
export interface WriteActor {
  readonly orgId: string;
  readonly actorUserId: string;
}

export function writeActorOf(p: Principal): WriteActor {
  return { orgId: p.orgId, actorUserId: p.userId };
}
