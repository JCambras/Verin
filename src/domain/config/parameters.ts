/**
 * PRIMITIVE PARAMETER VALUES, AND THE ONE PLACE TENANCY IS DEFERRED (v3 prompt
 * 10; ADR-0058).
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
import {
  childConfigPath,
  childConfigSubscript,
  configError,
  configPathFrom,
  configPathOfText,
  MAX_CONFIG_DIAGNOSIS_LENGTH,
  MAX_CONFIGURED_VALUE_DEPTH,
  type ConfigPath,
  type ConfigPathLimit,
  type DomainConfigError,
} from "./errors";


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
 * WHY THE PLACEHOLDER'S OWN CONTENTS ARE LOAD-CHECKED. `isParameterRef`
 * recognises the placeholder SHAPE - one `$ref` key - because a placeholder may
 * appear anywhere inside a parameter graph the primitive's own schema judges.
 * The shape is not the vocabulary: `PARAMETER_REF_KINDS` is declared CLOSED, and
 * a closed vocabulary nothing enforces is not closed. Left unchecked, a typo
 * (`evidence-sources`) substitutes cleanly here, parses against the primitive's
 * schema, and only diverges at BIND, where `parameterRefClasses` filters on the
 * exact kind - so the class silently drops out of the checklist a surface builds
 * its firm registry from and the failure lands at request time.
 */
const parameterRefProblem = (ref: unknown): string | null => {
  if (typeof ref !== "object" || ref === null || Array.isArray(ref)) {
    return "a deferred reference must be an object naming a kind and a class";
  }
  const { kind, class: className } = ref as { readonly kind?: unknown; readonly class?: unknown };
  const kinds: readonly string[] = PARAMETER_REF_KINDS;
  if (typeof kind !== "string" || !kinds.includes(kind)) {
    return `unknown deferred reference kind ${JSON.stringify(kind)}; admissible kinds are ${kinds.join(", ")}`;
  }
  if (typeof className !== "string" || className.length === 0) {
    return "a deferred reference must name a non-empty firm-neutral class";
  }
  return null;
};

/**
 * The reserved firm id load-time validation substitutes. It is not a legal firm
 * id anywhere else, so a document that somehow reached production carrying it
 * would fail firm binding rather than quietly act as a tenant.
 */
export const NEUTRAL_FIRM_ID = "domain-config-neutral";

export type RefResolver = (ref: ParameterRef["$ref"]) => unknown | null;

/**
 * WHERE A PARAMETER GRAPH STOPS BEING EXPRESSIBLE - the admission half of
 * `MAX_CONFIGURED_VALUE_DEPTH` and of the fault channel's SEGMENT grammar.
 *
 * `substitute` below descends once per container level and appends `.key` or
 * `[index]` to the fault path as it goes, so the path it can emit is exactly as
 * deep as the graph it is given - and its segments are exactly the OWN KEYS of a
 * value graph this schema deliberately does not shape (the primitive's own schema
 * is the judge). Both are therefore author-chosen, and both are refused HERE: this
 * walk MIRRORS that descent - same containers, same placeholder short-circuit - and
 * refuses at the depth bound, at a key or position the channel cannot name, or at
 * its length ceiling, naming the deepest ADMITTED path rather than the offending
 * one, and the limit it hit. Reporting a path the channel cannot carry censors the very location
 * the refusal exists to state; reporting one that JOINS a dotted key into it invents
 * a node the document does not have, which is worse (D-262/D-266).
 *
 * BOTH CONTAINER KINDS TAKE THE SAME STEP (D-269). A list position used to be
 * appended raw, so the ceiling was enforced for keys and not for positions: two
 * identical overruns, opposite verdicts, and a `substitute` leaning on an admission
 * that never covered half of what it appends. `childConfigSubscript` is that half.
 *
 * Refusing at admission is what makes the diagnosis shape a consequence of these
 * constants instead of a second opinion about them, the same way the policy loader
 * bounds document nesting before parsing rather than after (D-181) - and it is what
 * lets `substitute` descend without re-judging, since every step it can take has
 * already been proven carriable.
 *
 * WHICH limit stopped it is reported as itself (D-268): renaming a key and
 * flattening a graph are opposite repairs, and telling an operator to do the first
 * about ordinary camelCase keys at the ALLOWED depth is a confidently wrong answer.
 */
const unreportableNames = (limit: ConfigPathLimit, count: number): string =>
  limit === "unnameable-segment"
    ? `${count} name(s) or list position(s) here are not ones the operator's fault channel can carry as one segment, so a fault below them would have no location to report`
    : `this location has reached the ${MAX_CONFIG_DIAGNOSIS_LENGTH} characters the operator's fault channel carries, so a fault below ${count} otherwise-nameable name(s) or list position(s) here would have no location to report`;

const depthOverruns = (
  value: unknown,
  at: ConfigPath,
  remaining: number,
  errors: DomainConfigError[],
): void => {
  if (isParameterRef(value)) return;
  const stopped = new Map<ConfigPathLimit, { readonly step: ConfigPath; count: number }>();
  const admit = (step: ConfigPath, entry: unknown): (readonly [ConfigPath, unknown])[] => {
    if (step.carried) return [[step, entry] as const];
    const seen = stopped.get(step.limit);
    if (seen === undefined) stopped.set(step.limit, { step, count: 1 });
    else seen.count += 1;
    return [];
  };
  const entries: (readonly [ConfigPath, unknown])[] = Array.isArray(value)
    ? value.flatMap((entry, index) => admit(childConfigSubscript(at, index), entry))
    : typeof value === "object" && value !== null
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
        admit(childConfigPath(at, key), entry))
    : [];
  for (const [limit, seen] of stopped) {
    errors.push(configError("type-mismatch", seen.step, unreportableNames(limit, seen.count)));
  }
  if (entries.length === 0) return;
  if (remaining === 0) {
    errors.push(
      configError(
        "type-mismatch",
        at,
        `a configured parameter value may nest at most ${MAX_CONFIGURED_VALUE_DEPTH} levels, so a fault below this point has no location the operator's channel can carry`,
      ),
    );
    return;
  }
  for (const [step, entry] of entries) depthOverruns(entry, step, remaining - 1, errors);
};

/** Substitute every placeholder through `resolve`; a `null` answer is an error. */
const substitute = (
  value: unknown,
  resolve: RefResolver,
  at: ConfigPath,
  errors: DomainConfigError[],
): unknown => {
  if (isParameterRef(value)) {
    const problem = parameterRefProblem(value.$ref);
    if (problem !== null) {
      errors.push(configError("unknown-reference", at, problem));
      return null;
    }
    const resolved = resolve(value.$ref);
    if (resolved === null) {
      errors.push(
        configError(
          "firm-binding",
          at,
          `no ${value.$ref.kind} is registered for class ${JSON.stringify(value.$ref.class)}`,
        ),
      );
      return null;
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => substitute(entry, resolve, childConfigSubscript(at, index), errors));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        substitute(entry, resolve, childConfigPath(at, key), errors),
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

/**
 * Every deferred reference CLASS of one kind a value graph defers, so a caller
 * can ask what a document needs a firm to supply without first having a firm.
 */
export const parameterRefClasses = (
  value: unknown,
  kind: (typeof PARAMETER_REF_KINDS)[number],
  out: Set<string> = new Set(),
): Set<string> => {
  if (isParameterRef(value)) {
    // `isParameterRef` recognises the placeholder SHAPE - one `$ref` key - and
    // leaves what is under it to the primitive's own schema, so read it as
    // unknown rather than trusting the narrowing for a malformed document.
    const ref: unknown = value.$ref;
    if (typeof ref === "object" && ref !== null) {
      const { kind: refKind, class: className } = ref as { readonly kind?: unknown; readonly class?: unknown };
      if (refKind === kind && typeof className === "string") out.add(className);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) parameterRefClasses(entry, kind, out);
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      parameterRefClasses(entry, kind, out);
    }
  }
  return out;
};

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
 * made that walk exponential and killed a fence worker outright (D-222). The
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
  const at = configPathOfText(path);
  // A parameter NAME is author-chosen too, so the location it is reported at is
  // built rather than interpolated: a name the channel cannot report is refused AT
  // the parameters node, which is a location the document has, and the refusal names
  // the limit it hit rather than asserting the name is undeclared - at the ceiling
  // the name is usually one the primitive declares perfectly well.
  for (const name of Object.keys(parameters)) {
    const step = childConfigPath(at, name);
    if (!step.carried) {
      errors.push(
        configError(
          step.limit === "unnameable-segment" ? "unknown-reference" : "type-mismatch",
          step,
          unreportableNames(step.limit, 1),
        ),
      );
      continue;
    }
    if (!primitive.declaredParameters.has(name)) {
      errors.push(
        configError(
          "unknown-reference",
          step,
          `primitive ${primitive.id} declares no parameter named ${JSON.stringify(name)}`,
        ),
      );
    }
  }
  // BEFORE any walk that recurses on document structure, so a graph deeper than
  // the fault channel can express - or carrying a key or list position it cannot
  // name - is refused rather than walked, and so every recursion below is bounded
  // by an admission this call has already proven.
  for (const [name, value] of Object.entries(parameters)) {
    const step = childConfigPath(at, name);
    if (step.carried) depthOverruns(value, step, MAX_CONFIGURED_VALUE_DEPTH, errors);
  }
  if (errors.length > 0) return err(errors);
  for (const shaping of primitive.keyShapingParameters) {
    const value = parameters[shaping];
    if (value !== undefined && containsParameterRef(value)) {
      errors.push(
        configError(
          "type-mismatch",
          childConfigPath(at, shaping),
          "a key-shaping parameter may not defer a tenant-scoped reference: the published key space must be identical for every firm (D-184/D-185)",
        ),
      );
    }
  }
  if (errors.length > 0) return err(errors);
  const substituted = substitute(parameters, resolve, at, errors) as Record<string, unknown>;
  if (errors.length > 0) return err(errors);
  const parsed = primitive.parseParameters(substituted);
  if (!parsed.ok) {
    return err(
      parsed.issues.map((issue) =>
        configError("type-mismatch", configPathFrom([...issue.path], at), issue.message),
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
