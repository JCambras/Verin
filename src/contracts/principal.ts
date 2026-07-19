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
