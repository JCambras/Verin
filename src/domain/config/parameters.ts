/**
 * PRIMITIVE PARAMETER VALUES, AND THE ONE PLACE TENANCY IS DEFERRED (v3 prompt
 * 10; ADR-0056).
 *
 * A domain configuration is firm-NEUTRAL: it contains no firmId, which is what
 * makes invariant 26 ("Firm B differs only through configuration") a property
 * test rather than a promise. But several ratified primitive parameters are
 * tenant-scoped by type - `evidence-reconciliation.sourcesToReconcile` is
 * `EvidenceSourceRef[]`, and a ref carries a firmId.
 *
 * The resolution is a single closed placeholder: a parameter position that
 * needs a tenant-scoped reference carries `{ $ref: { kind, class } }`, a
 * firm-neutral CLASS name the firm registry resolves at bind time. Load-time
 * validation substitutes a reserved synthetic firm id so the whole parameter
 * object still parses against the primitive's own Zod schema - the document is
 * fully type-checked before any firm exists, and `bindDomainConfig` re-parses
 * with the firm's real references.
 *
 * A KEY-SHAPING parameter may never carry a placeholder. Those parameters are
 * the ones `publishedKeys` reads to shape the context-key vocabulary (D-184),
 * and that vocabulary must be identical for every firm or prompt 9's
 * declared-origin resolution (D-185) would close over a per-firm key space.
 */
import { z } from "zod";
import { err, ok, type Result } from "@contracts/result";
import { configError, type DomainConfigError } from "./errors";


/** The tenant-scoped reference classes a parameter position may defer. */
export const PARAMETER_REF_KINDS = ["evidence-source"] as const;

type ParameterRefKind = (typeof PARAMETER_REF_KINDS)[number];

/**
 * The ONE deferred-reference shape. Written as a type rather than a schema: a
 * placeholder is recognised STRUCTURALLY wherever it appears inside an opaque
 * parameter graph, and the primitive's own schema judges the value it resolves
 * to - so a second schema here would only be a second judge.
 */
type ParameterRef = {
  readonly $ref: {
    readonly kind: ParameterRefKind;
    readonly class: string;
  };
};

/**
 * A parameter's value is OPAQUE to this schema, and deliberately so: the
 * primitive's OWN `parameterSchema` is the authority on what its parameters may
 * be (prompt 8), and re-specifying the JSON value space here would be a second
 * judge that could disagree with the first. Inertness is established upstream -
 * the YAML adapter refuses tags, anchors, aliases and merge keys, so what
 * reaches this schema is plain data by construction - and every walk below reads
 * OWN properties only.
 */
export const ParameterMapSchema = z.record(z.string().min(1), z.unknown()).readonly();
export type ParameterMap = Readonly<Record<string, unknown>>;

const isParameterRef = (value: unknown): value is ParameterRef =>
  typeof value === "object" &&
  value !== null &&
  Object.prototype.hasOwnProperty.call(value, "$ref") &&
  Object.keys(value).length === 1;

/**
 * The reserved firm id load-time validation substitutes. It is not a legal firm
 * id anywhere else, so a document that somehow reached production carrying it
 * would fail firm binding rather than quietly act as a tenant.
 */
export const NEUTRAL_FIRM_ID = "domain-config-neutral";

export type RefResolver = (ref: ParameterRef["$ref"]) => unknown | null;

/** Substitute every placeholder through `resolve`; a `null` answer is an error. */
const substitute = (
  value: unknown,
  resolve: RefResolver,
  path: string,
  errors: DomainConfigError[],
): unknown => {
  if (isParameterRef(value)) {
    const resolved = resolve(value.$ref);
    if (resolved === null) {
      errors.push(
        configError(
          "firm-binding",
          path,
          `no ${value.$ref.kind} is registered for class ${JSON.stringify(value.$ref.class)}`,
        ),
      );
      return null;
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => substitute(entry, resolve, `${path}[${index}]`, errors));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        substitute(entry, resolve, `${path}.${key}`, errors),
      ]),
    );
  }
  return value;
};

/** Load-time resolver: every placeholder becomes a reference in the reserved neutral tenant. */
export const neutralRefResolver: RefResolver = (ref) => ({
  firmId: NEUTRAL_FIRM_ID,
  id: ref.class,
});

/** Whether a value graph contains a deferred tenant-scoped reference anywhere. */
export const containsParameterRef = (value: unknown): boolean => {
  if (isParameterRef(value)) return true;
  if (Array.isArray(value)) return value.some(containsParameterRef);
  if (typeof value === "object" && value !== null) {
    return Object.values(value as Record<string, unknown>).some(containsParameterRef);
  }
  return false;
};

/** One typed rejection from a primitive's own parameter schema. */
export type ParameterIssue = { readonly path: readonly string[]; readonly message: string };

export type ParameterParse =
  | { readonly ok: true; readonly parameters: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly issues: readonly ParameterIssue[] };

/**
 * EXACTLY what parameter resolution needs from a catalog primitive - names,
 * plus ONE callable that judges a candidate parameter object.
 *
 * It deliberately does NOT name a Zod schema type. The repo's sealed-authority
 * walk expands a parameter's type structurally, skipping members that are
 * callable and recursing into members that are not; a `z.ZodType` carries deep
 * non-callable internals, so naming one in an exported `src/domain/` signature
 * made that walk exponential and killed a fence worker outright (D-193). The
 * adapter that turns a catalog primitive into this shape therefore lives beside
 * the loader, unexported, where no signature exposes it.
 */
export type ParameterOwner = {
  readonly id: string;
  readonly keyShapingParameters: readonly string[];
  readonly declaredParameters: ReadonlySet<string>;
  readonly parseParameters: (value: unknown) => ParameterParse;
};

export type ResolvedParameters = {
  readonly raw: ParameterMap;
  readonly parsed: Readonly<Record<string, unknown>>;
};

/**
 * Resolve a binding's parameters and judge them with the primitive's OWN schema.
 * Unknown parameter names are reported before the parse so an author sees
 * "no such parameter" rather than a strict-object rejection listing every key.
 */
export const resolveParameters = (
  primitive: ParameterOwner,
  parameters: ParameterMap,
  resolve: RefResolver,
  path: string,
): Result<ResolvedParameters, readonly DomainConfigError[]> => {
  const errors: DomainConfigError[] = [];
  for (const name of Object.keys(parameters)) {
    if (!primitive.declaredParameters.has(name)) {
      errors.push(
        configError(
          "unknown-reference",
          `${path}.${name}`,
          `primitive ${primitive.id} declares no parameter named ${JSON.stringify(name)}`,
        ),
      );
    }
  }
  for (const shaping of primitive.keyShapingParameters) {
    const value = parameters[shaping];
    if (value !== undefined && containsParameterRef(value)) {
      errors.push(
        configError(
          "type-mismatch",
          `${path}.${shaping}`,
          "a key-shaping parameter may not defer a tenant-scoped reference: the published key space must be identical for every firm (D-184/D-185)",
        ),
      );
    }
  }
  if (errors.length > 0) return err(errors);
  const substituted = substitute(parameters, resolve, path, errors) as Record<string, unknown>;
  if (errors.length > 0) return err(errors);
  const parsed = primitive.parseParameters(substituted);
  if (!parsed.ok) {
    return err(
      parsed.issues.map((issue) =>
        configError("type-mismatch", [path, ...issue.path].join("."), issue.message),
      ),
    );
  }
  return ok({ raw: parameters, parsed: parsed.parameters });
};

/**
 * Every `{kind:"context", key}` binding anywhere inside a resolved parameter
 * object. This is the DATAFLOW: prompt 8's parameters bind context keys
 * directly (`sufficiency-check.available`), so the evaluation DAG is derived
 * from the parameters themselves rather than from a second `inputs` section
 * that could disagree with them.
 */
export const contextKeyReads = (value: unknown, out: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(value)) {
    for (const entry of value) contextKeyReads(entry, out);
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  const record = value as Record<string, unknown>;
  if (record["kind"] === "context" && typeof record["key"] === "string") {
    out.add(record["key"]);
    return out;
  }
  for (const entry of Object.values(record)) contextKeyReads(entry, out);
  return out;
};
