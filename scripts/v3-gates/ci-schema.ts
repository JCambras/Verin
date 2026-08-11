/**
 * GitHub-executable workflow shape validation (ADR-0055). A workflow GitHub
 * cannot execute proves nothing, so mixed `run`/`uses` fields, `with` on a run
 * step, local execution fields on a reusable-workflow job, unknown permission
 * scopes, invalid identifiers, and malformed timeout values all invalidate the
 * whole workflow before any command can become evidence.
 */
import {
  concurrencyProblem,
  conditionValue,
  defaultsProblem,
  hasOnlyKeys,
  literalMapping,
  nonEmptyString,
  permissionsProblem,
  scalarMappingProblem,
  stringOrStringArray,
  timeoutValue,
} from "./ci-values";

const RUN_STEP_FIELDS = [
  "continue-on-error",
  "env",
  "id",
  "if",
  "name",
  "run",
  "shell",
  "timeout-minutes",
  "working-directory",
] as const;

const USES_STEP_FIELDS = [
  "continue-on-error",
  "env",
  "id",
  "if",
  "name",
  "timeout-minutes",
  "uses",
  "with",
] as const;

const LOCAL_JOB_FIELDS = [
  "concurrency",
  "container",
  "continue-on-error",
  "defaults",
  "env",
  "environment",
  "if",
  "name",
  "needs",
  "outputs",
  "permissions",
  "runs-on",
  "services",
  "steps",
  "strategy",
  "timeout-minutes",
] as const;

const REUSABLE_JOB_FIELDS = [
  "concurrency",
  "if",
  "name",
  "needs",
  "permissions",
  "secrets",
  "strategy",
  "uses",
  "with",
] as const;

const WORKFLOW_FIELDS = [
  "concurrency",
  "defaults",
  "env",
  "jobs",
  "name",
  "on",
  "permissions",
  "run-name",
] as const;

function commonStepFieldProblem(
  record: Readonly<Record<string, unknown>>,
  prefix: string,
): string | undefined {
  if (record.name !== undefined && !nonEmptyString(record.name)) {
    return `${prefix} name must be a non-empty string`;
  }
  if (record.id !== undefined && !nonEmptyString(record.id)) {
    return `${prefix} id must be a non-empty string`;
  }
  if (record.if !== undefined && !conditionValue(record.if)) {
    return `${prefix} if must be a boolean or expression string`;
  }
  if (
    record["continue-on-error"] !== undefined &&
    !conditionValue(record["continue-on-error"])
  ) {
    return `${prefix} continue-on-error must be a boolean or expression string`;
  }
  if (
    record["timeout-minutes"] !== undefined &&
    !timeoutValue(record["timeout-minutes"])
  ) {
    return `${prefix} timeout-minutes must be a positive integer or expression string`;
  }
  return record.env === undefined
    ? undefined
    : scalarMappingProblem(record.env, `${prefix} env`);
}

function commonJobFieldProblem(
  record: Readonly<Record<string, unknown>>,
  prefix: string,
): string | undefined {
  if (record.name !== undefined && !nonEmptyString(record.name)) {
    return `${prefix} name must be a non-empty string`;
  }
  if (record.if !== undefined && !conditionValue(record.if)) {
    return `${prefix} if must be a boolean or expression string`;
  }
  if (record.needs !== undefined && !stringOrStringArray(record.needs)) {
    return `${prefix} needs must be a non-empty string or string array`;
  }
  const permissionProblem = permissionsProblem(record.permissions);
  if (permissionProblem !== undefined) return `${prefix} ${permissionProblem}`;
  const concurrency = concurrencyProblem(record.concurrency);
  if (concurrency !== undefined) return `${prefix} ${concurrency}`;
  return undefined;
}

function containerSchemaProblem(
  value: unknown,
  label: string,
): string | undefined {
  if (nonEmptyString(value)) return undefined;
  const mapping = literalMapping(value);
  if (
    mapping === undefined ||
    !hasOnlyKeys(mapping, [
      "credentials",
      "env",
      "image",
      "options",
      "ports",
      "volumes",
    ]) ||
    !nonEmptyString(mapping.image)
  ) {
    return `${label} must be a string or literal container mapping with an image`;
  }
  if (mapping.credentials !== undefined) {
    const credentials = literalMapping(mapping.credentials);
    if (
      credentials === undefined ||
      !hasOnlyKeys(credentials, ["password", "username"]) ||
      !nonEmptyString(credentials.username) ||
      !nonEmptyString(credentials.password)
    ) {
      return `${label} credentials must contain string username and password values`;
    }
  }
  if (mapping.env !== undefined) {
    const environment = scalarMappingProblem(mapping.env, `${label} env`);
    if (environment !== undefined) return environment;
  }
  if (mapping.options !== undefined && !nonEmptyString(mapping.options)) {
    return `${label} options must be a non-empty string`;
  }
  if (
    mapping.ports !== undefined &&
    (!Array.isArray(mapping.ports) ||
      !mapping.ports.every((port) =>
        typeof port === "number" || nonEmptyString(port),
      ))
  ) {
    return `${label} ports must be an array of strings or numbers`;
  }
  return mapping.volumes === undefined ||
    (Array.isArray(mapping.volumes) && mapping.volumes.every(nonEmptyString))
    ? undefined
    : `${label} volumes must be a string array`;
}

function localJobFieldProblem(
  record: Readonly<Record<string, unknown>>,
  prefix: string,
): string | undefined {
  if (
    record["continue-on-error"] !== undefined &&
    !conditionValue(record["continue-on-error"])
  ) {
    return `${prefix} continue-on-error must be a boolean or expression string`;
  }
  if (
    record["timeout-minutes"] !== undefined &&
    !timeoutValue(record["timeout-minutes"])
  ) {
    return `${prefix} timeout-minutes must be a positive integer or expression string`;
  }
  if (record["runs-on"] !== undefined && !stringOrStringArray(record["runs-on"])) {
    return `${prefix} runs-on must be a non-empty string or string array`;
  }
  const defaults = defaultsProblem(record.defaults);
  if (defaults !== undefined) return `${prefix} ${defaults}`;
  if (record.env !== undefined) {
    const environment = scalarMappingProblem(record.env, `${prefix} env`);
    if (environment !== undefined) return environment;
  }
  if (record.outputs !== undefined) {
    const outputs = scalarMappingProblem(
      record.outputs,
      `${prefix} outputs`,
    );
    if (outputs !== undefined) return outputs;
  }
  if (record.environment !== undefined) {
    if (!nonEmptyString(record.environment)) {
      const environment = literalMapping(record.environment);
      if (
        environment === undefined ||
        !hasOnlyKeys(environment, ["name", "url"]) ||
        !nonEmptyString(environment.name) ||
        (environment.url !== undefined && !nonEmptyString(environment.url))
      ) {
        return `${prefix} environment must be a string or literal name/url mapping`;
      }
    }
  }
  if (record.strategy !== undefined) {
    const strategy = literalMapping(record.strategy);
    if (
      strategy === undefined ||
      !hasOnlyKeys(strategy, ["fail-fast", "matrix", "max-parallel"]) ||
      (strategy["fail-fast"] !== undefined &&
        !conditionValue(strategy["fail-fast"])) ||
      (strategy["max-parallel"] !== undefined &&
        !timeoutValue(strategy["max-parallel"])) ||
      (strategy.matrix !== undefined &&
        literalMapping(strategy.matrix) === undefined)
    ) {
      return `${prefix} strategy contains invalid field values`;
    }
  }
  if (record.container !== undefined) {
    const container = containerSchemaProblem(
      record.container,
      `${prefix} container`,
    );
    if (container !== undefined) return container;
  }
  if (record.services !== undefined) {
    const services = literalMapping(record.services);
    if (services === undefined) return `${prefix} services must be a literal mapping`;
    for (const [name, service] of Object.entries(services)) {
      const serviceProblem = containerSchemaProblem(
        service,
        `${prefix} service '${name}'`,
      );
      if (serviceProblem !== undefined) return serviceProblem;
    }
  }
  return undefined;
}

function ciStepShapeProblem(
  step: unknown,
  index: number,
): string | undefined {
  const record = literalMapping(step);
  const prefix = `step ${index + 1}`;
  if (record === undefined) return `${prefix} is not a literal mapping`;
  const hasRun = Object.hasOwn(record, "run");
  const hasUses = Object.hasOwn(record, "uses");
  if (hasRun === hasUses) {
    return `${prefix} must declare exactly one of run or uses`;
  }
  const commonProblem = commonStepFieldProblem(record, prefix);
  if (commonProblem !== undefined) return commonProblem;
  if (hasRun) {
    if (typeof record.run !== "string" || record.run.trim() === "") {
      return `${prefix} run must be a non-empty string`;
    }
    if (Object.hasOwn(record, "with")) {
      return `${prefix} run step cannot declare with`;
    }
    if (record.shell !== undefined && !nonEmptyString(record.shell)) {
      return `${prefix} shell must be a non-empty string`;
    }
    if (
      record["working-directory"] !== undefined &&
      !nonEmptyString(record["working-directory"])
    ) {
      return `${prefix} working-directory must be a non-empty string`;
    }
    return hasOnlyKeys(record, RUN_STEP_FIELDS)
      ? undefined
      : `${prefix} run step contains unsupported fields`;
  }
  if (typeof record.uses !== "string" || record.uses.trim() === "") {
    return `${prefix} uses must be a non-empty string`;
  }
  if (
    Object.hasOwn(record, "shell") ||
    Object.hasOwn(record, "working-directory")
  ) {
    return `${prefix} uses step cannot declare shell or working-directory`;
  }
  if (!hasOnlyKeys(record, USES_STEP_FIELDS)) {
    return `${prefix} uses step contains unsupported fields`;
  }
  return record.with === undefined
    ? undefined
    : scalarMappingProblem(record.with, `${prefix} with`);
}

function ciJobShapeProblem(
  key: string,
  job: unknown,
): string | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
    return `job '${key}' has an invalid identifier`;
  }
  const record = literalMapping(job);
  if (record === undefined) return `job '${key}' is not a literal mapping`;
  const commonProblem = commonJobFieldProblem(record, `job '${key}'`);
  if (commonProblem !== undefined) return commonProblem;
  if (Object.hasOwn(record, "uses")) {
    if (typeof record.uses !== "string" || record.uses.trim() === "") {
      return `job '${key}' uses must be a non-empty string`;
    }
    if (!hasOnlyKeys(record, REUSABLE_JOB_FIELDS)) {
      return `job '${key}' reusable-workflow form cannot declare local execution fields`;
    }
    const reusableFields = localJobFieldProblem(record, `job '${key}'`);
    if (reusableFields !== undefined) return reusableFields;
    if (record.with !== undefined) {
      const withProblem = scalarMappingProblem(
        record.with,
        `job '${key}' with`,
      );
      if (withProblem !== undefined) return withProblem;
    }
    return record.secrets === undefined || record.secrets === "inherit"
      ? undefined
      : scalarMappingProblem(record.secrets, `job '${key}' secrets`);
  }
  if (!hasOnlyKeys(record, LOCAL_JOB_FIELDS)) {
    return `job '${key}' local-execution form contains unsupported fields`;
  }
  if (!Object.hasOwn(record, "runs-on")) {
    return `job '${key}' local-execution form is missing runs-on`;
  }
  const localFields = localJobFieldProblem(record, `job '${key}'`);
  if (localFields !== undefined) return localFields;
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    return `job '${key}' local-execution form requires non-empty steps`;
  }
  const stepProblem = record.steps
    .map(ciStepShapeProblem)
    .find((problem) => problem !== undefined);
  return stepProblem === undefined
    ? undefined
    : `job '${key}' ${stepProblem}`;
}

export function ciWorkflowShapeProblem(
  workflow: unknown,
): string | undefined {
  const record = literalMapping(workflow);
  if (record === undefined) return "workflow is not a literal mapping";
  if (!hasOnlyKeys(record, WORKFLOW_FIELDS)) {
    return "workflow contains unsupported fields";
  }
  if (record.name !== undefined && !nonEmptyString(record.name)) {
    return "workflow name must be a non-empty string";
  }
  if (record["run-name"] !== undefined && !nonEmptyString(record["run-name"])) {
    return "workflow run-name must be a non-empty string";
  }
  const permissionProblem = permissionsProblem(record.permissions);
  if (permissionProblem !== undefined) return `workflow ${permissionProblem}`;
  const defaults = defaultsProblem(record.defaults);
  if (defaults !== undefined) return `workflow ${defaults}`;
  const concurrency = concurrencyProblem(record.concurrency);
  if (concurrency !== undefined) return `workflow ${concurrency}`;
  if (record.env !== undefined) {
    const environment = scalarMappingProblem(record.env, "workflow env");
    if (environment !== undefined) return environment;
  }
  const declared = literalMapping(record.jobs);
  if (declared === undefined) return "workflow jobs must be a literal mapping";
  return Object.entries(declared)
    .map(([key, job]) => ciJobShapeProblem(key, job))
    .find((problem) => problem !== undefined);
}
