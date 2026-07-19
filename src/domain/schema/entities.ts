/**
 * Canonical entities (ADR-0005, charter #2). Modeled ONLY to what the walking
 * skeleton (account opening) + the house-CRM console need — no speculative fields;
 * the schema extends flow-by-flow under the provenance-required fence.
 *
 * Every entity carries record-level `provenance` (source/asOf/confidence). Field
 * types, nullability, units, and per-field provenance policy are declared in
 * dictionary.ts; the provenance-required fence fails the build if the two drift.
 */
import type { Role } from "@contracts/roles";
import type { RecordProvenance } from "@contracts/provenance";

export type EntityId = string;
export type IsoTimestamp = string;

export type UserStatus = "active" | "disabled";
export type HouseholdStatus = "prospect" | "active" | "inactive";
export const ACCOUNT_TYPES = [
  "individual",
  "joint",
  "ira-traditional",
  "ira-roth",
  "rollover-ira",
  "trust",
  "entity",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Server-side guard: client-supplied account types must be in the canonical set. */
export function isAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && (ACCOUNT_TYPES as readonly string[]).includes(value);
}
export type FinancialAccountStatus = "pending" | "open" | "closed";
export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "awaiting-signature"
  | "signed"
  | "completed"
  | "failed";
export type TaskStatus = "not-started" | "in-progress" | "completed";

export interface Org {
  readonly id: EntityId;
  readonly name: string;
  readonly createdAt: IsoTimestamp;
  readonly provenance: RecordProvenance;
}

export interface User {
  readonly id: EntityId;
  readonly orgId: EntityId;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly status: UserStatus;
  readonly createdAt: IsoTimestamp;
  readonly provenance: RecordProvenance;
}

export interface Session {
  readonly id: EntityId;
  readonly userId: EntityId;
  readonly orgId: EntityId;
  readonly role: Role;
  readonly createdAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly revokedAt: IsoTimestamp | null;
  readonly provenance: RecordProvenance;
}

export interface Household {
  readonly id: EntityId;
  readonly orgId: EntityId;
  readonly name: string;
  readonly primaryContactId: EntityId | null;
  readonly advisorUserId: EntityId | null;
  readonly status: HouseholdStatus;
  readonly createdAt: IsoTimestamp;
  readonly provenance: RecordProvenance;
}

export interface Contact {
  readonly id: EntityId;
  readonly orgId: EntityId;
  readonly householdId: EntityId;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly createdAt: IsoTimestamp;
  readonly provenance: RecordProvenance;
}

export interface FinancialAccount {
  readonly id: EntityId;
  readonly orgId: EntityId;
  readonly householdId: EntityId;
  readonly accountType: AccountType;
  readonly custodian: string | null;
  readonly balanceMinorUnits: number | null;
  readonly currency: string;
  readonly status: FinancialAccountStatus;
  readonly openDate: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly provenance: RecordProvenance;
}

export interface AccountOpeningApplication {
  readonly id: EntityId;
  readonly orgId: EntityId;
  readonly householdId: EntityId;
  readonly contactId: EntityId;
  readonly accountType: AccountType;
  readonly status: ApplicationStatus;
  readonly esignToken: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly provenance: RecordProvenance;
}

export interface Task {
  readonly id: EntityId;
  readonly orgId: EntityId;
  readonly householdId: EntityId | null;
  readonly subject: string;
  readonly status: TaskStatus;
  readonly dueDate: IsoTimestamp | null;
  readonly assigneeUserId: EntityId | null;
  readonly createdAt: IsoTimestamp;
  readonly provenance: RecordProvenance;
}

export interface AuditEntry {
  readonly id: EntityId;
  readonly orgId: EntityId;
  readonly sequence: number;
  readonly actor: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: EntityId | null;
  readonly beforeJson: string | null;
  readonly afterJson: string | null;
  readonly detail: string;
  readonly createdAt: IsoTimestamp;
  readonly prevHash: string;
  readonly entryHash: string;
  readonly provenance: RecordProvenance;
}

/** The entity names the dictionary + fence iterate. Keep in sync with the interfaces. */
export const ENTITY_NAMES = [
  "Org",
  "User",
  "Session",
  "Household",
  "Contact",
  "FinancialAccount",
  "AccountOpeningApplication",
  "Task",
  "AuditEntry",
] as const;
export type EntityName = (typeof ENTITY_NAMES)[number];
