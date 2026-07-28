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

// Sealed security types (v3 §15.1/§15.2, invariant 1): constructible ONLY in
// their factory modules. Edit-time mirror of the AUTHORITATIVE
// tokenized-factory-only fitness fence — the fence asserts these two lists match
// its own SEALED registry exactly, so the mirror cannot silently drift narrower,
// and separately asserts that this rule is WIRED into every shipped layer.
//
// SCOPE: the mirror covers the NAME-KEYED subset — a cast/assertion/satisfies
// naming a sealed type, and a `piiFree` object literal. The shapes that need the
// type checker to see (a sub-interface that merely EXTENDS a sealed type, a type
// predicate, a generic type argument that flows out of a call, an annotation
// filled from an `any`) are caught by the fitness fence alone; a selector keyed
// on an identifier's text cannot resolve `AnyTenant` back to `TenantContext`.
const SEALED_TYPES = [
  "ActionGrant",
  "ActorRef",
  "ObservabilityId",
  "Principal",
  "TenantContext",
  "Tokenized",
  "WriteActor",
];
const SEALED_FACTORY_FILES = [
  "src/contracts/authz.ts",
  "src/contracts/principal.ts",
  "src/contracts/tenant.ts",
  "src/domain/observability/safe-values.ts",
  "src/infrastructure/pii/tokenize.ts",
];
const SEALED_TYPE_NAME = `/^(${SEALED_TYPES.join("|")})$/`;
const sealedTypeMessage =
  "Sealed type: construct via its factory (tokenizeText/tokenizeRecord, tenantOf/systemTenant, authorizeGovernedAction, writeActorOf, observabilityId) — a cast or literal bypasses the scrub/seal (v3 invariant 1).";
const noSealedTypeConstruction = [
  { selector: `TSAsExpression TSTypeReference Identifier[name=${SEALED_TYPE_NAME}]`, message: sealedTypeMessage },
  { selector: `TSTypeAssertion TSTypeReference Identifier[name=${SEALED_TYPE_NAME}]`, message: sealedTypeMessage },
  { selector: `TSSatisfiesExpression TSTypeReference Identifier[name=${SEALED_TYPE_NAME}]`, message: sealedTypeMessage },
  // The flag itself, not a parser DESCRIBING it: `{ value, piiFree: true }` is the
  // hand-built impostor; `piiFree: z.literal(true)` inside a schema is a validator
  // that mints nothing. Matches the fitness fence's rule exactly (a `true` literal,
  // optionally `as const`, or a shorthand name bound to one).
  { selector: "ObjectExpression > Property[key.name='piiFree'][value.type='Literal'][value.value=true]", message: sealedTypeMessage },
  { selector: "ObjectExpression > Property[key.name='piiFree'] > TSAsExpression > Literal[value=true]", message: sealedTypeMessage },
  { selector: "ObjectExpression > Property[key.name='piiFree'][shorthand=true]", message: sealedTypeMessage },
];

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
      "no-restricted-syntax": ["error", noProcessEnv, ...noSealedTypeConstruction],
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
      "no-restricted-syntax": ["error", noProcessEnv, ...noSealedTypeConstruction],
    },
  },
  {
    files: ["src/infrastructure/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: OUTER_FROM_INFRA, message: "infrastructure must not import app (dependency rule)." },
          ],
        },
      ],
      // config/** is exempt from noProcessEnv ONLY (charter #7 names it as the one
      // module allowed to read the environment) — never from the sealed-type rule.
      "no-restricted-syntax": ["error", ...noSealedTypeConstruction],
    },
  },
  {
    files: ["src/infrastructure/**/*.{ts,tsx}"],
    ignores: ["src/infrastructure/config/**"],
    rules: {
      "no-restricted-syntax": ["error", noProcessEnv, ...noSealedTypeConstruction],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...noSealedTypeConstruction],
    },
  },
  // The factory modules themselves — the ONLY sanctioned construction sites, and
  // exactly the files the authoritative fence allowlists. Sibling modules
  // (scrub.ts, llm-projection.ts) stay under the sealed-type rule.
  {
    files: SEALED_FACTORY_FILES,
    rules: {
      "no-restricted-syntax": ["error", noProcessEnv],
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
