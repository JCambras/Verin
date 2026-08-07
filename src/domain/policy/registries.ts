/**
 * The four pinned registries a policy loads against (v3 §6.1 closed
 * vocabularies; prompt 9, ADR-0053): evidence paths, instruction paths, context
 * keys, and approval templates - plus the primitive catalog itself. Every
 * lookup the loader or interpreter performs goes through these Maps, which is
 * what makes AST paths INERT DATA: a path like `__proto__` or
 * `constructor.prototype` is simply absent from a Map and fails reference
 * closure - there is no object-graph traversal for it to poison.
 *
 * The context-key vocabulary is DERIVED, never hand-authored (ratified design
 * §2.1): intent slots come from the domain configuration, and every other key
 * is a published key of a primitive that configuration binds. That derivation
 * is what ties prompt 8 (published-key declarations) to prompt 9 (closable
 * paths) - and it is why a policy can never read a fact nothing produces.
 */
import { err, ok, type Result } from "@contracts/result";
import type { CatalogPrimitive, PublishedKeyMap } from "@contracts/primitives/values";
import { PRIMITIVE_CATALOG } from "@contracts/primitives/catalog";

/**
 * The type vocabulary the load-time type check reasons over. `iso-date` and
 * `iso-timestamp` order lexicographically (their canonical byte forms make that
 * chronological order); `reference` and `structured` are platform-consumed and
 * never legal in a compare/in/set_parameter-value position.
 */
export type PolicyValueType =
  | "integer"
  | "boolean"
  | "string"
  | "iso-date"
  | "iso-timestamp"
  | "reference"
  | "structured";

/** Types an ordering comparator (gt/gte/lt/lte) may run over. */
export const ORDERABLE_VALUE_TYPES: ReadonlySet<PolicyValueType> = new Set([
  "integer",
  "iso-date",
  "iso-timestamp",
]);

export type PathDescriptor = { readonly valueType: PolicyValueType };

/** One evidence kind's declared, closed path vocabulary at its schema version. */
export type EvidenceKindDescriptor = {
  readonly paths: ReadonlyMap<string, PathDescriptor>;
};

export type InstructionKindDescriptor = {
  readonly paths: ReadonlyMap<string, PathDescriptor>;
};

export type ContextKeyOrigin =
  | { readonly source: "intent" }
  | { readonly source: "primitive"; readonly primitiveId: string };

export type ContextKeyDescriptor = {
  readonly valueType: PolicyValueType;
  readonly origin: ContextKeyOrigin;
};

/** Template kind is what lets authority resolution force specialist_review mode. */
export type ApprovalTemplateDescriptor = {
  readonly kind: "approval" | "specialist_review";
};

export type PolicyRegistries = {
  readonly evidence: ReadonlyMap<string, EvidenceKindDescriptor>;
  readonly instructions: ReadonlyMap<string, InstructionKindDescriptor>;
  readonly contextKeys: ReadonlyMap<string, ContextKeyDescriptor>;
  readonly approvalTemplates: ReadonlyMap<string, ApprovalTemplateDescriptor>;
  readonly primitives: ReadonlyMap<string, CatalogPrimitive>;
  /** The primitive-set version these registries were assembled against. */
  readonly primitiveSetVersion: string;
};

/**
 * The shipped catalog as a Map, keyed by primitive id. The callback's return
 * annotation collapses the catalog tuple's six-way fully-typed union onto the
 * structural CatalogPrimitive supertype IMMEDIATELY - the sealed-type fence
 * materializes inferred types at every call, and the un-collapsed union of six
 * complete Zod schema instantiations is large enough to exhaust its heap.
 */
export const catalogPrimitiveMap = (): ReadonlyMap<string, CatalogPrimitive> =>
  new Map(
    PRIMITIVE_CATALOG.map((primitive): readonly [string, CatalogPrimitive] => [
      primitive.id as string,
      primitive,
    ]),
  );

const pathMap = (
  paths: Readonly<Record<string, PolicyValueType>>,
): ReadonlyMap<string, PathDescriptor> =>
  new Map(
    Object.entries(paths).map(([path, valueType]) => [path, { valueType }]),
  );

export const evidenceKindDescriptor = (
  paths: Readonly<Record<string, PolicyValueType>>,
): EvidenceKindDescriptor => ({ paths: pathMap(paths) });

export const instructionKindDescriptor = (
  paths: Readonly<Record<string, PolicyValueType>>,
): InstructionKindDescriptor => ({ paths: pathMap(paths) });

const publishedKindToValueType = {
  integer: "integer",
  boolean: "boolean",
  code: "string",
  reference: "reference",
  structured: "structured",
} as const satisfies Record<string, PolicyValueType>;

/**
 * Derives the context-key registry from intent slots plus the published keys
 * of the bound primitives. A key claimed twice is a derivation FAILURE, never
 * last-writer-wins - the same fail-closed posture as D-104's
 * binding-multiplicity obligation.
 *
 * The refusal is structural: no registry comes back at all, so a caller cannot
 * admit a colliding key by ignoring a side channel. That matters far beyond
 * tidiness. Admitting the key would keep the intent descriptor and drop the
 * primitive's, so `primitiveKeyReads` would not count a read of it, the rule
 * would classify `configuration`, the OQ-6 stratification check would stay
 * silent, and the SAME key would resolve from intent in Phase 0 and from the
 * published facts in Phase 2 - the one-key-two-resolutions outcome
 * `resolveContextKey` is written to make impossible.
 */
export const deriveContextKeys = (
  intentSlots: Readonly<Record<string, PolicyValueType>>,
  boundPublishedKeys: readonly {
    readonly primitiveId: string;
    readonly publishedKeys: PublishedKeyMap;
  }[],
): Result<ReadonlyMap<string, ContextKeyDescriptor>, readonly string[]> => {
  const contextKeys = new Map<string, ContextKeyDescriptor>();
  const collisions: string[] = [];
  for (const [key, valueType] of Object.entries(intentSlots)) {
    contextKeys.set(key, { valueType, origin: { source: "intent" } });
  }
  for (const binding of boundPublishedKeys) {
    for (const [key, descriptor] of Object.entries(binding.publishedKeys)) {
      if (contextKeys.has(key)) {
        collisions.push(key);
        continue;
      }
      contextKeys.set(key, {
        valueType: publishedKindToValueType[descriptor.kind],
        origin: { source: "primitive", primitiveId: binding.primitiveId },
      });
    }
  }
  return collisions.length > 0 ? err([...new Set(collisions)].sort()) : ok(contextKeys);
};
