import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/tools/decision-record-verifier.check.ts"],
  },
});
