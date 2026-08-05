import { beforeEach, describe, expect, it, vi } from "vitest";
import { actorRefOf, authorizeGovernedAction } from "@contracts/authz";
import { principalFromIdentity, delegatedWriteActor, systemWriteActor } from "@contracts/principal";
import { registerTestSystemActor, systemTenant, tenantOf, type TenantContext } from "@contracts/tenant";
import type { AccountOpeningDeps } from "@domain/workflow/flows/account-opening";
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
  sessionLineageId: "lineage-s-starter",
});
const otherPrincipal = principalFromIdentity({
  userId: "u-other",
  orgId: ORG,
  role: "advisor",
  actor: "other@firm.test",
  sessionId: "s-other",
  sessionLineageId: "lineage-s-other",
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
      deps: AccountOpeningDeps,
      input: { executionId: string },
    ): Promise<FlowRunResult> => {
      await deps.createHousehold("Mismatch", injectedTenant);
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
