/**
 * THE CLOSED SEGMENT GRAMMAR (v3 prompt 10, ADR-0056) - the only way a domain
 * configuration builds a composite value.
 *
 * Conflict keys, idempotency keys, command payload fields and rendered copy all
 * draw from ONE closed `ValueSource` union and ONE closed segment list. There is
 * no concatenation operator, no format function, and no template string: a
 * configuration cannot compute, so it can never grow into the general-purpose
 * expression engine v3 §20 risk 2 bans, and prompt 23's conflict-key derivation
 * has a grammar to derive FROM rather than a convention to imitate.
 *
 * Everything here is pure and total: no clock, no locale, no Date. Calendar
 * bucketing is byte arithmetic on the canonical ISO forms (their lexicographic
 * order IS chronological order), which is why loading a configuration produces
 * identical bytes under any process time zone (the repo runs its suite on a
 * non-UTC clock precisely to catch the alternative).
 */
import { z } from "zod";
import { err, ok, type Result } from "@contracts/result";
import { configError, type DomainConfigError } from "./errors";
import {
  BucketGranularitySchema,
  ContextKeySchema,
  SlotNameSchema,
  kebabId,
  type BucketGranularity,
} from "./vocabulary";

/** A step's published output name (`ref`, `idempotencyKey`) - camelCase, closed per capability. */
const OutputNameSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, "camelCase output name");

/**
 * WHERE a composite value's part comes from. Five arms, all resolved by an
 * own-property Map lookup: `__proto__` and `constructor.prototype` are simply
 * absent, so prototype poisoning is not defended against, it is unrepresentable.
 */
const valueSourceSchemaImpl = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("slot"), slot: SlotNameSchema }).readonly(),
  z.strictObject({ from: z.literal("context"), key: ContextKeySchema }).readonly(),
  z
    .strictObject({
      from: z.literal("step-output"),
      step: kebabId<"ExecutionStepId">(),
      output: OutputNameSchema,
    })
    .readonly(),
  /** The platform's per-execution idempotency scope; never authored, never a slot. */
  z.strictObject({ from: z.literal("execution-scope") }).readonly(),
  /** The decision's own hash - the strongest available idempotency anchor. */
  z.strictObject({ from: z.literal("decision-hash") }).readonly(),
  /**
   * The identity that initiated the request. Platform AUTHORITY, never domain
   * data: a configuration names that it needs the initiating actor, and the
   * platform decides what that is - which is why there is no `slot:actor`.
   */
  z.strictObject({ from: z.literal("initiating-actor") }).readonly(),
  /**
   * A field of the external observation that CLOSED an awaited verification
   * rule (an e-signature's signing instant). Legal only in a plan that actually
   * has an externally-gated step, so a configuration cannot read an observation
   * it never waits for.
   */
  z
    .strictObject({ from: z.literal("await-observation"), field: OutputNameSchema })
    .readonly(),
]);

/** One part of a composite key. `bucket` needs a date-typed source (load-checked). */
const keySegmentSchemaImpl = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: kebabId<"KeyLiteral">() }).readonly(),
  z.strictObject({ kind: z.literal("value"), source: valueSourceSchemaImpl }).readonly(),
  z
    .strictObject({
      kind: z.literal("bucket"),
      source: valueSourceSchemaImpl,
      granularity: BucketGranularitySchema,
    })
    .readonly(),
]);

export const KeySegmentsSchema = z.array(keySegmentSchemaImpl).min(1).readonly();

/** The platform joins segments; the configuration never spells the separator. */
export const SEGMENT_SEPARATOR = ":";

/**
 * The escape byte that makes the join INJECTIVE. A bare join is not: a subject
 * carrying the separator moves the boundary, so `("h1:x", "d")` and
 * `("h1", "x:d")` render one string and two unrelated requests contend on a key
 * whose whole purpose is to make only genuinely conflicting requests contend.
 * Escaping the escape first and the separator second is what makes the rendered
 * bytes decodable back to exactly one tuple - and a resolved value carrying
 * neither byte (every kebab literal, every UUID scope, every ISO bucket) renders
 * exactly as it did before, so the encoding is a correction, not a re-keying.
 */
const SEGMENT_ESCAPE = "\\";

const escapeSegment = (part: string): string =>
  part
    .replaceAll(SEGMENT_ESCAPE, `${SEGMENT_ESCAPE}${SEGMENT_ESCAPE}`)
    .replaceAll(SEGMENT_SEPARATOR, `${SEGMENT_ESCAPE}${SEGMENT_SEPARATOR}`);

/**
 * Resolution of one `ValueSource` at render time. `absent` is a first-class
 * answer, so an optional payload field is a declared outcome rather than an
 * `undefined` leaking into a command.
 */
export type SourceResolution =
  | { readonly kind: "value"; readonly value: string }
  | { readonly kind: "absent" };

export type SourceResolver = (source: ValueSource) => SourceResolution;

const sourceLabel = (source: ValueSource): string =>
  source.from === "slot"
    ? `slot:${source.slot}`
    : source.from === "context"
      ? `context:${source.key}`
      : source.from === "step-output"
        ? `step-output:${source.step}.${source.output}`
        : source.from === "await-observation"
          ? `await-observation:${source.field}`
          : source.from;

/**
 * Calendar bucketing by byte arithmetic on a canonical ISO date or timestamp.
 * `2026-08-01` and `2026-08-01T12:00:00.000Z` both bucket to `2026-08` at month
 * granularity; anything that is not one of those two canonical forms is a
 * refusal, never a best-effort parse (the same posture D-186 gave temporal fact
 * reads: non-canonical bytes are a miss, not a coercion).
 */
const CANONICAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CANONICAL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const bucketOf = (
  value: string,
  granularity: BucketGranularity,
): string | null => {
  if (!CANONICAL_DATE_RE.test(value) && !CANONICAL_TIMESTAMP_RE.test(value)) return null;
  if (granularity === "year") return value.slice(0, 4);
  if (granularity === "month") return value.slice(0, 7);
  return value.slice(0, 10);
};

/**
 * Render a composite key. Every segment must resolve: a key with a hole would
 * be a DIFFERENT key for the same request, which is how two concurrent requests
 * stop colliding on the coordination key that exists to make them collide.
 *
 * The rendered bytes are an INJECTIVE encoding of the resolved tuple (each part
 * escaped, then joined), so distinct subjects can never share a coordination
 * identity no matter what bytes a caller's transport carries.
 */
export const renderKeySegments = (
  segments: readonly KeySegment[],
  resolve: SourceResolver,
  path: string,
): Result<string, readonly DomainConfigError[]> => {
  const parts: string[] = [];
  const errors: DomainConfigError[] = [];
  for (const [index, segment] of segments.entries()) {
    const at = `${path}[${index}]`;
    if (segment.kind === "literal") {
      parts.push(segment.value);
      continue;
    }
    const resolution = resolve(segment.source);
    if (resolution.kind === "absent") {
      errors.push(
        configError("incoherent", at, `key segment ${sourceLabel(segment.source)} did not resolve`),
      );
      continue;
    }
    if (segment.kind === "value") {
      parts.push(resolution.value);
      continue;
    }
    const bucket = bucketOf(resolution.value, segment.granularity);
    if (bucket === null) {
      errors.push(
        configError(
          "type-mismatch",
          at,
          `bucket segment needs a canonical ISO date or timestamp, received ${JSON.stringify(resolution.value)}`,
        ),
      );
      continue;
    }
    parts.push(bucket);
  }
  return errors.length > 0 ? err(errors) : ok(parts.map(escapeSegment).join(SEGMENT_SEPARATOR));
};

// ── The inert copy renderer ─────────────────────────────────────────────────────

/**
 * THE ONLY interpolation mechanism in the system. Exactly two placeholder
 * forms, resolved against already-published values; no arbitrary paths, no
 * expressions, no formatting. A brace that is not one of these two forms is a
 * template ERROR, which is what keeps "copy" from quietly becoming behavior.
 */
const PLACEHOLDER_RE = /\{(slot|context):([A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9][A-Za-z0-9]*)*)\}/g;
const ANY_BRACE_RE = /[{}]/;

export type TemplatePlaceholder = {
  readonly kind: "slot" | "context";
  /** The slot id or context key the placeholder resolves against. */
  readonly token: string;
};

/** The placeholders a template references, in document order (used by the completeness checks). */
export const templatePlaceholders = (template: string): readonly TemplatePlaceholder[] => {
  const out: TemplatePlaceholder[] = [];
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    out.push({ kind: match[1] as "slot" | "context", token: match[2]! });
  }
  return out;
};

/** A template whose braces are not all well-formed placeholders is refused at load. */
export const templateIsInert = (template: string): boolean =>
  !ANY_BRACE_RE.test(template.replace(PLACEHOLDER_RE, ""));

export type TemplateValues = {
  readonly slot: (slotId: string) => string | null;
  readonly context: (key: string) => string | null;
};

export const renderTemplate = (
  template: string,
  values: TemplateValues,
  path: string,
): Result<string, readonly DomainConfigError[]> => {
  if (!templateIsInert(template)) {
    return err([
      configError("not-inert", path, "a copy template may contain only {slot:…} and {context:…} placeholders"),
    ]);
  }
  const errors: DomainConfigError[] = [];
  const rendered = template.replace(PLACEHOLDER_RE, (_match, kind: string, token: string) => {
    const resolved = kind === "slot" ? values.slot(token) : values.context(token);
    if (resolved === null) {
      errors.push(configError("incoherent", path, `copy placeholder {${kind}:${token}} did not resolve`));
      return "";
    }
    return resolved;
  });
  return errors.length > 0 ? err(errors) : ok(rendered);
};

/**
 * COLLAPSED EXPORT (D-193). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
export type ValueSource = z.infer<typeof valueSourceSchemaImpl>;
export const ValueSourceSchema: z.ZodType<ValueSource> = valueSourceSchemaImpl;

/**
 * COLLAPSED EXPORT (D-193). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
export type KeySegment = z.infer<typeof keySegmentSchemaImpl>;
