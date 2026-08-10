/**
 * Evidence-safety rules for the blocking workflow (ADR-0055): what neutralizes
 * a job or step, which triggers, runners, shells, working directories,
 * environments, containers, and predecessor steps are ratcheted as safe. A
 * shape outside these allowlists proves nothing, however correct it looks.
 */
import { collapse, shellCommandLines, simpleShellCommand } from "./shell";
import {
  hasOnlyKeys,
  literalMapping,
  sameLiteralMapping,
} from "./ci-values";

/**
 * What, if anything, stops a job or step from blocking the build. `continue-on-error`
 * anything but literal `false` swallows the failure; ANY `if:` makes the run
 * conditional, and a GitHub expression is not decidable here - so both are treated as
 * neutralizing. Fail-closed on purpose: an `if:` that is genuinely always true still
 * has to be re-stated in the registry's terms rather than trusted (ADR-0055).
 */
export function neutralizerOf(node: unknown): string | undefined {
  const n = node as { "continue-on-error"?: unknown; if?: unknown } | null;
  if (n === null || typeof n !== "object") return undefined;
  const cont = n["continue-on-error"];
  if (cont !== undefined && cont !== false) return `continue-on-error: ${String(cont)}`;
  if (n.if !== undefined) return `if: ${String(n.if)}`;
  return undefined;
}

export function dependencyNeutralizerOf(node: unknown): string | undefined {
  const job = node as { needs?: unknown } | null;
  if (job === null || typeof job !== "object" || !Object.hasOwn(job, "needs")) return undefined;
  if (Array.isArray(job.needs) && job.needs.length === 0) return undefined;
  const value = Array.isArray(job.needs) ? job.needs.join(", ") : String(job.needs);
  return `needs: ${value}`;
}

export function strategyNeutralizerOf(node: unknown): string | undefined {
  const strategy = (node as { strategy?: unknown } | null)?.strategy;
  if (
    strategy === null ||
    typeof strategy !== "object" ||
    Array.isArray(strategy)
  ) {
    return strategy === undefined
      ? undefined
      : `strategy: ${String(strategy)}`;
  }
  return Object.hasOwn(strategy, "matrix")
    ? "strategy.matrix is not supported as blocking evidence"
    : undefined;
}

export function configuredRunShell(node: unknown): unknown {
  const defaults = (node as { defaults?: unknown } | null)?.defaults;
  const run = (defaults as { run?: unknown } | null)?.run;
  return (run as { shell?: unknown } | null)?.shell;
}

export function configuredRunWorkingDirectory(node: unknown): unknown {
  const defaults = (node as { defaults?: unknown } | null)?.defaults;
  const run = (defaults as { run?: unknown } | null)?.run;
  return (run as { "working-directory"?: unknown } | null)?.["working-directory"];
}

const EXECUTION_AFFECTING_ENVIRONMENT = new Set([
  "BASH_ENV",
  "BASHOPTS",
  "CDPATH",
  "COREPACK_HOME",
  "COREPACK_NPM_REGISTRY",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "ENV",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_EXEC_PATH",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "HOME",
  "IFS",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NPM_CONFIG_SCRIPT_SHELL",
  "NPM_CONFIG_USERCONFIG",
  "PATH",
  "PERL5OPT",
  "PNPM_HOME",
  "PYTHONHOME",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYOPT",
  "SHELLOPTS",
  "TS_NODE_COMPILER",
  "TS_NODE_PROJECT",
  "TSX_TSCONFIG_PATH",
  "XDG_CONFIG_HOME",
  "_JAVA_OPTIONS",
]);

const EXECUTION_AFFECTING_ENVIRONMENT_PREFIXES = [
  "COREPACK_",
  "NODE_",
  "NPM_CONFIG_",
  "PNPM_",
  "TS_NODE_",
];

function executionAffectingEnvironmentVariable(
  name: string,
): boolean {
  return (
    EXECUTION_AFFECTING_ENVIRONMENT.has(name) ||
    EXECUTION_AFFECTING_ENVIRONMENT_PREFIXES.some((prefix) =>
      name.startsWith(prefix),
    )
  );
}

export function environmentProblem(
  ...scopes: unknown[]
): string | undefined {
  for (const scope of scopes) {
    const value = (scope as { env?: unknown } | null)?.env;
    if (value === undefined) continue;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return "environment configuration is not a literal mapping";
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const normalized = key.toUpperCase();
      if (executionAffectingEnvironmentVariable(normalized)) {
        return `execution-affecting environment variable '${key}' is overridden`;
      }
    }
  }
  return undefined;
}

const APPROVED_CI_CONTAINER_IMAGES = new Set([
  "semgrep/semgrep",
]);

export function containerProblem(container: unknown): string | undefined {
  if (container === undefined) return undefined;
  const mapping =
    typeof container === "string" ? undefined : literalMapping(container);
  if (
    mapping !== undefined &&
    Object.keys(mapping).some((key) => key !== "image" && key !== "env")
  ) {
    return "container configuration contains unapproved fields";
  }
  const image =
    typeof container === "string"
      ? container
      : mapping?.image;
  if (typeof image !== "string" || image.trim() === "") {
    return "container image is not a literal non-empty string";
  }
  return APPROVED_CI_CONTAINER_IMAGES.has(image)
    ? undefined
    : `unapproved container image '${image}'`;
}

const APPROVED_CI_PREREQUISITE_ACTIONS = new Map<
  string,
  readonly Readonly<Record<string, string | number>>[]
>([
  ["actions/checkout@v7", [{}, { "fetch-depth": 0 }]],
  ["pnpm/action-setup@v6", [{}]],
  [
    "actions/setup-node@v7",
    [{ "node-version": 22, cache: "pnpm" }],
  ],
]);

const APPROVED_CI_PREREQUISITE_COMMANDS = new Set([
  "pnpm audit --audit-level=high",
  "pnpm exec playwright install --with-deps chromium",
  "pnpm exec playwright test",
  "pnpm exec tsx scripts/db-seed.ts",
  "pnpm exec vitest run",
  "pnpm install --frozen-lockfile",
  "pnpm lint",
  "pnpm typecheck",
]);

const APPROVED_CI_PREREQUISITE_SCRIPTS = new Set([
  [
    'curl -fsSL --retry 5 --retry-all-errors -o /tmp/gitleaks.tar.gz "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"',
    'echo "${GITLEAKS_SHA256} /tmp/gitleaks.tar.gz" | sha256sum -c -',
    "tar -xzf /tmp/gitleaks.tar.gz -C /tmp gitleaks",
    "sudo install -m 0755 /tmp/gitleaks /usr/local/bin/gitleaks",
  ].join("\n"),
]);

export function approvedPrerequisiteProblem(
  step: unknown,
  index: number,
): string | undefined {
  const record = literalMapping(step);
  const prefix = `predecessor step ${index + 1}`;
  if (record === undefined) {
    return `${prefix} is not a literal step mapping`;
  }
  if (
    neutralizerOf(record) !== undefined ||
    environmentProblem(record) !== undefined
  ) {
    return `${prefix} is not an approved CI evidence prerequisite`;
  }
  const uses = record.uses;
  if (uses !== undefined) {
    if (typeof uses !== "string") {
      return `${prefix} action is not a literal string`;
    }
    const approvedInputs = APPROVED_CI_PREREQUISITE_ACTIONS.get(uses);
    const withInputs = record.with === undefined
      ? {}
      : literalMapping(record.with);
    if (
      approvedInputs === undefined ||
      withInputs === undefined ||
      !hasOnlyKeys(record, ["name", "uses", "with"]) ||
      !approvedInputs.some((expected) =>
        sameLiteralMapping(withInputs, expected),
      )
    ) {
      return `${prefix} is not an approved CI evidence prerequisite`;
    }
    return undefined;
  }
  const run = record.run;
  if (typeof run !== "string") {
    return `${prefix} is not an approved CI evidence prerequisite`;
  }
  const simple = simpleShellCommand(run);
  if (
    simple !== undefined &&
    APPROVED_CI_PREREQUISITE_COMMANDS.has(simple.text) &&
    hasOnlyKeys(record, ["name", "run"])
  ) {
    return undefined;
  }
  const normalizedScript = shellCommandLines(run).join("\n");
  if (
    APPROVED_CI_PREREQUISITE_SCRIPTS.has(normalizedScript) &&
    hasOnlyKeys(record, ["env", "name", "run"]) &&
    sameLiteralMapping(
      literalMapping(record.env) ?? {},
      {
        GITLEAKS_VERSION: "8.24.3",
        GITLEAKS_SHA256:
          "9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c",
      },
    )
  ) {
    return undefined;
  }
  return `${prefix} is not an approved CI evidence prerequisite`;
}

export function workflowTriggerProblem(doc: unknown): string | undefined {
  const trigger = (doc as { on?: unknown } | null)?.on;
  const requiredEvents = new Set(["push", "pull_request"]);
  if (Array.isArray(trigger)) {
    if (
      trigger.length !== requiredEvents.size ||
      trigger.some(
        (event) =>
          typeof event !== "string" || !requiredEvents.has(event),
      )
    ) {
      return "workflow trigger list must contain only push and pull_request";
    }
    return new Set(trigger).size === requiredEvents.size
      ? undefined
      : "workflow must run on every push and pull_request event";
  }
  if (trigger === null || typeof trigger !== "object") {
    return "workflow must run on every push and pull_request event";
  }
  const configured = trigger as Record<string, unknown>;
  const unsupportedEvent = Object.keys(configured).find(
    (event) => !requiredEvents.has(event),
  );
  if (unsupportedEvent !== undefined) {
    return `workflow trigger '${unsupportedEvent}' is not supported for blocking evidence`;
  }
  for (const event of ["push", "pull_request"]) {
    if (!Object.hasOwn(configured, event)) {
      return `workflow is missing the '${event}' trigger`;
    }
    const value = configured[event];
    if (
      value !== null &&
      value !== undefined &&
      (typeof value !== "object" || Array.isArray(value) || Object.keys(value as Record<string, unknown>).length > 0)
    ) {
      return `workflow '${event}' trigger carries branch, path, or event filters`;
    }
  }
  return undefined;
}

const SUPPORTED_POSIX_RUNNERS = new Set([
  "ubuntu-latest",
  "ubuntu-24.04",
  "ubuntu-22.04",
  "macos-latest",
  "macos-15",
  "macos-14",
]);

export function runnerProblem(runsOn: unknown): string | undefined {
  if (runsOn === undefined) return "missing runs-on";
  if (typeof runsOn !== "string") return `non-string runs-on '${String(runsOn)}'`;
  const normalized = runsOn.toLowerCase();
  if (SUPPORTED_POSIX_RUNNERS.has(normalized)) return undefined;
  return `unsupported or unschedulable runner '${runsOn}'`;
}

export function shellProblem(shell: unknown): string | undefined {
  if (shell === undefined) return undefined;
  if (typeof shell !== "string") return `non-string shell '${String(shell)}'`;
  const normalized = collapse(shell).toLowerCase();
  if (normalized === "bash" || normalized === "sh") return undefined;
  return `unsupported shell '${shell}'`;
}

export function workingDirectoryProblem(directory: unknown): string | undefined {
  if (directory === undefined) return undefined;
  if (typeof directory !== "string") return `non-string working-directory '${String(directory)}'`;
  const normalized = directory.trim().replace(/\/+$/, "");
  if (normalized === "" || normalized === ".") return undefined;
  return `working-directory '${directory}' is not the repository root`;
}
