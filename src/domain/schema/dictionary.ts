/**
 * DATA DICTIONARY (ADR-0005, charter #2). Every modeled field's type,
 * nullability, unit, and provenance policy. The provenance-required fence fails
 * the build if any entity interface field is missing here, or vice versa (drift
 * both ways). The no-unlabeled-synthetic fence fails if a synthetic-sourced field
 * is allowed to feed a compliance decision (charter #3).
 *
 * The `provenance` meta-field on each entity is record-level provenance, not a
 * data field, so it is intentionally NOT listed here (the fence excludes it).
 */
import type { SourceSystem, SurvivorshipRule } from "@contracts/provenance";
import type { EntityName } from "./entities";

export interface FieldProvenancePolicy {
  readonly defaultSource: SourceSystem;
  readonly survivorship: SurvivorshipRule;
  readonly canFeedCompliance: boolean;
  readonly note?: string;
}

export interface FieldSpec {
  readonly type: string;
  readonly nullable: boolean;
  readonly unit?: string;
  readonly provenance: FieldProvenancePolicy;
}

// Provenance presets.
const SYS: FieldProvenancePolicy = { defaultSource: "verin-crm", survivorship: "source-precedence", canFeedCompliance: true };
const USER: FieldProvenancePolicy = { defaultSource: "user-input", survivorship: "most-recent", canFeedCompliance: true };
const MONEY: FieldProvenancePolicy = { defaultSource: "verin-crm", survivorship: "most-recent", canFeedCompliance: true };

const s = (type: string, nullable: boolean, provenance: FieldProvenancePolicy, unit?: string): FieldSpec =>
  unit ? { type, nullable, unit, provenance } : { type, nullable, provenance };

export const DATA_DICTIONARY: Record<EntityName, Record<string, FieldSpec>> = {
  Org: {
    id: s("EntityId", false, SYS),
    name: s("string", false, USER),
    createdAt: s("IsoTimestamp", false, SYS),
  },
  User: {
    id: s("EntityId", false, SYS),
    orgId: s("EntityId", false, SYS),
    email: s("string", false, USER),
    displayName: s("string", false, USER),
    role: s("Role", false, USER),
    status: s("UserStatus", false, SYS),
    createdAt: s("IsoTimestamp", false, SYS),
  },
  Session: {
    id: s("EntityId", false, SYS),
    userId: s("EntityId", false, SYS),
    orgId: s("EntityId", false, SYS),
    role: s("Role", false, SYS),
    createdAt: s("IsoTimestamp", false, SYS),
    expiresAt: s("IsoTimestamp", false, SYS),
    revokedAt: s("IsoTimestamp", true, SYS),
  },
  Household: {
    id: s("EntityId", false, SYS),
    orgId: s("EntityId", false, SYS),
    name: s("string", false, USER),
    primaryContactId: s("EntityId", true, SYS),
    advisorUserId: s("EntityId", true, USER),
    status: s("HouseholdStatus", false, USER),
    createdAt: s("IsoTimestamp", false, SYS),
  },
  Contact: {
    id: s("EntityId", false, SYS),
    orgId: s("EntityId", false, SYS),
    householdId: s("EntityId", false, SYS),
    firstName: s("string", false, USER),
    lastName: s("string", false, USER),
    email: s("string", true, USER),
    phone: s("string", true, USER),
    createdAt: s("IsoTimestamp", false, SYS),
  },
  FinancialAccount: {
    id: s("EntityId", false, SYS),
    orgId: s("EntityId", false, SYS),
    householdId: s("EntityId", false, SYS),
    accountType: s("AccountType", false, USER),
    custodian: s("string", true, USER),
    balanceMinorUnits: s("number", true, MONEY, "USD-minor"),
    currency: s("string", false, SYS),
    status: s("FinancialAccountStatus", false, SYS),
    openDate: s("IsoTimestamp", true, SYS),
    createdAt: s("IsoTimestamp", false, SYS),
  },
  AccountOpeningApplication: {
    id: s("EntityId", false, SYS),
    orgId: s("EntityId", false, SYS),
    householdId: s("EntityId", false, SYS),
    contactId: s("EntityId", false, SYS),
    accountType: s("AccountType", false, USER),
    status: s("ApplicationStatus", false, SYS),
    esignToken: s("string", true, SYS),
    idempotencyKey: s("string", false, SYS),
    createdAt: s("IsoTimestamp", false, SYS),
    updatedAt: s("IsoTimestamp", false, SYS),
  },
  Task: {
    id: s("EntityId", false, SYS),
    orgId: s("EntityId", false, SYS),
    householdId: s("EntityId", true, SYS),
    subject: s("string", false, USER),
    status: s("TaskStatus", false, USER),
    dueDate: s("IsoTimestamp", true, USER),
    assigneeUserId: s("EntityId", true, USER),
    createdAt: s("IsoTimestamp", false, SYS),
  },
  AuditEntry: {
    id: s("EntityId", false, SYS),
    orgId: s("EntityId", false, SYS),
    sequence: s("number", false, SYS),
    actor: s("string", false, SYS),
    action: s("string", false, SYS),
    entityType: s("string", false, SYS),
    entityId: s("EntityId", true, SYS),
    beforeJson: s("string", true, SYS),
    afterJson: s("string", true, SYS),
    detail: s("string", false, SYS),
    createdAt: s("IsoTimestamp", false, SYS),
    prevHash: s("string", false, SYS),
    entryHash: s("string", false, SYS),
  },
};
