import { describe, it, expect } from "vitest";
import { startFlow, resumeFlow, type FlowDefinition, type ExecutionStore, type ExecutionState } from "@domain/workflow/engine";

/**
 * FLOWSTEP SUSPEND/RESUME FENCE (ADR-0011, charter #6). Proves the engine actually
 * SUSPENDS and RESUMES — not a stub that runs to completion (Iris's gap). A
 * suspending step returns "suspend"; the engine persists the continuation and
 * returns; resume runs the remaining steps.
 */
interface Deps {
  hits: string[];
}

function makeStore(): ExecutionStore {
  const rows = new Map<string, ExecutionState>();
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
      return [...rows.values()].find((r) => r.resumeToken === token) ?? null;
    },
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

describe("flowstep suspend/resume fence", () => {
  it("enforces: the engine suspends at a suspend step and resumes the rest", async () => {
    const store = makeStore();
    const deps: Deps = { hits: [] };

    const started = await startFlow(flow, store, deps, { executionId: "e1", orgId: "o", data: {} });
    // Suspended BEFORE step c ran (step c must not have executed yet).
    expect(started.status).toBe("suspended");
    expect(started.token).toBe("tok-1");
    expect(deps.hits).toEqual(["a", "b"]); // c NOT yet run

    const resumed = await resumeFlow(flow, store, deps, "tok-1", { signed: true });
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
    await startFlow(flaky, store, deps, { executionId: "ef", orgId: "o", data: {} });
    const first = await resumeFlow(flaky, store, deps, "tk", {});
    expect("status" in first && first.status).toBe("failed");
    const retry = await resumeFlow(flaky, store, deps, "tk", {}); // retried, not wedged
    expect("status" in retry && retry.status).toBe("completed");
    expect(attempts).toBe(2);
  });

  describe("detects (companion): the engine is not an execute-to-completion stub", () => {
    it("a flow with NO suspend step completes without ever suspending (contrast)", async () => {
      const store = makeStore();
      const deps: Deps = { hits: [] };
      const noSuspend: FlowDefinition<Deps> = {
        id: "n", name: "n",
        steps: [{ id: "x", name: "x", async execute(_c, d) { d.hits.push("x"); return { kind: "continue" }; } }],
      };
      const r = await startFlow(noSuspend, store, deps, { executionId: "e2", orgId: "o", data: {} });
      expect(r.status).toBe("completed"); // proves suspension is conditional, not always
      expect(r.token).toBeUndefined();
    });

    it("resuming an unknown token is not-found (no silent completion)", async () => {
      const store = makeStore();
      const r = await resumeFlow(flow, store, { hits: [] }, "nope", {});
      expect("status" in r && r.status).toBe("not-found");
    });
  });
});
