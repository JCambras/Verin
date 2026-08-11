/**
 * The repo's ONE structured CI authority (ADR-0055): `parseCiJobs` reads the
 * blocking workflow through a real YAML parse plus the restricted shell read,
 * and the command-status rules decide whether a named job proves a command.
 * The registry fence, the blocking runner, and the charter-drift fence all read
 * ci.yml through this module.
 */
import { parse as parseYaml } from "yaml";
import { commandMatches, shellCommandLines, simpleShellCommand } from "./shell";
import { ciWorkflowShapeProblem } from "./ci-schema";
import {
  approvedPrerequisiteProblem,
  configuredRunShell,
  configuredRunWorkingDirectory,
  containerProblem,
  dependencyNeutralizerOf,
  environmentProblem,
  neutralizerOf,
  runnerProblem,
  shellProblem,
  strategyNeutralizerOf,
  workflowTriggerProblem,
  workingDirectoryProblem,
} from "./ci-evidence";

/** A job of the blocking workflow, as the ci-gate rules read it. */
export interface CiJob {
  /**
   * Set when the job cannot be counted on to fail the build: `continue-on-error`,
   * a conditional that may exclude it from a normal push/PR run, or a `needs`
   * dependency that can prevent it from running. A neutralized job proves nothing,
   * however correct its steps look.
   */
  neutralizedBy?: string;
  /** Dedicated simple commands whose exit status controls a non-neutralized step. */
  commands: string[];
  steps: CiStep[];
}

export interface CiStep {
  neutralizedBy?: string;
  unsupportedRunner?: string;
  unsupportedShell?: string;
  unsupportedWorkingDirectory?: string;
  unsafeEnvironment?: string;
  unsafeContainer?: string;
  unsafePredecessor?: string;
  commands: string[];
  blockingCommand?: string;
  blockingTokens?: string[];
}

export interface CiWorkflow extends Map<string, CiJob> {
  workflowProblem?: string;
}

/**
 * A ci-gate requirement is only evidence if the named job EXISTS in the blocking
 * workflow, BLOCKS the build, and RUNS the required command. A bare substring match
 * is satisfied by a comment, a path, or an unrelated step - the tautological shape
 * charter #4 rejects - so the workflow is parsed into `job key -> {what neutralizes
 * it, the commands its steps run}`.
 *
 * Structure comes from the real YAML parser, not a line scanner. A scanner cannot
 * tell a command from a sibling `env:` value or a step `name:`, and it loses every
 * job declared after a column-0 comment; both are evasions in a check that is
 * load-bearing for gate readiness (charter: fences parse, they do not
 * pattern-match). The parser drops YAML comments for free and yields the `run`
 * VALUE of each step.
 *
 * YAML is not sufficient on its own: inside a `|` block scalar a `#` is literal
 * script text, so a commented-out command is genuinely part of the run value and
 * only the SHELL treats it as disabled. `shellCommandLines` therefore strips shell
 * comments too - otherwise "# pnpm audit:chain temporarily disabled" would keep
 * proving the gate it just switched off. PRESENT-BUT-DISABLED is the whole defect
 * class here, and `continue-on-error: true` is its cheapest spelling: the command
 * still runs, its failure just stops mattering.
 *
 * Effective runner and shell selection are validated independently. Only the
 * supported POSIX hosted runners, their implicit shells, and the built-in
 * `bash` and `sh` shells are accepted; every other shape fails closed.
 */
export function parseCiJobs(yamlText: string): CiWorkflow {
  const jobs = new Map<string, CiJob>() as CiWorkflow;
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch {
    return jobs;
  }
  const activationProblem = workflowTriggerProblem(doc);
  const declared = (doc as { jobs?: unknown } | null)?.jobs;
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) return jobs;
  const declaredJobs = declared as Record<string, unknown>;
  const shapeProblem = ciWorkflowShapeProblem(doc);
  if (activationProblem !== undefined || shapeProblem !== undefined) {
    jobs.workflowProblem = activationProblem ?? shapeProblem;
  }
  const workflowShell = configuredRunShell(doc);
  const workflowDirectory = configuredRunWorkingDirectory(doc);
  for (const [key, job] of Object.entries(declaredJobs)) {
    const steps = (job as { steps?: unknown } | null)?.steps;
    const jobShell = configuredRunShell(job);
    const defaultShell = jobShell === undefined ? workflowShell : jobShell;
    const jobDirectory = configuredRunWorkingDirectory(job);
    const defaultDirectory = jobDirectory === undefined ? workflowDirectory : jobDirectory;
    const jobContainer = (job as { container?: unknown } | null)
      ?.container;
    const unsafeContainer = containerProblem(jobContainer);
    const runsOn = (job as { "runs-on"?: unknown } | null)?.["runs-on"];
    const unsupportedRunner = runnerProblem(runsOn);
    const stepList = Array.isArray(steps) ? steps : [];
    const parsedSteps = stepList.flatMap((step, index): CiStep[] => {
      const run = (step as { run?: unknown } | null)?.run;
      if (typeof run !== "string") return [];
      const stepShell = (step as { shell?: unknown } | null)?.shell;
      const effectiveShell = stepShell === undefined ? defaultShell : stepShell;
      const unsupportedShell = shellProblem(effectiveShell);
      const stepDirectory = (step as { "working-directory"?: unknown } | null)?.["working-directory"];
      const effectiveDirectory = stepDirectory === undefined ? defaultDirectory : stepDirectory;
      const unsupportedWorkingDirectory = workingDirectoryProblem(effectiveDirectory);
      const unsafeEnvironment = environmentProblem(
        doc,
        job,
        jobContainer,
        step,
      );
      const unsafePredecessor = stepList
        .slice(0, index)
        .map(approvedPrerequisiteProblem)
        .find((problem) => problem !== undefined);
      const simple =
        unsupportedRunner === undefined &&
        unsupportedShell === undefined &&
        unsupportedWorkingDirectory === undefined &&
        unsafeEnvironment === undefined
          ? simpleShellCommand(run)
          : undefined;
      return [
        {
          ...(neutralizerOf(step) === undefined ? {} : { neutralizedBy: neutralizerOf(step) }),
          ...(unsupportedRunner === undefined ? {} : { unsupportedRunner }),
          ...(unsupportedShell === undefined ? {} : { unsupportedShell }),
          ...(unsupportedWorkingDirectory === undefined ? {} : { unsupportedWorkingDirectory }),
          ...(unsafeEnvironment === undefined ? {} : { unsafeEnvironment }),
          ...(unsafeContainer === undefined ? {} : { unsafeContainer }),
          ...(unsafePredecessor === undefined ? {} : { unsafePredecessor }),
          commands: shellCommandLines(run),
          ...(simple === undefined ? {} : { blockingCommand: simple.text, blockingTokens: simple.tokens }),
        },
      ];
    });
    const commands = parsedSteps
      .filter((step) => step.neutralizedBy === undefined && step.blockingCommand !== undefined)
      .map((step) => step.blockingCommand!);
    const neutralizedBy =
      neutralizerOf(job) ??
      dependencyNeutralizerOf(job) ??
      strategyNeutralizerOf(job);
    jobs.set(key, neutralizedBy === undefined ? { commands, steps: parsedSteps } : { neutralizedBy, commands, steps: parsedSteps });
  }
  return jobs;
}

/**
 * True only when `ref` is a declared job with at least one valid executable step
 * whose failure is not neutralized.
 */
export function ciJobBlocks(jobs: Map<string, CiJob>, ref: string): boolean {
  const job = jobs.get(ref);
  return (
    (jobs as CiWorkflow).workflowProblem === undefined &&
    job !== undefined &&
    job.neutralizedBy === undefined &&
    job.steps.some(
      (step) =>
        step.neutralizedBy === undefined &&
        step.unsupportedRunner === undefined &&
        step.unsupportedShell === undefined &&
        step.unsupportedWorkingDirectory === undefined &&
        step.unsafeEnvironment === undefined &&
        step.unsafeContainer === undefined &&
        step.unsafePredecessor === undefined &&
        step.blockingCommand !== undefined,
    )
  );
}

export type CiCommandStatus =
  | { state: "proven" }
  | { state: "missing-job" }
  | { state: "invalid-command" }
  | { state: "inactive-workflow"; reason: string }
  | { state: "neutralized"; reason: string }
  | { state: "unsafe-runner"; reason: string }
  | { state: "unsafe-shell"; reason?: string }
  | { state: "unsafe-working-directory"; reason: string }
  | { state: "unsafe-environment"; reason: string }
  | { state: "unsafe-container"; reason: string }
  | { state: "unsafe-predecessor"; reason: string }
  | { state: "missing-command" };

export function ciJobCommandStatus(jobs: Map<string, CiJob>, ref: string, command: string): CiCommandStatus {
  const required = simpleShellCommand(command);
  if (required === undefined) return { state: "invalid-command" };
  const job = jobs.get(ref);
  if (job === undefined) return { state: "missing-job" };
  const workflowProblem = (jobs as CiWorkflow).workflowProblem;
  const relevant = job.steps.filter(
    (step) =>
      commandMatches(step.blockingTokens, required.tokens) ||
      step.commands.some((line) => line.includes(required.text)),
  );
  if (job.neutralizedBy !== undefined && relevant.length > 0) {
    return { state: "neutralized", reason: `job ${job.neutralizedBy}` };
  }
  const blocking = relevant.find(
    (step) =>
      step.neutralizedBy === undefined &&
      step.unsupportedRunner === undefined &&
      step.unsupportedShell === undefined &&
      step.unsupportedWorkingDirectory === undefined &&
      step.unsafeEnvironment === undefined &&
      step.unsafeContainer === undefined &&
      step.unsafePredecessor === undefined &&
      commandMatches(step.blockingTokens, required.tokens),
  );
  const neutralized = relevant.find((step) => step.neutralizedBy !== undefined);
  if (neutralized?.neutralizedBy !== undefined) {
    return { state: "neutralized", reason: `step ${neutralized.neutralizedBy}` };
  }
  const unsupportedRunner = relevant.find((step) => step.unsupportedRunner !== undefined);
  if (
    unsupportedRunner?.unsupportedRunner !== undefined &&
    unsupportedRunner.unsupportedRunner !== "missing runs-on"
  ) {
    return { state: "unsafe-runner", reason: unsupportedRunner.unsupportedRunner };
  }
  const unsafeEnvironment = relevant.find((step) => step.unsafeEnvironment !== undefined);
  if (unsafeEnvironment?.unsafeEnvironment !== undefined) {
    return { state: "unsafe-environment", reason: unsafeEnvironment.unsafeEnvironment };
  }
  if (workflowProblem !== undefined) {
    return { state: "inactive-workflow", reason: workflowProblem };
  }
  const unsupported = relevant.find((step) => step.unsupportedShell !== undefined);
  if (unsupported?.unsupportedShell !== undefined) {
    return { state: "unsafe-shell", reason: unsupported.unsupportedShell };
  }
  const wrongDirectory = relevant.find((step) => step.unsupportedWorkingDirectory !== undefined);
  if (wrongDirectory?.unsupportedWorkingDirectory !== undefined) {
    return { state: "unsafe-working-directory", reason: wrongDirectory.unsupportedWorkingDirectory };
  }
  const unsafeContainer = relevant.find(
    (step) => step.unsafeContainer !== undefined,
  );
  if (unsafeContainer?.unsafeContainer !== undefined) {
    return {
      state: "unsafe-container",
      reason: unsafeContainer.unsafeContainer,
    };
  }
  const unsafePredecessor = relevant.find(
    (step) => step.unsafePredecessor !== undefined,
  );
  if (unsafePredecessor?.unsafePredecessor !== undefined) {
    return {
      state: "unsafe-predecessor",
      reason: unsafePredecessor.unsafePredecessor,
    };
  }
  if (blocking !== undefined) return { state: "proven" };
  if (unsupportedRunner?.unsupportedRunner !== undefined) {
    return {
      state: "unsafe-runner",
      reason: unsupportedRunner.unsupportedRunner,
    };
  }
  if (relevant.length > 0) return { state: "unsafe-shell" };
  return { state: "missing-command" };
}

export function ciJobRunProblem(jobs: Map<string, CiJob>, ref: string, command: string): string | undefined {
  const status = ciJobCommandStatus(jobs, ref, command);
  switch (status.state) {
    case "proven":
      return undefined;
    case "missing-job":
      return `ci job '${ref}' is missing from the blocking workflow`;
    case "invalid-command":
      return `required command '${command}' is not a dedicated simple command`;
    case "inactive-workflow":
      return `ci workflow does not provide normal blocking evidence: ${status.reason}`;
    case "neutralized":
      return `ci job '${ref}' command '${command}' is neutralized by ${status.reason}`;
    case "unsafe-runner":
      return `ci job '${ref}' command '${command}' uses ${status.reason}`;
    case "unsafe-shell":
      return status.reason === undefined
        ? `ci job '${ref}' mentions '${command}' only in a compound or multi-command run step`
        : `ci job '${ref}' command '${command}' uses ${status.reason}`;
    case "unsafe-working-directory":
      return `ci job '${ref}' command '${command}' uses ${status.reason}`;
    case "unsafe-environment":
      return `ci job '${ref}' command '${command}' uses ${status.reason}`;
    case "unsafe-container":
      return `ci job '${ref}' command '${command}' uses ${status.reason}`;
    case "unsafe-predecessor":
      return `ci job '${ref}' command '${command}' has ${status.reason}`;
    default:
      return `ci job '${ref}' does not run '${command}' in a dedicated blocking step`;
  }
}

/** True only when `ref` is a declared, blocking job with a dedicated step whose command controls that step's exit status. */
export function ciJobRuns(jobs: Map<string, CiJob>, ref: string, command: string): boolean {
  return ciJobCommandStatus(jobs, ref, command).state === "proven";
}
