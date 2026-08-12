/**
 * THE DOMAIN-CONFIGURATION SOURCE (v3 prompt 10; ADR-0057) - the one adapter
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
import { operatorRecoverable } from "@contracts/client-retry";
import { err, ok, type Result } from "@contracts/result";
import {
  configurationDiagnosisId,
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
import type {
  ConfiguredRefusal,
  DomainConfigError,
  DomainConfigErrorCode,
} from "@domain/config/errors";
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
 * ONE parse, judged and converted (D-240).
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
 * WHAT A REFUSAL STATES TO THE OPERATOR - as STRUCTURE, because this repository
 * has no prose channel (D-242). Every field is optional: a stage that never reads
 * the pin file has no hashes to report, and reporting an absent one as an empty
 * string would be a fact it does not have.
 */
interface ConfigurationDiagnosis {
  /**
   * The dotted document path the loader accumulated FIRST, in document order.
   * ABSENT and CENSORED are different facts: a root-level failure ("not-inert" on
   * a document that is not a record, a schema issue at the document root) carries
   * no path at all, and sealing its empty string would have printed the very
   * "[REDACTED]" an operator reads as "a value was withheld for safety".
   */
  readonly path?: string;
  /** WHICH of the loader's eight faults it is - the most diagnostic single bit. */
  readonly code?: DomainConfigErrorCode;
  readonly version?: string;
  readonly pinnedHash?: string;
  readonly readHash?: string;
}

/**
 * EVERY refusal this adapter can produce, minted in ONE place (D-240/D-242).
 *
 * The DIAGNOSIS - which document, which stage, which dotted path, the pinned and
 * read SHA-256 hashes, the version id - is deployment internals, and `toResponse`
 * returns an `AppError`'s message verbatim to whoever asked. It reached a browser
 * through the intake route and an EXTERNAL e-sign provider through the webhook's
 * JSON body. So the message on the wire is one generic sentence carrying a
 * CORRELATION ID, and the diagnosis goes to the operator's log line under that
 * same id.
 *
 * IT GOES THERE AS REGISTERED VALUES, NOT AS PROSE. The first attempt routed a
 * formatted `detail` string into `AppError.context`, which nothing reads and which
 * the log formatter would have censored anyway: the observability vocabulary
 * admits registered enums and sealed ids precisely so an unregistered value
 * degrades to "[REDACTED]", and that is a safety property rather than an obstacle.
 * Structured is also the better artifact - an operator can ask for every refusal at
 * a given stage for a given document, which free text could never answer.
 */
const configurationRefusal = (
  domainConfigId: string,
  stage: ConfigurationStage,
  diagnosis: ConfigurationDiagnosis = {},
): AppError => {
  const correlationId = generatedObservabilityId("correlationId", randomUUID());
  const { path, code, version, pinnedHash, readHash } = diagnosis;
  // Each mint names its field as a LITERAL: the observability fence derives the
  // id vocabulary from exactly that argument, so routing these through a helper
  // that forwards the field would leave the whole diagnosis underivable.
  log.error({
    correlationId,
    configStage: stage,
    configCode: code,
    domainConfigId: configurationDiagnosisId("domainConfigId", domainConfigId),
    configPath: path === undefined ? undefined : configurationDiagnosisId("configPath", path),
    configVersion: version === undefined ? undefined : configurationDiagnosisId("configVersion", version),
    configHashPinned: pinnedHash === undefined ? undefined : configurationDiagnosisId("configHashPinned", pinnedHash),
    configHashRead: readHash === undefined ? undefined : configurationDiagnosisId("configHashRead", readHash),
  }, "domain configuration could not be resolved");
  return operatorRecoverable(appError(
    "INTERNAL",
    `This deployment's published configuration could not be resolved, so nothing can be started until an operator repairs it. Quote reference ${correlationId.value}.`,
    { stage, correlationId: correlationId.value },
  ));
};

const readVersionPins = (domainConfigId: string): Result<readonly VersionPin[], AppError> => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(projectPath("versions.json"), "utf8"));
    const versions = (parsed as { readonly versions?: readonly VersionPin[] }).versions;
    return Array.isArray(versions)
      ? ok(versions)
      : err(configurationRefusal(domainConfigId, "malformed-pins"));
  } catch {
    return err(configurationRefusal(domainConfigId, "unreadable-pins"));
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
    return err(configurationRefusal(domainConfigId, "unpublished"));
  }
  let text: string;
  try {
    text = readFileSync(projectPath(`${domainConfigId}.yaml`), "utf8");
  } catch {
    return err(configurationRefusal(domainConfigId, "unpublished"));
  }
  const inert = readInertConfiguration(text);
  if (inert.problems.length > 0) {
    return err(configurationRefusal(domainConfigId, "not-inert"));
  }
  const loaded = loadDomainConfig(inert.data);
  if (!loaded.ok) {
    return err(configurationRefusal(domainConfigId, "invalid", firstFault(loaded.error)));
  }
  const canonical = canonicalConfigJson(loaded.value.document);
  if (!canonical.ok) {
    return err(configurationRefusal(domainConfigId, "uncanonical", {
      version: loaded.value.domainConfigVersionId,
    }));
  }
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
      configurationRefusal(domainConfigId, "unpinned", {
        version: loaded.value.domainConfigVersionId,
        readHash: configHash,
      }),
    );
  }
  if (pin.configHash !== configHash) {
    return err(
      configurationRefusal(domainConfigId, "hash-mismatch", {
        version: loaded.value.domainConfigVersionId,
        pinnedHash: pin.configHash,
        readHash: configHash,
      }),
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

/**
 * The fault an operator is sent to FIRST. The loader accumulates the whole failure
 * surface in document order, so the earliest entry is the one to read first - and
 * a single sealed id is the only shape the log channel carries, which is why this
 * is a choice rather than a list.
 *
 * An EMPTY path is omitted rather than reported: `loadDomainConfig` emits one for
 * a document that is not a plain record, and a schema issue at the document root
 * joins to one too. Passing that through would seal "[REDACTED]" for exactly the
 * root-level failures, and an operator cannot tell a withheld value from a fact
 * the loader never had.
 */
const firstFault = (errors: readonly DomainConfigError[]): ConfigurationDiagnosis => {
  const first = errors[0];
  if (first === undefined) return {};
  return first.path === "" ? { code: first.code } : { path: first.path, code: first.code };
};

/**
 * THE MINT EVERY REFUSAL OUTSIDE THIS FILE'S OWN LOAD STAGES COMES THROUGH
 * (v3 prompt 10, D-244).
 *
 * The plan compiler and the intake view are domain code and cannot reach a
 * logger, and the composition root's own compile checks had no reason to say it
 * differently - so all three state a typed fault and this adapter, the one place
 * every configuration refusal is minted, turns it into the same
 * generic-sentence-plus-reference on the wire and the same registered diagnosis
 * on the operator's line as every load stage above.
 *
 * Nine refusals used to mark themselves `operatorRecoverable` and write their own
 * sentence, each interpolating the intent, capability, slot or trigger-field id
 * the fault concerned: the browser got a bare server error with nothing to quote,
 * the external e-sign provider got the ids verbatim, and the operator got no line
 * at all. A classification nine authors apply by hand is a convention, and the
 * tenth author would have written a tenth variant.
 */
export const configuredRefusal = (domainConfigId: string): ConfiguredRefusal => ({
  uncompilable: (fault) => configurationRefusal(domainConfigId, "uncompilable", firstFault([fault])),
  unrunnableStep: (fault) => configurationRefusal(domainConfigId, "unrunnable-step", firstFault([fault])),
  intakeMismatch: (fault) => configurationRefusal(domainConfigId, "intake-mismatch", firstFault([fault])),
});

/**
 * PROJECTIONS FOR SURFACES. A screen asks for the shape it renders, never for
 * the configuration document: `IntakeForm` and `DomainLabels` are small,
 * hand-written types, so the app layer neither names nor type-resolves the
 * schema's very large inferred graph (D-206).
 */
export const loadIntakeForm = (domainConfigId: string): Result<IntakeForm, AppError> => {
  const sourced = loadPublishedDomainConfig(domainConfigId);
  if (!sourced.ok) return sourced;
  const form = intakeFormOf(sourced.value.config);
  return form.ok
    ? ok(form.value)
    : err(configurationRefusal(domainConfigId, "no-intake-form", {
      ...firstFault(form.error),
      version: sourced.value.config.domainConfigVersionId,
    }));
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
    : err(configurationRefusal(domainConfigId, "unbindable", {
      ...firstFault(bound.error),
      version: sourced.value.config.domainConfigVersionId,
    }));
};
