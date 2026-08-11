/**
 * Typed load/bind failures for the domain-configuration system (v3 prompt 10,
 * ADR-0056). Loading is TOTAL: every rejection is a value, never a throw, so a
 * malformed configuration file cannot become an unenveloped 500 (charter #2,
 * the no-bare-throw fence).
 *
 * The code vocabulary is the seven ordered load stages plus firm binding, so a
 * caller can tell "this document is not inert" from "this firm does not supply
 * that approval template" without parsing prose.
 */

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

/** Accumulator: an author sees the whole failure surface at once, as prompt 9's loader does. */

export const formatDomainConfigErrors = (
  errors: readonly DomainConfigError[],
): string =>
  errors.map((error) => `${error.code} at ${error.path}: ${error.message}`).join("; ");
