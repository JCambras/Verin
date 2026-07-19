/**
 * ACCOUNT OPENING flow (deliverable E). A declarative FlowDefinition run by the
 * generic engine (ADR-0010) that proves suspend/resume (ADR-0011): it suspends at
 * the e-sign step (fire-and-return) and is resumed by the e-sign webhook, which
 * finalizes with an audited, idempotent, exactly-once write.
 *
 * Steps reference only the injected `AccountOpeningDeps` port (implemented in
 * infrastructure) — the flow stays in the domain layer, adapters are wired in app.
 */
import type { FlowDefinition, FlowStep } from "../engine";
import type { AccountType } from "@domain/schema/entities";

export interface AccountOpeningDeps {
  createHousehold(name: string): Promise<{ id: string }>;
  createContact(input: { householdId: string; firstName: string; lastName: string; email: string | null }): Promise<{ id: string }>;
  createApplication(input: { householdId: string; contactId: string; accountType: AccountType }): Promise<{ id: string; idempotencyKey: string }>;
  requestEsign(applicationId: string): Promise<{ token: string }>;
  finalize(input: { applicationId: string; householdId: string; accountType: AccountType; idempotencyKey: string; actor: string }): Promise<void>;
}

const createHousehold: FlowStep<AccountOpeningDeps> = {
  id: "create-household",
  name: "Create household",
  async execute(ctx, deps) {
    const { id } = await deps.createHousehold(String(ctx.householdName));
    return { kind: "continue", patch: { householdId: id } };
  },
};

const createContact: FlowStep<AccountOpeningDeps> = {
  id: "create-contact",
  name: "Add primary contact",
  async execute(ctx, deps) {
    const { id } = await deps.createContact({
      householdId: String(ctx.householdId),
      firstName: String(ctx.firstName),
      lastName: String(ctx.lastName),
      email: ctx.email ? String(ctx.email) : null,
    });
    return { kind: "continue", patch: { contactId: id } };
  },
};

const createApplication: FlowStep<AccountOpeningDeps> = {
  id: "create-application",
  name: "Open application",
  async execute(ctx, deps) {
    const { id, idempotencyKey } = await deps.createApplication({
      householdId: String(ctx.householdId),
      contactId: String(ctx.contactId),
      accountType: ctx.accountType as AccountType,
    });
    return { kind: "continue", patch: { applicationId: id, finalizeIdempotencyKey: idempotencyKey } };
  },
};

const requestEsign: FlowStep<AccountOpeningDeps> = {
  id: "request-esign",
  name: "Send for e-signature",
  async execute(ctx, deps) {
    // Fire-and-return: send the e-sign request, then SUSPEND awaiting the webhook.
    const { token } = await deps.requestEsign(String(ctx.applicationId));
    return { kind: "suspend", token, awaiting: "esign-signature", patch: { esignToken: token } };
  },
};

const finalize: FlowStep<AccountOpeningDeps> = {
  id: "finalize",
  name: "Finalize account opening",
  async execute(ctx, deps) {
    // Runs on RESUME (after the signature webhook). Idempotent + audited.
    await deps.finalize({
      applicationId: String(ctx.applicationId),
      householdId: String(ctx.householdId),
      accountType: ctx.accountType as AccountType,
      idempotencyKey: String(ctx.finalizeIdempotencyKey),
      actor: String(ctx.initiatedBy),
    });
    return { kind: "continue", patch: { finalized: true } };
  },
};

export const accountOpeningFlow: FlowDefinition<AccountOpeningDeps> = {
  id: "account-opening",
  name: "Account Opening",
  steps: [createHousehold, createContact, createApplication, requestEsign, finalize],
};

/** The declarative view the generic renderer uses to collect inputs (charter #10). */
export interface FlowFieldSpec {
  name: string;
  label: string;
  type: "text" | "email" | "select";
  required: boolean;
  hint?: string;
  options?: readonly string[];
}

export const accountOpeningView: { title: string; regulation: string; fields: FlowFieldSpec[] } = {
  title: "Open an account",
  regulation: "SEC Reg BI / FINRA 2090 (Know Your Customer)",
  fields: [
    { name: "householdName", label: "Household name", type: "text", required: true },
    { name: "firstName", label: "Primary contact first name", type: "text", required: true },
    { name: "lastName", label: "Primary contact last name", type: "text", required: true },
    { name: "email", label: "Email", type: "email", required: false, hint: "Stored in the house CRM; redacted from the audit trail automatically." },
    {
      name: "accountType",
      label: "Account type",
      type: "select",
      required: true,
      options: ["individual", "joint", "ira-traditional", "ira-roth", "rollover-ira", "trust", "entity"],
    },
  ],
};
