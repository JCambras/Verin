/**
 * The screening family of decision primitives (v3 prompt 8; ADR-0039):
 * restriction-screen and evidence-reconciliation.
 *
 * restriction-screen exists because joining action subjects against three
 * differently-shaped restriction sources with precedence-grade provenance is
 * not predicate work: the AST `in` operator handles only static constant sets
 * with no source attribution. Its source-attributed matches are exactly what
 * Prohibition.source and the precedence machinery consume - which is why
 * household- and regulatory-sourced prohibitions never flow through the firm
 * AST's prohibit effect (a firm rule cannot impersonate a client mandate or a
 * regulation).
 *
 * evidence-reconciliation exists because comparing snapshots of one evidence
 * kind to each other is the fourth capability the AST deliberately lacks: AST
 * paths resolve to at most one snapshot per kind by design. Contradictions
 * cite SNAPSHOT REFERENCES, never values - fact content may be PII and stays
 * behind the snapshot boundary. Ratified as activating at prompt 15 (captain
 * OQ-3 ruling): included in set 1.0.0 so Wave C is not blocked on a mid-wave
 * version bump.
 */
import { z } from "zod";
import {
  EvidenceSnapshotIdRefSchema,
  EvidenceSourceRefSchema,
  HouseholdInstructionRefSchema,
  HouseholdInstructionVersionRefSchema,
  PolicyRefSchema,
  PolicyVersionRefSchema,
  RegulatorySourceRefSchema,
  RegulatoryVersionRefSchema,
  SubjectRefSchema,
  compareCanonicalStrings,
  compareScopedReferences,
  hasUniqueByComparator,
  hasUniqueScopedReferences,
  normalizeCanonicalStrings,
  normalizeScopedReferences,
} from "../decision-core/ids";
import {
  KeySegmentSchema,
  addSingleTenantIssue,
  parsePrimitiveId,
  publishedBoolean,
  publishedStructured,
  type PrimitiveFalsification,
  type PublishedFactRecord,
  type PublishedKeyMap,
} from "./values";

// ── restriction-screen ──────────────────────────────────────────────────────────

const RestrictionPolaritySchema = z.enum(["allow-list", "deny-list"]);

/**
 * One standing restriction list. The discriminated union binds each governing
 * plane to its OWN branded source and version references, so a firm-policy
 * restriction carrying a regulatory reference is unrepresentable - the match
 * output inherits precedence-grade provenance from the parse boundary.
 */
const restrictionArm = <
  SourceType extends string,
  SourceRef extends z.ZodType,
  VersionRef extends z.ZodType,
>(
  sourceType: SourceType,
  sourceRef: SourceRef,
  versionRef: VersionRef,
) =>
  z.strictObject({
    sourceType: z.literal(sourceType),
    sourceRef,
    versionRef,
    kind: KeySegmentSchema,
    polarity: RestrictionPolaritySchema,
    /** Which bound subject this list governs (a subjectsInScope slot name). */
    appliesToSlot: KeySegmentSchema,
    entryRefs: z
      .array(SubjectRefSchema)
      .refine(hasUniqueScopedReferences, "duplicate restriction entry")
      .overwrite(normalizeScopedReferences)
      .readonly(),
  });

const RestrictionListSchema = z.discriminatedUnion("sourceType", [
  restrictionArm("regulatory", RegulatorySourceRefSchema, RegulatoryVersionRefSchema),
  restrictionArm("firm_policy", PolicyRefSchema, PolicyVersionRefSchema),
  restrictionArm(
    "household_instruction",
    HouseholdInstructionRefSchema,
    HouseholdInstructionVersionRefSchema,
  ),
]);

type RestrictionList = z.infer<typeof RestrictionListSchema>;

const compareRestrictionLists = (
  left: RestrictionList,
  right: RestrictionList,
): number =>
  compareCanonicalStrings(left.kind, right.kind) ||
  compareCanonicalStrings(left.appliesToSlot, right.appliesToSlot) ||
  compareCanonicalStrings(left.sourceType, right.sourceType) ||
  compareScopedReferences(left.sourceRef, right.sourceRef) ||
  compareScopedReferences(left.versionRef, right.versionRef);

const RestrictionScreenParameterSchema = z
  .strictObject({
    /**
     * Declared restriction kinds WITH their expected polarity: a list arriving
     * with the opposite polarity contradicts the binding and is refused, never
     * reinterpreted.
     */
    restrictionKinds: z
      .array(
        z
          .strictObject({
            kind: KeySegmentSchema,
            polarity: RestrictionPolaritySchema,
          })
          .readonly(),
      )
      .min(1)
      .refine(
        (kinds) => new Set(kinds.map((entry) => entry.kind)).size === kinds.length,
        "duplicate restriction kind",
      )
      .overwrite((kinds) =>
        [...kinds].sort((left, right) => compareCanonicalStrings(left.kind, right.kind)),
      )
      .readonly(),
    subjectsInScope: z
      .array(KeySegmentSchema)
      .min(1)
      .refine((slots) => new Set(slots).size === slots.length, "duplicate subject slot")
      .overwrite(normalizeCanonicalStrings)
      .readonly(),
  })
  .readonly();

const RestrictionScreenInputSchema = z
  .strictObject({
    parameters: RestrictionScreenParameterSchema,
    evidence: z
      .strictObject({
        restrictions: z
          .array(RestrictionListSchema)
          // One source version states one list per kind and slot: a second list
          // on that identity would emit byte-identical matches, which the
          // platform would read as two prohibitions from one source.
          .refine(
            (lists) => hasUniqueByComparator(lists, compareRestrictionLists),
            "duplicate restriction list",
          )
          .overwrite((lists) => [...lists].sort(compareRestrictionLists))
          .readonly(),
      })
      .readonly(),
    context: z
      .strictObject({
        /** The proposed action's bound subjects, keyed by slot name. */
        subjects: z.record(KeySegmentSchema, SubjectRefSchema).readonly(),
      })
      .readonly(),
  })
  .superRefine((input, ctx) => {
    const declaredPolarity = new Map(
      input.parameters.restrictionKinds.map((entry) => [entry.kind, entry.polarity]),
    );
    const slots = new Set(input.parameters.subjectsInScope);
    for (const slot of slots) {
      // OWN properties only: `in` would resolve a kebab-valid slot such as
      // "constructor" through Object.prototype and bind a function as a subject.
      if (!Object.hasOwn(input.context.subjects, slot)) {
        ctx.addIssue({
          code: "custom",
          message: "subject in scope has no bound subject reference",
          path: ["context", "subjects", slot],
        });
      }
    }
    input.evidence.restrictions.forEach((restriction, index) => {
      const polarity = declaredPolarity.get(restriction.kind);
      if (polarity === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "restriction kind is not declared by the binding",
          path: ["evidence", "restrictions", index, "kind"],
        });
      } else if (polarity !== restriction.polarity) {
        ctx.addIssue({
          code: "custom",
          message: "restriction polarity contradicts the declared kind",
          path: ["evidence", "restrictions", index, "polarity"],
        });
      }
      if (!slots.has(restriction.appliesToSlot)) {
        ctx.addIssue({
          code: "custom",
          message: "restriction applies to a slot outside the declared scope",
          path: ["evidence", "restrictions", index, "appliesToSlot"],
        });
      }
    });
    addSingleTenantIssue(
      ctx,
      [
        ...input.evidence.restrictions.flatMap((restriction) => [
          restriction.sourceRef,
          restriction.versionRef,
          ...restriction.entryRefs,
        ]),
        ...Object.values(input.context.subjects),
      ],
      ["evidence"],
    );
  })
  .readonly();

const restrictionScreenFalsification: PrimitiveFalsification = {
  operatingCase:
    "A restriction whose applicability requires computation rather than matching - 'no more than two distributions per quarter' is an aggregate-based restriction, and forcing it through the screen would smuggle aggregation into matching.",
  falsifiedResponse:
    "Activate the declared future primitive windowed-event-count under a primitive-set version bump; the screen stays pure set membership with source attribution.",
};

export const restrictionScreen = {
  id: parsePrimitiveId("restriction-screen"),
  summary:
    "Match the proposed action's bound subjects against standing restrictions across the three governing planes (regulatory, firm policy, household instruction), honoring allow-list and deny-list polarity, and emit matches carrying source type, versioned source reference, scope, and matched entry.",
  parameterSchema: RestrictionScreenParameterSchema,
  inputSchema: RestrictionScreenInputSchema,
  evidenceKindParameters: [],
  allowedStrategies: [],
  publishedKeys: (
    parameters: z.infer<typeof RestrictionScreenParameterSchema>,
  ): PublishedKeyMap => {
    const keys: Record<string, ReturnType<typeof publishedBoolean>> = {};
    for (const entry of parameters.restrictionKinds) {
      keys[`restrictions.matched.${entry.kind}`] = publishedBoolean(
        `Whether any ${entry.kind} restriction matched the proposed action.`,
      );
    }
    keys["restrictions.matches"] = publishedStructured(
      "All matches with source attribution, for the platform's prohibition and precedence machinery.",
    );
    return keys;
  },
  falsification: restrictionScreenFalsification,
  evaluate: (
    input: z.infer<typeof RestrictionScreenInputSchema>,
  ): PublishedFactRecord => {
    const matches: PublishedFactRecord[] = [];
    const matchedByKind: Record<string, boolean> = {};
    for (const entry of input.parameters.restrictionKinds) {
      matchedByKind[entry.kind] = false;
    }
    // Own entries only, matching the parse boundary's prototype-chain refusal.
    const subjects = new Map(Object.entries(input.context.subjects));
    for (const restriction of input.evidence.restrictions) {
      const subject = subjects.get(restriction.appliesToSlot) ?? null;
      const member =
        subject !== null &&
        restriction.entryRefs.some(
          (candidate) => compareScopedReferences(candidate, subject) === 0,
        );
      // An unresolvable slot never CLEARS a restriction: it matches, fail-closed.
      const violated =
        subject === null || (restriction.polarity === "deny-list" ? member : !member);
      if (!violated) continue;
      matchedByKind[restriction.kind] = true;
      const subjectRef = subject === null ? null : { ...subject };
      matches.push({
        appliesToSlot: restriction.appliesToSlot,
        kind: restriction.kind,
        // A deny-list violation names the entry that captured the subject; an
        // allow-list violation has no matched entry - the absence IS the match.
        matchedEntryRef: restriction.polarity === "deny-list" ? subjectRef : null,
        polarity: restriction.polarity,
        sourceRef: { ...restriction.sourceRef },
        sourceType: restriction.sourceType,
        subjectRef,
        versionRef: { ...restriction.versionRef },
      });
    }
    const published: Record<string, boolean | PublishedFactRecord[]> = {};
    for (const kind of Object.keys(matchedByKind).sort(compareCanonicalStrings)) {
      published[`restrictions.matched.${kind}`] = matchedByKind[kind]!;
    }
    published["restrictions.matches"] = matches;
    return published;
  },
};

// ── evidence-reconciliation ─────────────────────────────────────────────────────

const FactAssertionSchema = z
  .strictObject({
    snapshotRef: EvidenceSnapshotIdRefSchema,
    sourceRef: EvidenceSourceRefSchema,
    /** Integer facts reconcile within tolerance; string facts must match exactly. */
    value: z.union([z.int(), z.string()]),
  })
  .readonly();

const EvidenceReconciliationParameterSchema = z
  .strictObject({
    factKind: KeySegmentSchema,
    /** Fewer than two sources is not a reconciliation - it is a plain read. */
    sourcesToReconcile: z
      .array(EvidenceSourceRefSchema)
      .min(2)
      .refine(hasUniqueScopedReferences, "duplicate reconciliation source")
      .overwrite(normalizeScopedReferences)
      .readonly(),
    /** Firm-configurable agreement tolerance for integer facts, in minor units. */
    tolerance: z.int().nonnegative(),
  })
  .readonly();

const EvidenceReconciliationInputSchema = z
  .strictObject({
    parameters: EvidenceReconciliationParameterSchema,
    evidence: z
      .strictObject({
        assertions: z
          .array(FactAssertionSchema)
          .refine(
            (assertions) =>
              hasUniqueScopedReferences(assertions.map((a) => a.snapshotRef)),
            "duplicate assertion snapshot",
          )
          .overwrite((assertions) =>
            [...assertions].sort((left, right) =>
              compareScopedReferences(left.snapshotRef, right.snapshotRef),
            ),
          )
          .readonly(),
      })
      .readonly(),
    context: z.strictObject({}).readonly(),
  })
  .superRefine((input, ctx) => {
    input.evidence.assertions.forEach((assertion, index) => {
      const declared = input.parameters.sourcesToReconcile.some(
        (source) => compareScopedReferences(source, assertion.sourceRef) === 0,
      );
      if (!declared) {
        ctx.addIssue({
          code: "custom",
          message: "assertion source is not declared for reconciliation",
          path: ["evidence", "assertions", index, "sourceRef"],
        });
      }
    });
    addSingleTenantIssue(
      ctx,
      [
        ...input.parameters.sourcesToReconcile,
        ...input.evidence.assertions.flatMap((assertion) => [
          assertion.snapshotRef,
          assertion.sourceRef,
        ]),
      ],
      ["evidence"],
    );
  })
  .readonly();

const evidenceReconciliationFalsification: PrimitiveFalsification = {
  operatingCase:
    "If every real contradiction check turns out to be schema validation or a fixed trust-hierarchy rule no firm ever configures - no tolerance choices, no source-pair choices - this is platform machinery, not configurable judgment. Also disclosed: zero of the sixteen signed golden cases exercise it today; prompt 15's required contradictory-evidence test is what activates it.",
  falsifiedResponse:
    "Demote it into the validation stage as fixed machinery and remove it from the catalog under a primitive-set version bump.",
};

export const evidenceReconciliation = {
  id: parsePrimitiveId("evidence-reconciliation"),
  summary:
    "Cross-source agreement check on one fact kind for one subject: given two or more snapshots asserting the fact, determine agreement within a configured tolerance; on disagreement emit contradictions citing both snapshot references - never the values, which may be PII.",
  parameterSchema: EvidenceReconciliationParameterSchema,
  inputSchema: EvidenceReconciliationInputSchema,
  evidenceKindParameters: [],
  allowedStrategies: [],
  publishedKeys: (
    parameters: z.infer<typeof EvidenceReconciliationParameterSchema>,
  ): PublishedKeyMap => ({
    [`reconciliation.${parameters.factKind}.consistent`]: publishedBoolean(
      "Whether every assertion pair agrees within tolerance; vacuously true below two assertions (evidence sufficiency belongs to the validation stage).",
    ),
    [`reconciliation.${parameters.factKind}.contradictions`]: publishedStructured(
      "Disagreeing assertion pairs, each citing both snapshot and source references.",
    ),
  }),
  falsification: evidenceReconciliationFalsification,
  evaluate: (
    input: z.infer<typeof EvidenceReconciliationInputSchema>,
  ): PublishedFactRecord => {
    const factKind = input.parameters.factKind;
    const tolerance = input.parameters.tolerance;
    const assertions = input.evidence.assertions;
    const contradictions: PublishedFactRecord[] = [];
    for (let left = 0; left < assertions.length; left += 1) {
      for (let right = left + 1; right < assertions.length; right += 1) {
        const a = assertions[left]!;
        const b = assertions[right]!;
        const agrees =
          typeof a.value === "number" && typeof b.value === "number"
            ? Math.abs(a.value - b.value) <= tolerance
            : typeof a.value === "string" && typeof b.value === "string"
              ? a.value === b.value
              : false;
        if (agrees) continue;
        contradictions.push({
          left: { snapshotRef: { ...a.snapshotRef }, sourceRef: { ...a.sourceRef } },
          right: { snapshotRef: { ...b.snapshotRef }, sourceRef: { ...b.sourceRef } },
        });
      }
    }
    return {
      [`reconciliation.${factKind}.consistent`]: contradictions.length === 0,
      [`reconciliation.${factKind}.contradictions`]: contradictions,
    };
  },
};
