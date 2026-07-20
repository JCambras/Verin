/**
 * RBAC roles (ADR-0008). Enforced server-side at the port; never client-trusted.
 * Listed in ascending order of privilege. Authorization checks use explicit
 * allowlists (isAllowedRole), never a rank comparison — a rank helper existed and
 * was pruned unused (D-028): every real check names its allowed roles.
 */
export const ROLES = ["advisor", "ops", "cco", "principal", "admin"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** True if `role` is one of the explicitly allowed roles for an action. */
export function isAllowedRole(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}
