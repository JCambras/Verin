import { describe, it, expect } from "vitest";
import { registerTestSystemActor, systemTenant } from "@contracts/tenant";
import { startFlow, resumeFlow, type FlowDefinition, type ExecutionStore, type ExecutionState } from "@domain/workflow/engine";

const TEST_SYSTEM_ACTOR = registerTestSystemActor("test");

/**
 * FLOWSTEP SUSPEND/RESUME FENCE (ADR-0011, charter #6). Proves the engine actually
 * SUSPENDS and RESUMES — not a stub that runs to completion (Iris's gap). A
 * suspending step returns "suspend"; the engine persists the continuation and
 * returns; resume runs the remaining steps.
 */
interface Deps {
  hits: string[];
}

/** Counts token loads: the resume path is behind a serializing mutex in production. */
interface CountingStore extends ExecutionStore {
  tokenLoads(): number;
}

function makeStore(): CountingStore {
  const rows = new Map<string, ExecutionState>();
  let tokenLoads = 0;
  return {
    async create(s) {
      rows.set(s.id, { ...s });
    },
    async save(s) {
      rows.set(s.id, { ...s });
    },
    async loadById(id) {
      return rows.get(id) ?? null;
    },
    async loadByToken(token) {
      tokenLoads += 1;
      // In-memory TEST FAKE lookup; the production token/HMAC comparison uses timingSafeEqual (esign.ts).
      // nosemgrep: ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack
      return [...rows.values()].find((r) => r.resumeToken === token) ?? null;
    },
    tokenLoads: () => tokenLoads,
  };
}

const flow: FlowDefinition<Deps> = {
  id: "t",
  name: "t",
  steps: [
    { id: "a", name: "a", async execute(_ctx, deps) { deps.hits.push("a"); return { kind: "continue" }; } },
    { id: "b", name: "b", async execute(_ctx, deps) { deps.hits.push("b"); return { kind: "suspend", token: "tok-1", awaiting: "external" }; } },
    { id: "c", name: "c", async execute(_ctx, deps) { deps.hits.push("c"); return { kind: "continue" }; } },
  ],
};

const TENANT = systemTenant(TEST_SYSTEM_ACTOR, "o");

describe("flowstep suspend/resume fence", () => {
  it("enforces: the engine suspends at a suspend step and resumes the rest", async () => {
    const store = makeStore();
    const deps: Deps = { hits: [] };

    const started = await startFlow(flow, store, deps, { executionId: "e1", tenant: TENANT, data: {} });
    // Suspended BEFORE step c ran (step c must not have executed yet).
    expect(started.status).toBe("suspended");
    expect(started.token).toBe("tok-1");
    expect(deps.hits).toEqual(["a", "b"]); // c NOT yet run

    const resumed = await resumeFlow(flow, store, deps, "tok-1", { signed: true }, TENANT);
    expect("status" in resumed && resumed.status).toBe("completed");
    expect(deps.hits).toEqual(["a", "b", "c"]); // c ran on resume
  });

  it("enforces: a FAILED execution is retried from its cursor, not permanently wedged (Vale V7)", async () => {
    const store = makeStore();
    const deps: Deps = { hits: [] };
    let attempts = 0;
    const flaky: FlowDefinition<Deps> = {
      id: "flaky",
      name: "flaky",
      steps: [
        { id: "s", name: "s", async execute() { return { kind: "suspend", token: "tk", awaiting: "x" }; } },
        {
          id: "finalize",
          name: "finalize",
          async execute() {
            attempts += 1;
            if (attempts === 1) return { kind: "fail", error: { code: "STORE_UNAVAILABLE", message: "transient" } };
            return { kind: "continue" };
          },
        },
      ],
    };
    await startFlow(flaky, store, deps, { executionId: "ef", tenant: TENANT, data: {} });
    const first = await resumeFlow(flaky, store, deps, "tk", {}, TENANT);
    expect("status" in first && first.status).toBe("failed");
    const retry = await resumeFlow(flaky, store, deps, "tk", {}, TENANT); // retried, not wedged
    expect("status" in retry && retry.status).toBe("completed");
    expect(attempts).toBe(2);
  });

  /**
   * A CALLER'S PRECONDITION IS JUDGED AGAINST THE SNAPSHOT THE DRIVE USES.
   *
   * The composition root refuses to resume an execution bound to a superseded
   * configuration version. It used to load the row ITSELF to check that and then
   * call in, which loaded the row a second time - a third sequential round trip on
   * the webhook path against a store that serializes every operation, and two
   * different snapshots, so the version checked was not provably the version
   * driven. Both halves are asserted: ONE load, and the guard sees the same state.
   */
  it("enforces: a resume guard judges the ONE snapshot the drive would use", async () => {
    const store = makeStore();
    const deps: Deps = { hits: [] };
    await startFlow(flow, store, deps, { executionId: "e-guard", tenant: TENANT, data: { mark: "start" } });
    const before = store.tokenLoads();
    const seen: ExecutionState[] = [];
    const refused = await resumeFlow(flow, store, deps, "tok-1", { signed: true }, TENANT, (state) => {
      seen.push(state);
      return { code: "CONFLICT", message: "superseded" };
    });
    expect(store.tokenLoads() - before).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe("e-guard");
    expect(seen[0]!.data["mark"]).toBe("start");
    expect("status" in refused && refused.status).toBe("failed");
    // Refusing to DRIVE never advances or fails the persisted row: the execution
    // stays resumable, so the sender's later redelivery still completes it.
    expect(deps.hits).toEqual(["a", "b"]);
    const persisted = await store.loadById("e-guard", undefined as never);
    expect(persisted?.status).toBe("suspended");
  });

  it("enforces: a guard that passes drives normally, so the refusal is conditional", async () => {
    const store = makeStore();
    const deps: Deps = { hits: [] };
    await startFlow(flow, store, deps, { executionId: "e-open", tenant: TENANT, data: {} });
    const resumed = await resumeFlow(flow, store, deps, "tok-1", {}, TENANT, () => null);
    expect("status" in resumed && resumed.status).toBe("completed");
    expect(deps.hits).toEqual(["a", "b", "c"]);
  });

  describe("detects (companion): the engine is not an execute-to-completion stub", () => {
    it("a flow with NO suspend step completes without ever suspending (contrast)", async () => {
      const store = makeStore();
      const deps: Deps = { hits: [] };
      const noSuspend: FlowDefinition<Deps> = {
        id: "n", name: "n",
        steps: [{ id: "x", name: "x", async execute(_c, d) { d.hits.push("x"); return { kind: "continue" }; } }],
      };
      const r = await startFlow(noSuspend, store, deps, { executionId: "e2", tenant: TENANT, data: {} });
      expect(r.status).toBe("completed"); // proves suspension is conditional, not always
      expect(r.token).toBeUndefined();
    });

    it("resuming an unknown token is not-found (no silent completion)", async () => {
      const store = makeStore();
      const r = await resumeFlow(flow, store, { hits: [] }, "nope", {}, TENANT);
      expect("status" in r && r.status).toBe("not-found");
    });
  });
});
