// The edit-time linter (5A: eslint + typescript-eslint as one package), blocking in CI from PR-2b on.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "test-results/**", "playwright-report/**", "enforcement/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // vitest assertions and sealed-flow tests legitimately assert non-null after expect() checks
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  // the capability-denied fixture is deliberately CommonJS: it loads via --require before any ESM
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
);
