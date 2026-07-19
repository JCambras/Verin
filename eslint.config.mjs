import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * ESLint is the FAST, edit-time layer of the dependency rule and the
 * no-process-env invariant (defense in depth). The AUTHORITATIVE enforcement is
 * the ts-morph fitness fence in src/__tests__/fitness, which resolves relative
 * AND dynamic imports and scans file contents — the seams ESLint patterns miss.
 * Never weaken a fence here to make lint pass; fix the code or the fence.
 */

const OUTER_FROM_CONTRACTS = [
  "@domain/*",
  "@infra/*",
  "@app/*",
  "@/domain/*",
  "@/infrastructure/*",
  "@/app/*",
];
const OUTER_FROM_DOMAIN = ["@infra/*", "@app/*", "@/infrastructure/*", "@/app/*"];
const OUTER_FROM_INFRA = ["@app/*", "@/app/*"];

const noProcessEnv = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    "process.env may only be read in src/infrastructure/config (charter #7). Inject config instead.",
};

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "sbom.json",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextCoreWebVitals,

  // Dependency rule (inner layers never import outer) — edit-time layer.
  {
    files: ["src/contracts/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: OUTER_FROM_CONTRACTS,
              message: "contracts must not import outer layers (dependency rule).",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", noProcessEnv],
    },
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: OUTER_FROM_DOMAIN,
              message: "domain must not import infrastructure or app (dependency rule).",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", noProcessEnv],
    },
  },
  {
    files: ["src/infrastructure/**/*.{ts,tsx}"],
    ignores: ["src/infrastructure/config/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: OUTER_FROM_INFRA, message: "infrastructure must not import app (dependency rule)." },
          ],
        },
      ],
    },
  },

  // Tests, scripts, and config files are tooling, not shipped layers.
  {
    files: ["src/__tests__/**", "scripts/**", "*.config.{ts,mjs,js}", "e2e/**"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
