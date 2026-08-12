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
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LineCounter, parseDocument, visit } from "yaml";
import { appError, type AppError } from "@contracts/errors";
import { err, ok, type Result } from "@contracts/result";
import {
  generatedObservabilityId,
  type ConfigurationStage,
} from "@domain/observability/safe-values";
import { log } from "@infra/observability/logger";
import {
  bindDomainConfig,
  requiredFirmClasses,
  type FirmRegistry,
  type RequiredFirmClasses,
} from "@domain/config/bind";
import { canonicalConfigJson } from "@domain/config/document";
import { intakeFormOf } from "@domain/config/intake";
import type { IntakeForm } from "@domain/config/intake-view";
import { domainLabelsOf, type DomainLabels } from "@domain/config/labels";
import { loadDomainConfig, type LoadedDomainConfig } from "@domain/config/load";
import { formatDomainConfigErrors, type DomainConfigError } from "@domain/config/errors";
import { KEBAB_CASE_RE } from "@domain/config/vocabulary";

/**
 * Where the published domain configurations live, relative to the project root.
 * UNEXPORTED: an exported constant holding this path is a second way to name the
 * directory, and a module importing it would read `config/domains/` with the path
 * appearing nowhere in its own text. The fence resolves the binding by SYMBOL so
 * that evasion fails the build, but the export had exactly one consumer - this
 * module - so the smaller surface is the honest one.
 */
const DOMAIN_CONFIG_DIRECTORY = "config/domains";

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

/**
 * ONE parse, judged and converted (D-227).
 *
 * `problems` is empty exactly when the bytes are inert; `data` is what those SAME
 * bytes convert to. Judging the text and converting it through two independent
 * `parseDocument` calls left the inertness verdict standing for a document that
 * was never the one loaded - true today, and separable the moment the two call
 * sites' options diverge.
 */
interface InertConfiguration {
  readonly problems: readonly string[];
  /** The plain data the judged Document converts to; `null` when it was refused. */
  readonly data: unknown;
}

const readInertConfiguration = (text: string): InertConfiguration => {
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
  // Converted from the DOCUMENT the walk above just judged, never from a second
  // parse of the same text - and only once that walk found nothing, so a document
  // whose own parse errors are among the problems is never converted.
  return { problems, data: problems.length > 0 ? null : (document.toJS() as unknown) };
};

/**
 * Tags, anchors, aliases, and merge keys - the four ways YAML stops being data.
 *
 * EXPORTED so the domain-configuration fence proves THIS implementation refuses
 * them, rather than proving the shipped documents are inert according to a
 * second copy of the rule: a copy would keep reading green after `merge: false`
 * flipped or this walk was deleted here, which is detection standing in for
 * verification (charter #2). The verdict is all the fence needs; the DATA half
 * stays unexported so this adapter's public surface carries no `unknown`.
 */
export const inertnessProblems = (text: string): readonly string[] =>
  readInertConfiguration(text).problems;

/**
 * EVERY refusal this adapter can produce, minted in ONE place (D-227).
 *
 * The DIAGNOSIS - dotted document paths, per-stage loader messages, the pinned
 * and read SHA-256 hashes, the version id - is deployment internals, and
 * `toResponse` returns an `AppError`'s message verbatim to whoever asked. It
 * reached a browser through the intake route and an EXTERNAL e-sign provider
 * through the webhook's JSON body. So the message on the wire is one generic
 * sentence carrying a CORRELATION ID, the diagnosis goes to the operator's log
 * line under the same id, and the full text rides in `context` - which
 * `toResponse` has never returned and which is what a log sink able to carry
 * prose would read. Minting the reference through the observability id factory
 * rather than a bare uuid is what stops it degrading to "[REDACTED]" in the very
 * line it exists to join.
 */
const configurationRefusal = (
  domainConfigId: string,
  stage: ConfigurationStage,
  detail: string,
): AppError => {
  const correlationId = generatedObservabilityId("correlationId", randomUUID());
  log.error({ correlationId, configStage: stage }, "domain configuration could not be resolved");
  return appError(
    "INTERNAL",
    `This deployment's published configuration could not be resolved, so nothing can be started until an operator repairs it. Quote reference ${correlationId.value}.`,
    { domainConfigId, stage, detail, correlationId: correlationId.value },
  );
};

const readVersionPins = (domainConfigId: string): Result<readonly VersionPin[], AppError> => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(projectPath("versions.json"), "utf8"));
    const versions = (parsed as { readonly versions?: readonly VersionPin[] }).versions;
    return Array.isArray(versions)
      ? ok(versions)
      : err(configurationRefusal(domainConfigId, "unreadable-pins", "the domain-configuration version pin file is malformed"));
  } catch {
    return err(configurationRefusal(domainConfigId, "unreadable-pins", "the domain-configuration version pin file could not be read"));
  }
};

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export interface SourcedDomainConfig {
  readonly config: LoadedDomainConfig;
  readonly configHash: string;
}

const cache = new Map<string, SourcedDomainConfig>();

/**
 * A published configuration id is one closed-vocabulary kebab-case token, checked
 * BEFORE it reaches `projectPath`. Every caller passes a module constant today;
 * this is what keeps a future request-derived id from naming a file outside the
 * configuration directory, the same guard `parseMachineRecordId` gives other
 * externally-supplied identifiers.
 */
const readOnce = (domainConfigId: string): Result<SourcedDomainConfig, AppError> => {
  if (!KEBAB_CASE_RE.test(domainConfigId)) {
    return err(configurationRefusal(domainConfigId, "unpublished", "not a published domain-configuration id"));
  }
  let text: string;
  try {
    text = readFileSync(projectPath(`${domainConfigId}.yaml`), "utf8");
  } catch {
    return err(configurationRefusal(domainConfigId, "unpublished", "no domain configuration is published under that id"));
  }
  const inert = readInertConfiguration(text);
  if (inert.problems.length > 0) {
    return err(configurationRefusal(domainConfigId, "not-inert", inert.problems.join("; ")));
  }
  const loaded = loadDomainConfig(inert.data);
  if (!loaded.ok) {
    return err(configurationRefusal(domainConfigId, "invalid", formatDomainConfigErrors(loaded.error)));
  }
  const canonical = canonicalConfigJson(loaded.value.document);
  if (!canonical.ok) return err(configurationRefusal(domainConfigId, "uncanonical", canonical.error.message));
  const configHash = sha256(canonical.value);
  const pins = readVersionPins(domainConfigId);
  if (!pins.ok) return err(pins.error);
  const pin = pins.value.find(
    (candidate) =>
      candidate.domainConfigId === loaded.value.document.domainConfigId &&
      candidate.version === loaded.value.document.version,
  );
  if (pin === undefined) {
    return err(
      configurationRefusal(
        domainConfigId,
        "unpinned",
        `version ${loaded.value.domainConfigVersionId} is not a published domain-configuration version`,
      ),
    );
  }
  if (pin.configHash !== configHash) {
    return err(
      configurationRefusal(
        domainConfigId,
        "hash-mismatch",
        `version ${loaded.value.domainConfigVersionId} changed without a version bump (pinned ${pin.configHash}, read ${configHash})`,
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
  stage: ConfigurationStage,
  what: string,
  errors: readonly DomainConfigError[],
): AppError =>
  configurationRefusal(domainConfigId, stage, `${what}: ${formatDomainConfigErrors(errors)}`);

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
  return form.ok
    ? ok(form.value)
    : err(configFailure(domainConfigId, "invalid", "declares no usable intake form", form.error));
};

/**
 * What a firm must supply for one published document to bind, READ FROM THAT
 * DOCUMENT. A surface builds its registry from this rather than transcribing the
 * document's classes into a literal, so adding a capability, an approval
 * template or a supplier role is a configuration edit rather than a runtime
 * binding refusal on a screen that has no way to recover from one.
 */
export const loadFirmClasses = (domainConfigId: string): Result<RequiredFirmClasses, AppError> => {
  const sourced = loadPublishedDomainConfig(domainConfigId);
  return sourced.ok ? ok(requiredFirmClasses(sourced.value.config)) : err(sourced.error);
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
    : err(configFailure(domainConfigId, "unbindable", `could not bind for ${firm.firmId}`, bound.error));
};
