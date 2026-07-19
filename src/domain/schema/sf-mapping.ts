/**
 * Salesforce object-graph mapping (ADR-0004, charter #2 & System-of-Record
 * strategy). DOCUMENTATION ONLY — there is no Salesforce adapter code (charter #5
 * forbids unshipped code). Maintained from day one so that wiring Salesforce later
 * is adapter work, not a remodel. Declares read-vs-write ownership per MODELED
 * field only (no speculative SF fields); grows flow-by-flow with the schema.
 *
 * `ownership` is from Verin's perspective once Salesforce is a second source:
 *  - "sf-writes": Salesforce owns the write; Verin reads (survivorship favors SF).
 *  - "verin-writes": Verin owns the write; Salesforce mirrors.
 *  - "read-write": either may write; golden-record survivorship resolves conflicts.
 *  - "verin-internal": no Salesforce equivalent (Verin-only).
 */
import type { EntityName } from "./entities";

export type SfOwnership = "sf-writes" | "verin-writes" | "read-write" | "verin-internal";

export interface SfFieldMapping {
  readonly sfObject: string | null;
  readonly sfField: string | null;
  readonly ownership: SfOwnership;
}

export const SF_MAPPING: Partial<Record<EntityName, Record<string, SfFieldMapping>>> = {
  Household: {
    id: { sfObject: "Account", sfField: "Verin_External_Id__c", ownership: "verin-writes" },
    name: { sfObject: "Account", sfField: "Name", ownership: "read-write" },
    status: { sfObject: "Account", sfField: "Type", ownership: "read-write" },
    advisorUserId: { sfObject: "Account", sfField: "OwnerId", ownership: "read-write" },
  },
  Contact: {
    firstName: { sfObject: "Contact", sfField: "FirstName", ownership: "read-write" },
    lastName: { sfObject: "Contact", sfField: "LastName", ownership: "read-write" },
    email: { sfObject: "Contact", sfField: "Email", ownership: "read-write" },
    phone: { sfObject: "Contact", sfField: "Phone", ownership: "read-write" },
    householdId: { sfObject: "Contact", sfField: "AccountId", ownership: "read-write" },
  },
  FinancialAccount: {
    accountType: { sfObject: "FinancialAccount", sfField: "Type", ownership: "read-write" },
    custodian: { sfObject: "FinancialAccount", sfField: "Custodian__c", ownership: "sf-writes" },
    balanceMinorUnits: { sfObject: "FinancialAccount", sfField: "Balance__c", ownership: "sf-writes" },
    status: { sfObject: "FinancialAccount", sfField: "Status__c", ownership: "read-write" },
  },
  Task: {
    subject: { sfObject: "Task", sfField: "Subject", ownership: "read-write" },
    status: { sfObject: "Task", sfField: "Status", ownership: "read-write" },
    dueDate: { sfObject: "Task", sfField: "ActivityDate", ownership: "read-write" },
  },
  // Org, User, Session, AccountOpeningApplication, AuditEntry are Verin-internal
  // (no Salesforce equivalent) — represented by absence here.
};
