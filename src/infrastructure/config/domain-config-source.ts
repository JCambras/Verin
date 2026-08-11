/**
 * THE DOMAIN-CONFIGURATION SOURCE (v3 prompt 10; ADR-0056) - the one adapter
 * that reads `config/domains/*.yaml`.
 *
 * v3 §16 says no module imports `config/`. Nothing does: this adapter READS the
 * directory as data at run time, and the dependency-rule fence proves it is the
 * only module that names that path. That is the same single-allowed-module
 * shape `no-process-env` already uses for the environment.
 *
 * Three responsibilities, in order:
 *  1. INERTNESS - a document with a tag, an anchor, an alias, or a merge key is
 *     refused before it becomes data. Those are the YAML features that turn a
 *     configuration file into a program.
 *  2. IDENTITY - the SHA-256 over the loaded document's canonical bytes must
 *     equal the hash `config/domains/versions.json` pins for that published
 *     version. Editing a published document without bumping its version fails
 *     the read, exactly as the arch-version doc pins already work for the
 *     ratified architecture.
 *  3. LOADING - the pure seven-stage loader judges the content.
 *
 * SUCCESSFUL results are memoized per domain id because a published version is
 * immutable by construction; a changed file is a different version, and a
 * deployment restarts to pick one up. A FAILURE is never cached: that
 * justification does not cover a transient read (an EMFILE under load, a
 * momentary ENOENT while a deploy replaces the file), and caching one would
 * disable the configured flow for the life of the process.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LineCounter, parseDocument, visit } from "yaml";
import { appError, type AppError } from "@contracts/errors";
import { err, ok, type Result } from "@contracts/result";
import { bindDomainConfig, type FirmRegistry } from "@domain/config/bind";
import { canonicalConfigJson } from "@domain/config/document";
import { intakeFormOf } from "@domain/config/intake";
import type { IntakeForm } from "@domain/config/intake-view";
import { domainLabelsOf, type DomainLabels } from "@domain/config/labels";
import { loadDomainConfig, type LoadedDomainConfig } from "@domain/config/load";
import { formatDomainConfigErrors, type DomainConfigError } from "@domain/config/errors";

/** Where the published domain configurations live, relative to the project root. */
export const DOMAIN_CONFIG_DIRECTORY = "config/domains";

/**
 * The published configuration the shipped `/app/account-opening` journey runs.
 * It lives HERE, beside the source that resolves it, so a server component can
 * name the document it renders without pulling the composition root (store,
 * house-CRM, e-sign, audit, tracer) into its module graph.
 */
export const ACCOUNT_OPENING_DOMAIN = "account-opening";

type VersionPin = {
  readonly domainConfigId: string;
  readonly version: string;
  readonly configHash: string;
};

/**
 * The configuration directory, resolved from the project root. Written as a
 * STATICALLY SCOPED join (a literal subfolder, then the file) because the
 * bundler traces filesystem access: a fully dynamic `join(cwd(), ...segments)`
 * makes it trace the whole project into the server output, which fails the
 * production build outright.
 */
const projectPath = (file: string): string =>
  join(process.cwd(), DOMAIN_CONFIG_DIRECTORY, file);

/** Tags, anchors, aliases, and merge keys - the four ways YAML stops being data. */
const inertnessProblems = (text: string): readonly string[] => {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, merge: false });
  const problems: string[] = [];
  for (const problem of [...document.errors, ...document.warnings]) {
    problems.push(problem.message.split("\n")[0] ?? problem.message);
  }
  visit(document, {
    Node(_key, node) {
      const at = node.range ? lineCounter.linePos(node.range[0]).line : "?";
      if ("tag" in node && node.tag !== undefined) {
        problems.push(`line ${at}: tag "${node.tag}" - plain scalars, maps and lists only`);
      }
      if ("anchor" in node && node.anchor !== undefined) {
        problems.push(`line ${at}: anchor "${node.anchor}" - a configuration document may not reuse nodes`);
      }
    },
    Alias(_key, node) {
      const at = node.range ? lineCounter.linePos(node.range[0]).line : "?";
      problems.push(`line ${at}: alias "*${node.source}" - a configuration document may not reuse nodes`);
    },
    Pair(_key, pair) {
      const key = pair.key;
      if (typeof key === "object" && key !== null && "value" in key && key.value === "<<") {
        problems.push("merge key '<<' - a configuration document may not inherit");
      }
    },
  });
  return problems;
};

const readVersionPins = (): Result<readonly VersionPin[], AppError> => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(projectPath("versions.json"), "utf8"));
    const versions = (parsed as { readonly versions?: readonly VersionPin[] }).versions;
    return Array.isArray(versions)
      ? ok(versions)
      : err(appError("INTERNAL", "The domain-configuration version pin file is malformed."));
  } catch {
    return err(appError("INTERNAL", "The domain-configuration version pin file could not be read."));
  }
};

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export interface SourcedDomainConfig {
  readonly config: LoadedDomainConfig;
  readonly configHash: string;
}

const cache = new Map<string, SourcedDomainConfig>();

const readOnce = (domainConfigId: string): Result<SourcedDomainConfig, AppError> => {
  let text: string;
  try {
    text = readFileSync(projectPath(`${domainConfigId}.yaml`), "utf8");
  } catch {
    return err(
      appError("INTERNAL", `No domain configuration is published for "${domainConfigId}".`),
    );
  }
  const problems = inertnessProblems(text);
  if (problems.length > 0) {
    return err(appError("INTERNAL", `The "${domainConfigId}" configuration is not inert: ${problems.join("; ")}`));
  }
  const loaded = loadDomainConfig(parseDocument(text, { merge: false }).toJS() as unknown);
  if (!loaded.ok) {
    return err(
      appError("INTERNAL", `The "${domainConfigId}" configuration is invalid: ${formatDomainConfigErrors(loaded.error)}`),
    );
  }
  const canonical = canonicalConfigJson(loaded.value.document);
  if (!canonical.ok) return err(canonical.error);
  const configHash = sha256(canonical.value);
  const pins = readVersionPins();
  if (!pins.ok) return err(pins.error);
  const pin = pins.value.find(
    (candidate) =>
      candidate.domainConfigId === loaded.value.document.domainConfigId &&
      candidate.version === loaded.value.document.version,
  );
  if (pin === undefined) {
    return err(
      appError("INTERNAL", `Version ${loaded.value.domainConfigVersionId} is not a published domain-configuration version.`),
    );
  }
  if (pin.configHash !== configHash) {
    return err(
      appError(
        "INTERNAL",
        `Version ${loaded.value.domainConfigVersionId} changed without a version bump (pinned ${pin.configHash}, read ${configHash}).`,
      ),
    );
  }
  return ok({ config: loaded.value, configHash });
};

/**
 * The published configuration for one domain. Synchronous by design: a server
 * component renders a configured form without an await, so the demo journey and
 * the account-opening screen keep the shapes their fences already pin.
 */
export const loadPublishedDomainConfig = (
  domainConfigId: string,
): Result<SourcedDomainConfig, AppError> => {
  const cached = cache.get(domainConfigId);
  if (cached !== undefined) return ok(cached);
  const result = readOnce(domainConfigId);
  if (result.ok) cache.set(domainConfigId, result.value);
  return result;
};

const configFailure = (
  domainConfigId: string,
  what: string,
  errors: readonly DomainConfigError[],
): AppError =>
  appError("INTERNAL", `The "${domainConfigId}" configuration ${what}: ${formatDomainConfigErrors(errors)}`);

/**
 * PROJECTIONS FOR SURFACES. A screen asks for the shape it renders, never for
 * the configuration document: `IntakeForm` and `DomainLabels` are small,
 * hand-written types, so the app layer neither names nor type-resolves the
 * schema's very large inferred graph (D-193).
 */
export const loadIntakeForm = (domainConfigId: string): Result<IntakeForm, AppError> => {
  const sourced = loadPublishedDomainConfig(domainConfigId);
  if (!sourced.ok) return sourced;
  const form = intakeFormOf(sourced.value.config);
  return form.ok ? ok(form.value) : err(configFailure(domainConfigId, "declares no usable intake form", form.error));
};

/** The configured vocabulary for one firm, bound through the tenancy seam. */
export const loadDomainLabels = (
  domainConfigId: string,
  firm: FirmRegistry,
): Result<DomainLabels, AppError> => {
  const sourced = loadPublishedDomainConfig(domainConfigId);
  if (!sourced.ok) return sourced;
  const bound = bindDomainConfig(sourced.value.config, firm);
  return bound.ok
    ? ok(domainLabelsOf(bound.value))
    : err(configFailure(domainConfigId, `could not bind for ${firm.firmId}`, bound.error));
};
