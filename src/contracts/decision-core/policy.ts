/**
 * THE CONSTRAINED POLICY AST (v3 §6.1; prompt 9; ADR-0053; captain ratification
 * waveb-design-ratification, 2026-07-26).
 *
 * This grammar is CLOSED. The ratified node set (docs/v3/verin-core-contracts.ts
 * ValueNode/PredicateNode/PolicyEffect/PolicyRule/PolicyAst) is reproduced here as
 * strict Zod schemas with exactly three ratified deltas, none invented locally:
 *  - v1 restriction: `in.set` members must be `constant` nodes (dynamic
 *    instruction-sourced lists belong to the restriction-screen primitive, which
 *    returns source-attributed matches; a dynamic `in` would drop provenance);
 *  - OQ-2 ruling: `require_evidence` carries `reviewTemplateId`, required exactly
 *    when `absence` is `specialist_review`, so the specialist stage's shape is
 *    resolved from the same template registry as every other stage;
 *  - OQ-7 ruling: `elapsed` is the ONE reserved future predicate op. Grammar
 *    version 1.1.0 parses it (that is what the ADR-0053 migration fixture
 *    exercises), but it stays grammar-only: the loader refuses it as
 *    not-yet-evaluable until the prompt that activates it lands semantics. Any
 *    other temporal mechanism is rejected rather than improvised.
 *
 * Banned exactly as v3 §6.2 requires: no user functions, no dynamic paths, no
 * string interpretation anywhere (codes are opaque brands; constants are inert
 * data), no SQL/shell/eval, no LLM-executed effects. Enforcement is structural
 * (strict objects, closed discriminated unions) plus the load-time closure in
 * domain/policy and the `policy-ast` fitness fence.
 *
 * The grammar version and the primitive-set version are INDEPENDENT (v3 prompt
 * 9): a policy pins both, and every DecisionInputBundle already pins
 * primitiveSetVersion separately.
 */
import { z } from "zod";
import {
  AllowedContextKeySchema,
  AllowedSelectionStrategySchema,
  ApprovalTemplateIdSchema,
  DurationSchema,
  EvidenceKindSchema,
  InstructionKindSchema,
  PolicyRuleIdSchema,
  PrimitiveIdSchema,
  ReasonCodeSchema,
  normalizeCanonicalStrings,
} from "./ids";

/** The ACTIVE grammar version: what a newly authored policy must declare. */
export const POLICY_GRAMMAR_VERSION = "1.0.0";

/**
 * Every grammar version this build can parse. 1.1.0 exists to prove the
 * additive-minor migration discipline (§3.7 of the ratified design): it adds
 * ONLY the reserved `elapsed` op, and a 1.0.0 document parses byte-identically
 * under it. It is not the active authoring version.
 */
export const POLICY_GRAMMAR_VERSIONS = ["1.0.0", "1.1.0"] as const;
export type PolicyGrammarVersion = (typeof POLICY_GRAMMAR_VERSIONS)[number];

// ── The ratified closed vocabularies ────────────────────────────────────────────
// These are the DECLARATION of what the schemas below admit. The `policy-ast`
// fence reads the real vocabulary back off the built schemas and holds BOTH
// these lists and the ratified pin to it, so a widened schema arm cannot hide
// behind an unchanged list (nor a widened list behind an unchanged schema).

export const VALUE_NODE_KINDS = [
  "constant",
  "evidence",
  "household_instruction",
  "context",
] as const;

export const COMPARATORS = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
export type Comparator = (typeof COMPARATORS)[number];

/** The seven ratified, evaluable predicate ops of grammar 1.0.0. */
export const EVALUABLE_PREDICATE_OPS = [
  "all",
  "any",
  "not",
  "exists",
  "is_fresh",
  "compare",
  "in",
] as const;

/** The ONE reserved future op (OQ-7). Parseable at 1.1.0, never evaluable yet. */
export const RESERVED_PREDICATE_OPS = ["elapsed"] as const;

export const POLICY_EFFECT_KINDS = [
  "require_evidence",
  "set_parameter",
  "require_approval",
  "block",
  "prohibit",
  "select_candidate",
] as const;

// ── ValueNode ───────────────────────────────────────────────────────────────────

export const PolicyConstantSchema = z
  .strictObject({
    kind: z.literal("constant"),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .readonly();
export type PolicyConstant = z.infer<typeof PolicyConstantSchema>;

const EvidenceValueSchema = z
  .strictObject({
    kind: z.literal("evidence"),
    evidenceKind: EvidenceKindSchema,
    path: z.string().min(1),
  })
  .readonly();

const InstructionValueSchema = z
  .strictObject({
    kind: z.literal("household_instruction"),
    instructionKind: InstructionKindSchema,
    path: z.string().min(1),
  })
  .readonly();

const ContextValueSchema = z
  .strictObject({
    kind: z.literal("context"),
    key: AllowedContextKeySchema,
  })
  .readonly();

export const ValueNodeSchema = z.discriminatedUnion("kind", [
  PolicyConstantSchema.unwrap(),
  EvidenceValueSchema.unwrap(),
  InstructionValueSchema.unwrap(),
  ContextValueSchema.unwrap(),
]);
export type ValueNode = z.infer<typeof ValueNodeSchema>;

// ── PredicateNode (recursive; grammar-versioned) ────────────────────────────────

/**
 * The evaluable predicate union: exactly the seven ratified ops. This is the
 * type the loader emits and the interpreter consumes.
 */
export type PredicateNode =
  | { readonly op: "all"; readonly nodes: readonly PredicateNode[] }
  | { readonly op: "any"; readonly nodes: readonly PredicateNode[] }
  | { readonly op: "not"; readonly node: PredicateNode }
  | { readonly op: "exists"; readonly value: ValueNode }
  | {
      readonly op: "is_fresh";
      readonly evidenceKind: z.infer<typeof EvidenceKindSchema>;
      readonly maxAge: z.infer<typeof DurationSchema>;
    }
  | {
      readonly op: "compare";
      readonly comparator: Comparator;
      readonly left: ValueNode;
      readonly right: ValueNode;
    }
  | { readonly op: "in"; readonly value: ValueNode; readonly set: readonly PolicyConstant[] };

/**
 * The reserved `elapsed` arm (OQ-7), grammar 1.1.0 only. The field shape is a
 * PLACEHOLDER pinned for the migration fixture; the prompt that activates the
 * op ratifies its final semantics and may only do so through a version bump.
 */
export type ReservedElapsedNode = {
  readonly op: "elapsed";
  readonly value: ValueNode;
  readonly minimumAge: z.infer<typeof DurationSchema>;
};

/** The wide grammar-plane union: what a 1.1.0 document may syntactically contain. */
export type GrammarPredicateNode =
  | { readonly op: "all"; readonly nodes: readonly GrammarPredicateNode[] }
  | { readonly op: "any"; readonly nodes: readonly GrammarPredicateNode[] }
  | { readonly op: "not"; readonly node: GrammarPredicateNode }
  | Exclude<PredicateNode, { op: "all" | "any" | "not" }>
  | ReservedElapsedNode;

const comparatorSchema = z.enum(COMPARATORS);

/**
 * Every intermediate below carries an EXPLICIT small INLINE annotation
 * (`z.ZodType<GrammarPredicateNode>`), deliberately: the sealed-type fence
 * materializes inferred types at every call expression across the repo, and an
 * un-annotated recursive union of readonly strict objects hands the checker an
 * expansion large enough to exhaust the fitness fork's heap. Inline (never a
 * module-level alias) because the llm-pii fence walks alias declarations into
 * the schema internals. The annotation is the type the checker keeps; behavior
 * is untouched.
 */
/**
 * Builds the recursive predicate schema for one grammar version. The leaf arms
 * are shared; only the reserved-op arm differs, so an additive minor version is
 * PROVABLY a superset (the migration fixture asserts it byte-for-byte).
 *
 * The arms form a DISCRIMINATED union on `op`, exactly as `ValueNodeSchema` and
 * `PolicyEffectSchema` do on `kind` - never a plain `z.union`. A plain union
 * tries every arm in order and a strict object does not abandon its remaining
 * keys once one fails, so `all` would fully re-parse the children of every
 * `any` node before the right arm was reached: MEASURED at ~2^depth (588ms at
 * eleven nested nodes, and quadrupling every two more). Discriminating on `op`
 * selects one arm from the discriminator alone, which makes the parse linear in
 * document size and makes a wrong `op` report itself instead of aggregating
 * seven arms' worth of noise. Arms are therefore bare strict objects: a
 * `.readonly()` wrapper carries no discriminator, and freezing the parse output
 * was never part of the contract (the ratified value and effect unions do not
 * freeze theirs either, and the canonical bytes are identical).
 */
const predicateSchemaFor = (version: PolicyGrammarVersion): z.ZodType<GrammarPredicateNode> => {
  const self: z.ZodType<GrammarPredicateNode> = z.lazy((): z.ZodType<GrammarPredicateNode> => {
    const allArm: z.ZodType<GrammarPredicateNode> = z.strictObject({
      op: z.literal("all"),
      nodes: z.array(self).readonly(),
    });
    const anyArm: z.ZodType<GrammarPredicateNode> = z.strictObject({
      op: z.literal("any"),
      nodes: z.array(self).readonly(),
    });
    const notArm: z.ZodType<GrammarPredicateNode> = z.strictObject({
      op: z.literal("not"),
      node: self,
    });
    const existsArm: z.ZodType<GrammarPredicateNode> = z.strictObject({
      op: z.literal("exists"),
      value: ValueNodeSchema,
    });
    const isFreshArm: z.ZodType<GrammarPredicateNode> = z.strictObject({
      op: z.literal("is_fresh"),
      evidenceKind: EvidenceKindSchema,
      maxAge: DurationSchema,
    });
    const compareArm: z.ZodType<GrammarPredicateNode> = z.strictObject({
      op: z.literal("compare"),
      comparator: comparatorSchema,
      left: ValueNodeSchema,
      right: ValueNodeSchema,
    });
    // v1 restriction: `in` members are constants ONLY (see the module header).
    const inArm: z.ZodType<GrammarPredicateNode> = z.strictObject({
      op: z.literal("in"),
      value: ValueNodeSchema,
      set: z.array(PolicyConstantSchema).min(1).readonly(),
    });
    const elapsedArm: z.ZodType<GrammarPredicateNode> = z.strictObject({
      op: z.literal("elapsed"),
      value: ValueNodeSchema,
      minimumAge: DurationSchema,
    });
    const arms: readonly z.ZodType<GrammarPredicateNode>[] = [
      allArm,
      anyArm,
      notArm,
      existsArm,
      isFreshArm,
      compareArm,
      inArm,
      ...(version === "1.1.0" ? [elapsedArm] : []),
    ];
    return z.discriminatedUnion(
      "op",
      arms as unknown as readonly [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]],
    ) as z.ZodType<GrammarPredicateNode>;
  });
  return self;
};

// ── PolicyEffect (grammar-version-independent) ──────────────────────────────────

const RequireEvidenceSchema = z
  .strictObject({
    kind: z.literal("require_evidence"),
    evidenceKind: EvidenceKindSchema,
    absence: z.enum(["block", "specialist_review"]),
    /** OQ-2: present exactly when absence = specialist_review (refined below). */
    reviewTemplateId: ApprovalTemplateIdSchema.optional(),
  })
  .superRefine((effect, ctx) => {
    if (effect.absence === "specialist_review" && effect.reviewTemplateId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "require_evidence with absence=specialist_review requires reviewTemplateId (OQ-2)",
        path: ["reviewTemplateId"],
      });
    }
    if (effect.absence === "block" && effect.reviewTemplateId !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "require_evidence with absence=block must not carry reviewTemplateId (OQ-2)",
        path: ["reviewTemplateId"],
      });
    }
  })
  .readonly();

const SetParameterSchema = z
  .strictObject({
    kind: z.literal("set_parameter"),
    primitiveId: PrimitiveIdSchema,
    parameter: z.string().min(1),
    value: ValueNodeSchema,
  })
  .readonly();

const RequireApprovalSchema = z
  .strictObject({
    kind: z.literal("require_approval"),
    templateId: ApprovalTemplateIdSchema,
  })
  .readonly();

const BlockEffectSchema = z
  .strictObject({
    kind: z.literal("block"),
    blockerCode: ReasonCodeSchema,
    resolvingEvidenceKinds: z
      .array(EvidenceKindSchema)
      .refine((kinds) => new Set(kinds).size === kinds.length, "duplicate resolving evidence kind")
      .overwrite(normalizeCanonicalStrings)
      .readonly(),
  })
  .readonly();

const ProhibitEffectSchema = z
  .strictObject({
    kind: z.literal("prohibit"),
    prohibitionCode: ReasonCodeSchema,
  })
  .readonly();

const SelectCandidateSchema = z
  .strictObject({
    kind: z.literal("select_candidate"),
    primitiveId: PrimitiveIdSchema,
    strategy: AllowedSelectionStrategySchema,
  })
  .readonly();

export const PolicyEffectSchema = z.discriminatedUnion("kind", [
  RequireEvidenceSchema.unwrap(),
  SetParameterSchema.unwrap(),
  RequireApprovalSchema.unwrap(),
  BlockEffectSchema.unwrap(),
  ProhibitEffectSchema.unwrap(),
  SelectCandidateSchema.unwrap(),
]);
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

// ── PolicyRule + PolicyAst ──────────────────────────────────────────────────────

export type GrammarPolicyRule = {
  readonly id: z.infer<typeof PolicyRuleIdSchema>;
  readonly when: GrammarPredicateNode;
  readonly effects: readonly PolicyEffect[];
};

/** A rule as the loader emits it: its predicate contains no reserved op. */
export type PolicyRule = {
  readonly id: z.infer<typeof PolicyRuleIdSchema>;
  readonly when: PredicateNode;
  readonly effects: readonly PolicyEffect[];
};

export type GrammarPolicyAst = {
  readonly schemaVersion: PolicyGrammarVersion;
  readonly primitiveSetVersion: string;
  readonly rules: readonly GrammarPolicyRule[];
};

const SEMVER = /^\d+\.\d+\.\d+$/;

const policyRuleSchemaFor = (version: PolicyGrammarVersion): z.ZodType<GrammarPolicyRule> =>
  z
    .strictObject({
      id: PolicyRuleIdSchema,
      when: predicateSchemaFor(version),
      effects: z.array(PolicyEffectSchema).min(1).readonly(),
    })
    .readonly();

const buildPolicyAstSchema = (version: PolicyGrammarVersion): z.ZodType<GrammarPolicyAst> =>
  z
    .strictObject({
      schemaVersion: z.literal(version),
      primitiveSetVersion: z.string().regex(SEMVER, "semver"),
      rules: z.array(policyRuleSchemaFor(version)).readonly(),
    })
    .superRefine((ast, ctx) => {
      const seen = new Set<string>();
      ast.rules.forEach((rule, index) => {
        if (seen.has(rule.id)) {
          ctx.addIssue({
            code: "custom",
            message: `duplicate rule id ${rule.id}`,
            path: ["rules", index, "id"],
          });
        }
        seen.add(rule.id);
      });
    })
    .readonly() as unknown as z.ZodType<GrammarPolicyAst>;

/** One built schema per version of the CLOSED version list - see below. */
const builtAstSchemas = new Map<PolicyGrammarVersion, z.ZodType<GrammarPolicyAst>>();

/**
 * The grammar parse for one declared version. This is deliberately a FACTORY
 * keyed by the closed version list: an unknown schemaVersion has no schema to
 * parse under, which is itself the load failure (never a silent fallback).
 *
 * MEMOIZED per version, because the factory is a pure function of a closed
 * list: building the graph means rebuilding the lazy predicate union, its
 * discriminator map, the six effect schemas with their refinements, and the
 * AST refinement - work that used to repeat on EVERY `loadPolicy`. Zod schemas
 * hold no per-parse state, so a shared instance parses identically.
 */
export const policyAstSchemaFor = (
  version: PolicyGrammarVersion,
): z.ZodType<GrammarPolicyAst> => {
  const cached = builtAstSchemas.get(version);
  if (cached !== undefined) return cached;
  const built = buildPolicyAstSchema(version);
  builtAstSchemas.set(version, built);
  return built;
};

/**
 * The reserved-op declaration, READ at runtime rather than restated as a case
 * arm: adding an op to `RESERVED_PREDICATE_OPS` is what makes the loader refuse
 * it, so the list and the refusal can never disagree.
 */
const RESERVED_OPS: ReadonlySet<string> = new Set(RESERVED_PREDICATE_OPS);

/** True iff the node tree contains a reserved (grammar-only, not-yet-evaluable) op. */
export const findReservedOps = (
  node: GrammarPredicateNode,
  path: readonly (string | number)[] = ["when"],
): readonly { readonly op: string; readonly path: readonly (string | number)[] }[] => {
  switch (node.op) {
    case "all":
    case "any":
      return node.nodes.flatMap((child, index) =>
        findReservedOps(child, [...path, "nodes", index]),
      );
    case "not":
      return findReservedOps(node.node, [...path, "node"]);
    default:
      return RESERVED_OPS.has(node.op) ? [{ op: node.op, path }] : [];
  }
};
