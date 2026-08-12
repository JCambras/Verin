/**
 * Typed load/bind failures for the domain-configuration system (v3 prompt 10,
 * ADR-0057). Loading is TOTAL: every rejection is a value, never a throw, so a
 * malformed configuration file cannot become an unenveloped 500 (charter #2,
 * the no-bare-throw fence).
 *
 * The code vocabulary is the seven ordered load stages plus firm binding, so a
 * caller can tell "this document is not inert" from "this firm does not supply
 * that approval template" without parsing prose.
 *
 * AND NO PROSE RENDERING LIVES HERE (D-244). The accumulator is a list of typed
 * faults; the one consumer that flattened it into a sentence put dotted document
 * paths into an `AppError` message the e-sign webhook returns verbatim to the
 * EXTERNAL provider. A fault reaches an operator as REGISTERED STRUCTURED VALUES
 * (`configCode`, `configPath`, `configPathLimit`) on the log line the correlation id joins
 * to, which is also the only shape this repository's log formatter carries.
 *
 * `ConfiguredRefusal` below is the ONE conversion from a fault to an `AppError`,
 * and it lives here for the same reason: what a fault BECOMES is a fact about the
 * fault, not about whichever module found it.
 */
import type { AppError } from "@contracts/errors";

export const DOMAIN_CONFIG_ERROR_CODES = [
  /** Stage 1: the document uses YAML machinery that is not inert data. */
  "not-inert",
  /** Stage 2: the document does not parse against the schema. */
  "grammar",
  /** Stage 3: a name is not present in the vocabulary it must close over. */
  "unknown-reference",
  /** Stage 4: a declared type cannot be used the way the document uses it. */
  "type-mismatch",
  /** Stage 5: the document parses and closes but contradicts itself. */
  "incoherent",
  /** Stage 6: an emittable code has no copy, or copy names no code. */
  "incomplete",
  /** Stage 7: version identity, catalog agreement, or authorship provenance. */
  "identity",
  /** Binding: the firm does not supply something the document references. */
  "firm-binding",
] as const;

export type DomainConfigErrorCode = (typeof DOMAIN_CONFIG_ERROR_CODES)[number];

/**
 * HOW DEEP A CONFIGURED VALUE GRAPH MAY NEST - the ONE bound the fault-path
 * channel and its emitter both read.
 *
 * A fault's `path` is the operator's only statement of WHERE, and the channel it
 * travels admits a declared SHAPE (`configPath` in `domain/observability`), so a
 * path the emitter can build and the shape cannot express degrades to
 * "[REDACTED]" - a stage reported with its location censored, which is the dead
 * diagnosis channel D-242 exists to prevent.
 *
 * Every other emitted path is bounded by the SCHEMA: the document's own sections
 * nest a fixed number of levels. One is not. A primitive's `parameters` value is
 * OPAQUE to this schema by design (the primitive's own schema judges it), so the
 * walk that substitutes deferred references there descends once per array or
 * object level of a graph the document authors freely, appending a segment or a
 * subscript each time.
 *
 * So the bound is stated HERE, once, and applied at BOTH ends: the loader refuses
 * a parameter graph nested deeper than this at admission (`resolveParameters`),
 * and the diagnosis shape derives its per-segment subscript cap from this same
 * constant. Bounding admission once is what keeps the two from being two
 * opinions - the shape is a CONSEQUENCE of the bound rather than a second guess
 * at it, which is the mistake that shipped twice (D-246).
 *
 * Raising it is a deliberate edit here; the shape follows automatically.
 */
export const MAX_CONFIGURED_VALUE_DEPTH = 8;

/**
 * HOW MANY CHARACTERS ONE CONFIGURATION DIAGNOSIS VALUE MAY CARRY, and ONE SEGMENT
 * of a dotted document path - the complete statement of what the operator's
 * `configPath` channel can express, stated HERE because this is where the emitter
 * that must respect it lives.
 *
 * Schema keys are legitimately camelCase, so the person-name shape the observability
 * module keys on would refuse `execution.planTemplates`; the closed alphabet (no
 * whitespace, no punctuation beyond `.`/`_`/`-`/subscripts) is what makes a value
 * of any length incapable of carrying prose or a person's name into a log line.
 * The subscript cap is `MAX_CONFIGURED_VALUE_DEPTH` above - the bound the deepest
 * emitter is REFUSED at - so the shape cannot be narrower than its emitter without
 * the loader having admitted a graph it declared inadmissible.
 *
 * IT LIVES BESIDE `configError` BECAUSE THE EMITTER READS IT (D-250). Twice this
 * shape was widened by GUESSING at what the emitters produce, and both guesses were
 * wrong in the same direction: a path the emitter builds and the shape cannot
 * express degrades to "[REDACTED]" - a stage reported with its location censored,
 * which is the dead diagnosis channel D-242 exists to prevent - and NOTHING fails.
 * The last guess still missed a whole class, because two emitters interpolate
 * document keys the schema does not shape at all: a primitive's `parameters` names
 * and every own key of the OPAQUE value graph under one (`z.record(z.string()…)`,
 * judged by the primitive's own schema), plus any record key a Zod `invalid_key`
 * issue reports its own path THROUGH. An author writing `parameters: { "tolerance
 * level": 0 }` refused correctly and reported nowhere.
 *
 * So the number is not an opinion about the emitters any more: `configError` - the
 * ONE constructor of every fault in the system - carries the deepest prefix of a
 * path this shape can express, and the observability channel builds its `configPath`
 * shape from these same two constants. A fault whose exact location is inexpressible
 * therefore names the deepest ADMITTED ancestor, exactly as the depth-overrun
 * refusal above does, rather than being censored whole.
 */
export const MAX_CONFIG_DIAGNOSIS_LENGTH = 128;
export const CONFIG_PATH_SEGMENT_SOURCE =
  String.raw`[A-Za-z0-9_-]{1,64}(?:\[[0-9]{1,6}\]){0,${MAX_CONFIGURED_VALUE_DEPTH}}`;
const CONFIG_PATH_SEGMENT_RE = new RegExp(`^${CONFIG_PATH_SEGMENT_SOURCE}$`);

/** Is this ONE name a segment the operator's channel can carry as itself? */
const isCarriableConfigSegment = (segment: string): boolean =>
  CONFIG_PATH_SEGMENT_RE.test(segment);

/**
 * WHY A LOCATION STOPS WHERE IT DOES. TWO limits end one, and to an operator they
 * are opposite instructions: a name the channel cannot carry as one segment is a KEY
 * TO RENAME, while a perfectly nameable key whose accumulated path outgrows the
 * ceiling is a GRAPH TO FLATTEN. Ending both by returning the parent left every
 * caller discriminating on `at === path`, which is one sentinel meaning two things -
 * so a length truncation was reported as a naming problem, and an operator sent to
 * rename an ordinary camelCase key at the ALLOWED depth (D-252).
 */
export const CONFIG_PATH_LIMITS = ["unnameable-segment", "path-too-long"] as const;
export type ConfigPathLimit = (typeof CONFIG_PATH_LIMITS)[number];

/**
 * A LOCATION AND WHY IT STOPS WHERE IT DOES, AS ONE VALUE THAT CANNOT BE SEPARATED
 * (D-253).
 *
 * `path` is always a location the channel can carry, because the only ways to build
 * one are the steps below and they start at the root. `carried: false` is the whole
 * statement that it is an ANCESTOR of the node the emitter meant, and it names the
 * limit that ended it; `carried: true` means the path IS the node.
 *
 * The invariant lives in the type because it kept escaping convention. A builder that
 * returned a bare string dropped the limit it had just computed, and the constructor
 * re-walking that already-carriable string concluded "complete" - so the loader's most
 * common failure, the grammar stage, reported a TRUNCATED location as an exact one.
 * Travelling together is what makes `limit: undefined` mean complete and nothing else.
 */
export type ConfigPath =
  | { readonly carried: true; readonly path: string }
  | { readonly carried: false; readonly path: string; readonly limit: ConfigPathLimit };

const CONFIG_PATH_ROOT: ConfigPath = { carried: true, path: "" };

/** Whichever limit a joined location hit, or the location itself. */
const admitConfigPath = (parent: ConfigPath, joined: string, segment: string): ConfigPath => {
  if (!isCarriableConfigSegment(segment)) {
    return { carried: false, path: parent.path, limit: "unnameable-segment" };
  }
  return joined.length <= MAX_CONFIG_DIAGNOSIS_LENGTH
    ? { carried: true, path: joined }
    : { carried: false, path: parent.path, limit: "path-too-long" };
};

/**
 * One step deeper into a location, or the deepest carriable prefix and the limit
 * that ended it. The caller that appends an author-chosen key uses this and REFUSES
 * rather than descending past it, so a fault below an unreportable key is reported
 * at the deepest node that can be named instead of at a fabricated one. A location
 * that already stopped stays stopped: there is nothing below an ancestor to name.
 *
 * A key carrying a `.` is not one segment: reporting `presentation.copy.slots` +
 * `"Household.Name"` joined would SHAPE perfectly and address a node the document
 * does not contain, and an operator cannot tell a confidently wrong location from a
 * right one (the same failure `presentation.form.fields.<trigger field>` was).
 */
export const childConfigPath = (parent: ConfigPath, key: string): ConfigPath => {
  if (!parent.carried) return parent;
  return admitConfigPath(parent, parent.path === "" ? key : `${parent.path}.${key}`, key);
};

/**
 * One LIST POSITION deeper, under the SAME ceiling as a key (D-253). A subscript
 * EXTENDS the last segment rather than adding one, so it is admitted by re-reading
 * that segment - which is what keeps the subscript cap and the length ceiling one
 * rule for both container kinds. Enforcing the ceiling for keys and not for
 * positions gave two identical overruns opposite verdicts, and left the walk that
 * appends subscripts leaning on an admission that never covered them.
 */
export const childConfigSubscript = (parent: ConfigPath, index: number): ConfigPath => {
  if (!parent.carried) return parent;
  const joined = `${parent.path}[${index}]`;
  return admitConfigPath(parent, joined, joined.slice(joined.lastIndexOf(".") + 1));
};

/**
 * The deepest prefix of a location the channel can carry, built from SEGMENTS -
 * which is the only way the two halves of an author's key can be told apart - and
 * the limit that ended it. ONE step rule, applied here and at every emitter that
 * descends, so a second copy cannot come to a different verdict.
 */
export const configPathFrom = (
  segments: readonly string[],
  under: ConfigPath = CONFIG_PATH_ROOT,
): ConfigPath => segments.reduce<ConfigPath>((at, segment) => childConfigPath(at, segment), under);

/**
 * The deepest prefix of an already-joined dotted path the channel can carry, and the
 * limit that ended it. A root-level fault has no path at all and keeps the empty
 * string, which the source adapter omits rather than reporting - an absent location
 * and a censored one are different facts (D-242).
 */
export const configPathOfText = (path: string): ConfigPath =>
  path === "" ? CONFIG_PATH_ROOT : configPathFrom(path.split("."));

export const carriableConfigPath = (path: string): string => configPathOfText(path).path;

export type DomainConfigError = {
  readonly code: DomainConfigErrorCode;
  /** Dotted document path (`intents.open-account.slots.email`), never a line offset. */
  readonly path: string;
  readonly message: string;
  /**
   * Present exactly when `path` is the deepest ancestor the channel could carry
   * rather than the exact node, naming WHICH limit ended it. Absent means the path
   * IS the location, so an operator never has to infer truncation from its shape.
   */
  readonly limit?: ConfigPathLimit;
};

/**
 * THE ONE CONSTRUCTOR OF EVERY FAULT. It carries only what the channel can express,
 * and when that is less than it was asked to report it says so.
 *
 * THERE IS NO LIMIT ARGUMENT (D-253). An emitter that descended states where it
 * stopped by handing over the `ConfigPath` it stopped at - path and limit together,
 * so neither can be dropped, re-derived, or overridden by the other. One handing
 * over a raw dotted path knows no limit, so this truncation owns the one it hits.
 */
export const configError = (
  code: DomainConfigErrorCode,
  at: string | ConfigPath,
  message: string,
): DomainConfigError => {
  const located = typeof at === "string" ? configPathOfText(at) : at;
  return located.carried
    ? { code, path: located.path, message }
    : { code, path: located.path, message, limit: located.limit };
};

/**
 * THE PORT EVERY CONFIGURATION REFUSAL IS MINTED THROUGH (D-244).
 *
 * Classifying a refusal by its CAUSE (D-241) only holds if the classification is a
 * MECHANISM. Marking each mint `operatorRecoverable` by hand was a convention:
 * nine refusals across the plan compiler, the intake view and the composition root
 * each said the same thing in their own words, so the wire got a server error with
 * nothing to quote, the external e-sign provider got the intent, capability, slot
 * and trigger-field ids verbatim, the operator got no line at all - and the tenth
 * author would have written a tenth variant.
 *
 * So a configuration module does not MINT. It states the typed fault it found and
 * this port turns it into the one refusal shape: a generic sentence carrying a
 * correlation id on the wire, the diagnosis as registered structured values on the
 * operator's line under that same id. Pure domain code reaches no logger, which is
 * why the mint lives behind a port rather than in the module that found the fault.
 *
 * The arms are the STAGES an operator queries by, not call sites, and each is
 * operator-recoverable by construction.
 */
export interface ConfiguredRefusal {
  /** No runnable plan: an undeclared intent, capability or plan order, an
   * unresolvable source, or a command type this build has no adapter for. */
  uncompilable(fault: DomainConfigError): AppError;
  /** A compiled step could not be PREPARED against the execution it is running:
   * an unresolved key segment or payload field, an adapter that published nothing. */
  unrunnableStep(fault: DomainConfigError): AppError;
  /** The declared intake fields and this deployment's fixed shape disagree - a
   * declared field it cannot carry, or a field it requires the document dropped. */
  intakeMismatch(fault: DomainConfigError): AppError;
  /** A surface renders a label the published document declares no copy for. The
   * document loaded and bound; it simply does not say the words, and a surface
   * that invented them would be showing a firm vocabulary nobody configured. */
  undeclaredCopy(fault: DomainConfigError): AppError;
}
