/**
 * The authenticated principal (ADR-0008). Resolved server-side from the session
 * ONLY (never from a client-supplied header). `actor` is the audit attribution
 * (the user's email), threaded into every audited write — never "system".
 */
import type { Role } from "./roles";

export interface Principal {
  readonly userId: string;
  readonly orgId: string;
  readonly role: Role;
  readonly actor: string;
  readonly sessionId: string;
}
