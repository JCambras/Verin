import { beforeEach, describe, expect, it, vi } from "vitest";
import { actorRefOf, authorizeGovernedAction } from "@contracts/authz";
import { principalFromIdentity, delegatedWriteActor, systemWriteActor } from "@contracts/principal";
import { registerTestSystemActor, systemTenant, tenantOf, type TenantContext } from "@contracts/tenant";
import type { ExecutionAdapters } from "@domain/config/plan-compiler";
import type { FlowRunResult } from "@domain/workflow/engine";
import { createMemoryDb, type SqlDb } from "@infra/store/db";

const startFlowMock = vi.hoisted(() => vi.fn());
vi.mock("@domain/workflow/engine", async (importOriginal) => ({
  ...await importOriginal<typeof import("@domain/workflow/engine")>(),
  startFlow: startFlowMock,
}));

const TEST_SYSTEM_ACTOR = registerTestSystemActor("test");
const ORG = "org-wire-authority";
const starterPrincipal = principalFromIdentity({
  userId: "u-starter",
  orgId: ORG,
  role: "advisor",
  actor: "starter@firm.test",
  sessionId: "s-starter",
});
const otherPrincipal = principalFromIdentity({
  userId: "u-other",
  orgId: ORG,
  role: "advisor",
  actor: "other@firm.test",
  sessionId: "s-other",
});
const starterRef = actorRefOf(starterPrincipal);
const execution = authorizeGovernedAction(starterRef, "execution.initiate");
const pii = authorizeGovernedAction(starterRef, "pii.view");
if (!execution.ok || !pii.ok) throw new Error("test principal lacks required grants");

let db: SqlDb;
let injectedTenant: TenantContext;

describe("account-opening dependency authority", () => {
  beforeEach(async () => {
    db = await createMemoryDb();
    startFlowMock.mockReset();
    startFlowMock.mockImplementation(async (
      _definition: unknown,
      _store: unknown,
      deps: ExecutionAdapters,
      input: { executionId: string },
    ): Promise<FlowRunResult> => {
      // The configured plan's FIRST command, invoked with a mismatched
      // authority: the adapter must refuse at the dependency call, before any
      // write, exactly as the hand-coded deps did.
      await deps.invoke(
        {
          capabilityId: "household-create",
          commandType: "household.create",
          payload: { name: "Mismatch" },
          idempotencyKey: "household:mismatch",
        },
        injectedTenant,
      );
      return {
        executionId: input.executionId,
        status: "completed",
        data: {},
      };
    });
  });

  it.each([
    ["same-org different human", () => tenantOf(otherPrincipal)],
    ["human versus system", () => systemTenant(TEST_SYSTEM_ACTOR, ORG)],
    [
      "delegated actor",
      () => delegatedWriteActor(
        systemWriteActor("esign-webhook", ORG),
        starterPrincipal.userId,
      ).tenant,
    ],
  ])("refuses %s authority at a dependency call", async (_label, tenant) => {
    injectedTenant = tenant();
    const { startAccountOpening } = await import("@infra/wire");
    const result = await startAccountOpening(db, execution.value, pii.value, {
      householdName: "Household",
      firstName: "First",
      lastName: "Last",
      email: null,
      accountType: "individual",
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("AUTH_FAILED");
    const households = await db.query("SELECT id FROM households");
    expect(households.rows).toHaveLength(0);
  });
});
