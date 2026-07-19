/**
 * RBAC roles (ADR-0008). Enforced server-side at the port; never client-trusted.
 * Ordered by privilege via ROLE_RANK.
 */
export const ROLES = ["advisor", "ops", "cco", "principal", "admin"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  advisor: 1,
  ops: 2,
  cco: 3,
  principal: 4,
  admin: 5,
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** True if `role` is at least as privileged as `required`. */
export function hasAtLeastRole(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/** True if `role` is one of the explicitly allowed roles for an action. */
export function isAllowedRole(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}
