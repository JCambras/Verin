/**
 * Typed load/bind failures for the domain-configuration system (v3 prompt 10,
 * ADR-0056). Loading is TOTAL: every rejection is a value, never a throw, so a
 * malformed configuration file cannot become an unenveloped 500 (charter #2,
 * the no-bare-throw fence).
 *
 * The code vocabulary is the seven ordered load stages plus firm binding, so a
 * caller can tell "this document is not inert" from "this firm does not supply
 * that approval template" without parsing prose.
 *
 * AND NO PROSE RENDERING LIVES HERE (D-231). The accumulator is a list of typed
 * faults; the one consumer that flattened it into a sentence put dotted document
 * paths into an `AppError` message the e-sign webhook returns verbatim to the
 * EXTERNAL provider. A fault reaches an operator as REGISTERED STRUCTURED VALUES
 * (`configCode`, `configPath`) on the log line the client's correlation id joins
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
 * diagnosis channel D-229 exists to prevent.
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
 * at it, which is the mistake that shipped twice (D-233).
 *
 * Raising it is a deliberate edit here; the shape follows automatically.
 */
export const MAX_CONFIGURED_VALUE_DEPTH = 8;

export type DomainConfigError = {
  readonly code: DomainConfigErrorCode;
  /** Dotted document path (`intents.open-account.slots.email`), never a line offset. */
  readonly path: string;
  readonly message: string;
};

export const configError = (
  code: DomainConfigErrorCode,
  path: string,
  message: string,
): DomainConfigError => ({ code, path, message });

/**
 * THE PORT EVERY CONFIGURATION REFUSAL IS MINTED THROUGH (D-231).
 *
 * Classifying a refusal by its CAUSE (D-228) only holds if the classification is a
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
}
